'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('location-srv');

function buildFullName(locationName = '', extension = '') {
  const n = (locationName || '').trim();
  const e = (extension   || '').trim();
  return e ? `${n} (${e})` : n;
}

// Normalise a raw row from ZCDS_GIS (lowercase ABAP field names) to PascalCase for the UI
function normalise(r) {
  const ext = String(r.extension ?? r.Extension ?? '').trim();
  return {
    LocationName : (r.name       || r.LocationName || '').trim(),
    Ward         : (r.ward       || r.Ward         || '').trim(),
    Region       : (r.region     || r.Region       || '').trim(),
    Extension    : (ext === '0') ? '' : ext
  };
}

module.exports = cds.service.impl(async function (srv) {

  // Connect to BTP destinations — resolved from Destination Service bindings
  let S4, SC2;
  try { S4  = await cds.connect.to('S4HANA_DESTINATION'); }
  catch (e) { LOG.warn('S4HANA_DESTINATION (THD_NEW) not available:', e.message); }

  try { SC2 = await cds.connect.to('SC2_DESTINATION'); }
  catch (e) { LOG.warn('SC2_DESTINATION (Case_Object) not available:', e.message); }

  // ── ACTION: searchLocations ───────────────────────────────────────────────
  srv.on('searchLocations', async (req) => {
    const { query, ward, region } = req.data;

    // ── Dev mock (no S4 connection) ─────────────────────────────────────────
    if (!S4) {
      let data = [
        { LocationName: 'ALPHENPARK',    Ward: '82', Region: 'Region 3', Extension: ''   },
        { LocationName: 'MONTANA PARK',  Ward: '5',  Region: 'Region 2', Extension: '12' },
        { LocationName: 'STERREWAG',     Ward: '42', Region: 'Region 3', Extension: ''   },
        { LocationName: 'City Hall',     Ward: '1',  Region: 'Region 1', Extension: '10' },
        { LocationName: 'Health Clinic', Ward: '3',  Region: 'Region 2', Extension: ''   }
      ];
      const q = (query || '').toLowerCase();
      if (q)      data = data.filter(r => r.LocationName.toLowerCase().includes(q));
      if (ward)   data = data.filter(r => r.Ward   === ward);
      if (region) data = data.filter(r => r.Region === region);
      return data;
    }

    // ── Live fetch from S4HANA via OData ────────────────────────────────────
    try {
      const rows = await S4.run(SELECT.from('S4HANA.ZCDS_GIS'));
      let data   = (Array.isArray(rows) ? rows : []).map(normalise);

      // Client-side filtering
      const q = (query || '').toLowerCase();
      if (q)      data = data.filter(r => r.LocationName.toLowerCase().includes(q));
      if (ward)   data = data.filter(r => r.Ward   === ward);
      if (region) data = data.filter(r => r.Region === region);

      LOG.info(`searchLocations returned ${data.length} records`);
      return data;

    } catch (e) {
      LOG.error('S4HANA search failed:', e.message);
      return req.error(500, `S4HANA search failed: ${e.message}`);
    }
  });

  // ── ACTION: updateCaseLocation ────────────────────────────────────────────
  srv.on('updateCaseLocation', async (req) => {
    const { caseId, locationName, ward, region, extension } = req.data;

    if (!caseId)       return req.error(400, 'caseId is required.');
    if (!locationName) return req.error(400, 'locationName is required.');

    const fullName = buildFullName(locationName, extension);

    const sc2Payload = {
      extensions: {
        LocationName : locationName,
        Ward         : ward      || '',
        Region       : region    || '',
        Extension    : extension || ''
      }
    };

    LOG.info(`Updating SC2 case ${caseId} → location "${fullName}"`);

    if (SC2) {
      try {
        await SC2.send({
          method  : 'PATCH',
          path    : `/sap/c4c/api/v1/case-service/cases/${caseId}`,
          data    : sc2Payload,
          headers : { 'Content-Type': 'application/json' }
        });
        LOG.info(`SC2 case ${caseId} updated successfully.`);

      } catch (e) {
        // If SC2 requires X-CSRF-Token (403 Forbidden), fetch token and retry
        if (e.response?.status === 403 || e.status === 403) {
          LOG.info('SC2 requires CSRF token — fetching and retrying...');
          try {
            const axios   = require('axios');
            const baseUrl = (SC2.options?.credentials?.url || '').replace(/\/$/, '');
            const auth    = SC2.options?.credentials?.headers?.Authorization ||
                            (SC2.options?.credentials?.token && `Bearer ${SC2.options.credentials.token}`) ||
                            process.env.SC2_AUTH_HEADER || '';

            const csrfResp = await axios.get(
              `${baseUrl}/sap/c4c/api/v1/case-service/cases?$top=1`,
              { headers: { Authorization: auth, 'X-CSRF-Token': 'Fetch' } }
            );
            const token   = csrfResp.headers['x-csrf-token'];
            const cookies = (csrfResp.headers['set-cookie'] || []).join('; ');

            await axios.patch(
              `${baseUrl}/sap/c4c/api/v1/case-service/cases/${caseId}`,
              sc2Payload,
              {
                headers: {
                  'Content-Type'  : 'application/json',
                  'Authorization' : auth,
                  'X-CSRF-Token'  : token,
                  'Cookie'        : cookies
                }
              }
            );
            LOG.info(`SC2 case ${caseId} updated (with CSRF token).`);
          } catch (retryErr) {
            const msg = retryErr.response?.data?.message || retryErr.message;
            LOG.error(`SC2 PATCH retry failed for case ${caseId}:`, msg);
            return req.error(502, `SC2 update failed: ${msg}`);
          }
        } else {
          const msg = e.response?.data?.message || e.message;
          LOG.error(`SC2 PATCH failed for case ${caseId}:`, msg);
          return req.error(502, `SC2 update failed: ${msg}`);
        }
      }
    } else {
      LOG.info('[DEV] SC2_DESTINATION not configured. Would have sent:', JSON.stringify(sc2Payload));
    }

    return {
      status  : 'SUCCESS',
      message : `Case ${caseId} updated with location "${fullName}".`
    };
  });
});
