'use strict';

const cds  = require('@sap/cds');
const LOG  = cds.log('location-srv');

// CPI endpoint that proxies S/4HANA ZCDS_GIS_CDS OData service
const GIS_URL = 'https://cotdevcode.it-cpi033-rt.cfapps.eu10-005.hana.ondemand.com/http/Dev/S4/OData/GetGISData/ZCDS_GIS';

function buildFullName(locationName = '', extension = '') {
  const n = (locationName || '').trim();
  const e = (extension   || '').trim();
  return e ? `${n} (${e})` : n;
}

// Parse SAP OData date formats:
//   /Date(1234567890000)/  →  JS Date
//   YYYY-MM-DD            →  JS Date
//   Returns null if unparseable or clearly empty (00000000 / 9999-12-31 treated as no expiry)
function parseSAPDate(str) {
  if (!str) return null;
  const ms = str.match(/\/Date\((\d+)\)\//);
  if (ms) {
    const d = new Date(parseInt(ms[1]));
    return isNaN(d) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str);
    return isNaN(d) ? null : d;
  }
  return null;
}

// Parse standard OData V2 XML: <m:properties><d:Field>value</d:Field>...</m:properties>
// Also extracts validity date fields used for cleaning.
function parseODataV2XML(xmlStr) {
  const rows = [];
  for (const match of xmlStr.matchAll(/<m:properties[^>]*>([\s\S]*?)<\/m:properties>/g)) {
    const block = match[1];
    const get = (field) => {
      const m = block.match(new RegExp(`<d:${field}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/d:${field}>`));
      return m ? m[1].trim() : '';
    };
    const ext = get('Extension');
    rows.push({
      LocationName : get('LocationName'),
      Ward         : get('Ward'),
      Region       : get('Region'),
      Extension    : (ext === '0') ? '' : ext,
      // Capture any validity date fields present in the OData response
      _validFrom   : get('ValidFrom')          || get('ValidityStartDate') || get('DateFrom') || '',
      _validTo     : get('ValidTo')            || get('ValidityEndDate')   || get('DateTo')   || ''
    });
  }
  return rows;
}

// Returns true if a record should be included after data-quality checks.
function isCleanRecord(r, now) {
  const name   = (r.LocationName || '').trim();
  const ward   = (r.Ward         || '').trim();
  const region = (r.Region       || '').trim();

  // 1. Skip zero-padded garbage names  e.g. "MABOPANE X00000000000000000012"
  if (/X0{5,}/.test(name)) return false;

  // 2. Skip records with placeholder ward "00" / "0"
  if (ward === '00' || ward === '0') return false;

  // 3. Skip records with no ward AND no region (stale / incomplete duplicates)
  if (!ward && !region) return false;

  // 4. Date validity — only filter when the field is actually present
  if (r._validFrom) {
    const from = parseSAPDate(r._validFrom);
    if (from && from > now) return false;   // not yet effective
  }
  if (r._validTo) {
    const to = parseSAPDate(r._validTo);
    // Ignore the SAP "no expiry" sentinel 9999-12-31
    if (to && to.getFullYear() < 9999 && to < now) return false;  // expired
  }

  return true;
}

