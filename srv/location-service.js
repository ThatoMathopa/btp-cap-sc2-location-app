'use strict';

const cds  = require('@sap/cds');
const LOG  = cds.log('location-srv');

// ─── Helper: build fullLocationName ─────────────────────────────────────────
function buildFullName(locationName = '', extension = '') {
  const n = (locationName || '').trim();
  const e = (extension   || '').trim();
  if (!n) return e;
  return e ? `${n} (${e})` : n;
}

// ─── Helper: fetch CSRF token + session cookie from SC2 ─────────────────────
async function fetchSC2CsrfToken(sc2BaseUrl, authHeader) {
  const axios = require('axios');
  const resp  = await axios.get(`${sc2BaseUrl}/sap/c4c/api/v1/case-service/cases`, {
    params: { '$top': 1 },
    headers: {
      Authorization:  authHeader,
      'X-CSRF-Token': 'Fetch'
    }
  });
  return {
    token:   resp.headers['x-csrf-token'],
    cookies: resp.headers['set-cookie']
  };
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = cds.service.impl(async function (srv) {

  const { Locations, CaseLocationLog } = cds.entities('com.company.locations');

  // ── Connect to external systems ──────────────────────────────────────────
  let S4, SC2;
  try { S4  = await cds.connect.to('S4HANA_DESTINATION'); }
  catch (e) { LOG.warn('S4HANA_DESTINATION not configured:', e.message); }

  try { SC2 = await cds.connect.to('SC2_DESTINATION'); }
  catch (e) { LOG.warn('SC2_DESTINATION not configured:', e.message); }

  // ── READ Locations — serve from HANA cache ───────────────────────────────
  srv.on('READ', 'Locations', (req) => cds.run(req.query));

  // ── READ CaseLocationLog ─────────────────────────────────────────────────
  srv.on('READ', 'CaseLocationLog', (req) => cds.run(req.query));

  // ────────────────────────────────────────────────────────────────────────
  //  ACTION: syncFromS4
  //  Pulls location records from S/4HANA and upserts into local HANA cache
  // ────────────────────────────────────────────────────────────────────────
  srv.on('syncFromS4', async (req) => {
    if (!S4) return req.error(503,
      'S4HANA_DESTINATION not configured. '
      + 'Create a BTP destination named "S4HANA_DESTINATION".');

    LOG.info('Starting S/4HANA location sync…');

    let s4Records;
    try {
      s4Records = await S4.run(
        SELECT.from('S4HANA.ZCDS_GIS')
              .columns('LocationName','Ward','Region','Extension')
      );
    } catch (e) {
      LOG.error('S/4HANA read failed:', e);
      return req.error(500, `Failed to read from S/4HANA: ${e.message}`);
    }

    if (!s4Records?.length) {
      LOG.warn('S/4HANA returned 0 location records.');
      return 'Sync complete — 0 records received.';
    }

    LOG.info(`Received ${s4Records.length} records from S/4HANA.`);

    const rows = s4Records.map((r) => ({
      s4LocationId     : r.LocationName,   // LocationName is the natural key
      locationName     : r.LocationName,
      ward             : r.Ward,
      region           : r.Region,
      extension        : r.Extension,
      fullLocationName : buildFullName(r.LocationName, r.Extension)
    }));

    // Full refresh — delete existing cache then insert fresh
    await DELETE.from(Locations);
    await INSERT.into(Locations).entries(rows);

    const msg = `Sync complete — ${rows.length} locations upserted.`;
    LOG.info(msg);
    return msg;
  });

  // ────────────────────────────────────────────────────────────────────────
  //  ACTION: updateCaseLocation
  //  Reads the chosen location from HANA, then PATCHes the SC2 case with
  //  the four extension fields (_KUT suffix = Key User Tool / custom field).
  // ────────────────────────────────────────────────────────────────────────
  srv.on('updateCaseLocation', async (req) => {
    const { caseId, locationId } = req.data;

    if (!caseId)     return req.error(400, 'caseId is required.');
    if (!locationId) return req.error(400, 'locationId is required.');

    // 1. Load location from HANA cache
    const loc = await SELECT.one.from(Locations).where({ ID: locationId });
    if (!loc) return req.error(404, `Location ${locationId} not found in cache.`);

    // 2. Build SC2 PATCH payload — extension fields end in _KUT
    //    ⚠️  Replace field names below with the exact names from your SC2 tenant.
    const sc2Payload = {
      Location_KUT  : loc.locationName,
      Ward_KUT      : loc.ward,
      Region_KUT    : loc.region,
      Extension_KUT : loc.extension
    };

    LOG.info(`Updating SC2 case ${caseId} with location ${loc.fullLocationName}`);

    // 3. Call Service Cloud V2 REST API
    let sc2Status = 'SUCCESS';
    let sc2Error  = '';

    if (SC2) {
      try {
        const axios       = require('axios');
        const destination = process.env.SC2_BASE_URL || 'http://localhost:4004/mock/sc2';
        const authHeader  = process.env.SC2_AUTH_HEADER || 'Basic CHANGEME';

        // Fetch CSRF token (SC2 requires this for PATCH)
        const { token, cookies } = await fetchSC2CsrfToken(destination, authHeader);

        await axios.patch(
          `${destination}/sap/c4c/api/v1/case-service/cases/${caseId}`,
          sc2Payload,
          {
            headers: {
              'Content-Type'   : 'application/json',
              'Authorization'  : authHeader,
              'X-CSRF-Token'   : token,
              'Cookie'         : (cookies || []).join('; ')
            }
          }
        );
      } catch (e) {
        sc2Status = 'ERROR';
        sc2Error  = e.response?.data?.message || e.message;
        LOG.error(`SC2 PATCH failed for case ${caseId}:`, sc2Error);
      }
    } else {
      // Dev mode — no real SC2, just log
      LOG.info('[DEV] SC2_DESTINATION not configured. Would have sent:', sc2Payload);
    }

    // 4. Write audit log entry
    await INSERT.into(CaseLocationLog).entries({
      caseId           : caseId,
      s4LocationId     : loc.s4LocationId,
      locationName     : loc.locationName,
      ward             : loc.ward,
      region           : loc.region,
      extension        : loc.extension,
      fullLocationName : loc.fullLocationName,
      status           : sc2Status,
      errorMessage     : sc2Error
    });

    if (sc2Status === 'ERROR') {
      return req.error(502, `SC2 update failed: ${sc2Error}`);
    }

    return {
      status  : 'SUCCESS',
      message : `Case ${caseId} updated with location "${loc.fullLocationName}".`
    };
  });

  // ── BEFORE CREATE/UPDATE: keep fullLocationName in sync ─────────────────
  srv.before(['CREATE','UPDATE'], 'Locations', (req) => {
    const d = req.data;
    if (d.locationName !== undefined || d.extension !== undefined) {
      d.fullLocationName = buildFullName(d.locationName ?? '', d.extension ?? '');
    }
  });
});