module.exports = cds.service.impl(async function (srv) {

  // SC2 connector — resolved from Case_Object BTP destination
  let SC2;
  try { SC2 = await cds.connect.to('SC2_DESTINATION'); }
  catch (e) { LOG.warn('SC2_DESTINATION (Case_Object) not available:', e.message); }

  // ── ACTION: searchLocations ───────────────────────────────────────────────
  srv.on('searchLocations', async (req) => {
    const { query, ward, region } = req.data;

    try {
      const axios   = require('axios');
      const headers = {};
      const user    = process.env.GIS_USERNAME;
      const pass    = process.env.GIS_PASSWORD;
      if (user && pass) {
        headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
      }

      LOG.info(`Calling GIS URL: ${GIS_URL}`);
      LOG.info(`Auth header present: ${!!headers['Authorization']}`);

      const resp = await axios.get(GIS_URL, { headers, timeout: 15000 });
      LOG.info(`GIS response status: ${resp.status}`);
      LOG.info(`GIS raw response (first 500 chars): ${String(resp.data).substring(0, 500)}`);

      const now  = new Date();
      let data   = parseODataV2XML(String(resp.data)).filter(r => isCleanRecord(r, now));
      LOG.info(`Parsed and cleaned: ${data.length} valid records from GIS response`);

      // Client-side filtering
      const q = (query || '').toLowerCase();
      if (q)      data = data.filter(r => r.LocationName.toLowerCase().includes(q));
      if (ward)   data = data.filter(r => r.Ward   === ward);
      if (region) data = data.filter(r => r.Region === region);

      LOG.info(`searchLocations returned ${data.length} records`);
      return data;

    } catch (e) {
      LOG.error('GIS fetch failed:', e.message);
      if (e.response) {
        LOG.error(`GIS HTTP status: ${e.response.status}`);
        LOG.error(`GIS response body (first 500 chars): ${String(e.response.data).substring(0, 500)}`);
      } else if (e.request) {
        LOG.error('GIS request was made but no response received (timeout or network error)');
      } else {
        LOG.error('GIS request setup error:', e.stack);
      }
      LOG.warn('GIS_USERNAME set:', !!process.env.GIS_USERNAME);
      LOG.warn('GIS_PASSWORD set:', !!process.env.GIS_PASSWORD);

      // Fall back to mock data so the UI still loads during outages
      LOG.info('Returning mock data as fallback');
      return [
        { LocationName: 'ALPHENPARK',   Ward: '82', Region: 'Region 3', Extension: ''   },
        { LocationName: 'MONTANA PARK', Ward: '5',  Region: 'Region 2', Extension: '12' },
        { LocationName: 'STERREWAG',    Ward: '42', Region: 'Region 3', Extension: ''   }
      ];
    }
  });

  // ── ACTION: updateCaseLocation ────────────────────────────────────────────
  srv.on('updateCaseLocation', async (req) => {
    const { caseId, locationName, ward, region, extension } = req.data;

    if (!caseId)       return req.error(400, 'caseId is required.');
    if (!locationName) return req.error(400, 'locationName is required.');

    const fullName = buildFullName(locationName, extension);

    // SC2 case extensions object — maps S4 location fields to SC2 extension field names.
    // Old address fields are explicitly cleared so stale data doesn't remain after a
    // location change. The merge below will still preserve any other fields (e.g.
    // MobileNumber, ZEMAIL) that SC2 validation requires to be present on every PATCH.
    const sc2Payload = {
      extensions: {
        // Set location fields from S/4HANA selection
        TownshipFarmName : locationName,
        Suburb           : locationName,
        Ward             : ward      || '',
        Region           : region    || '',
        Extension        : extension || '',
        // Clear old address fields so stale data doesn't remain
        StreetNo         : '',
        Street           : '',
        owner            : '',
        LISKey           : '',
        ZERFNumber       : '',
        ZGPSLatitude     : '',
        ZGPSLongitude    : ''
      }
    };

    LOG.info(`Updating SC2 case ${caseId} with location "${fullName}"`);

    if (!SC2) {
      LOG.info('[DEV] SC2_DESTINATION not configured. Would have sent:', sc2Payload);
      return {
        status  : 'SUCCESS',
        message : `[DEV] Case ${caseId} would be updated with location "${fullName}".`
      };
    }

    try {
      const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
      const destination = { destinationName: 'Case_Object' };
      const casePath    = `/sap/c4c/api/v1/case-service/cases/${caseId}`;

      // Step 1: GET the case — read ETag AND existing extension values so we
      // can pass them through in the PATCH (SC2 custom validation requires
      // MobileNumber to be present whenever extensions are updated).
      LOG.info(`GET ${casePath} to retrieve ETag and existing extensions`);
      const getResp = await executeHttpRequest(destination, {
        method  : 'GET',
        url     : casePath,
        headers : { 'Accept': 'application/json' }
      });

      const etag =
        getResp.headers['etag'] ||
        getResp.headers['ETag'] ||
        (getResp.data && getResp.data['@odata.etag']) ||
        '*';

      LOG.info(`ETag for case ${caseId}: ${etag}`);

      // Preserve existing extension values that SC2 validation requires
      const existingExt = (getResp.data && getResp.data.extensions) || {};
      LOG.info(`Existing extensions from GET: ${JSON.stringify(existingExt)}`);

      // Merge: keep all existing extension values, override only our location fields
      sc2Payload.extensions = Object.assign({}, existingExt, sc2Payload.extensions);
      LOG.info(`Final PATCH payload: ${JSON.stringify(sc2Payload)}`);

      // Step 2: PATCH with the real ETag in If-Match
      await executeHttpRequest(destination, {
        method  : 'PATCH',
        url     : casePath,
        headers : { 'Content-Type': 'application/json', 'If-Match': etag },
        data    : sc2Payload
      });

      return {
        status  : 'SUCCESS',
        message : `Case ${caseId} updated with location "${fullName}".`
      };
    } catch (e) {
      const status  = e.response && e.response.status;
      const body    = e.response && JSON.stringify(e.response.data);
      LOG.error(`SC2 PATCH failed for case ${caseId}: ${e.message}`);
      if (status) LOG.error(`SC2 HTTP ${status} — full response: ${body}`);
      LOG.error(`SC2 payload sent: ${JSON.stringify(sc2Payload)}`);
      const sc2Msg = (e.response && e.response.data && (
        e.response.data.message ||
        e.response.data.error?.message ||
        (e.response.data.errors && JSON.stringify(e.response.data.errors))
      )) || e.message;
      return req.error(502, `SC2 update failed: ${sc2Msg}`);
    }
  });
});
