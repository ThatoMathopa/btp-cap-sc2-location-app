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

// Parse standard OData V2 XML: <m:properties><d:Field>value</d:Field>...</m:properties>
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
      Extension    : (ext === '0') ? '' : ext
    });
  }
  return rows;
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
      LOG.info(`GIS response content-type: ${resp.headers['content-type']}`);
      LOG.info(`GIS raw response (first 500 chars): ${String(resp.data).substring(0, 500)}`);

      let data   = parseODataV2XML(resp.data);
      LOG.info(`Parsed ${data.length} records from GIS response`);

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

    // SC2 case extensions object — maps S4 location fields to SC2 extension field names
    const sc2Payload = {
      extensions: {
        TownshipFarmName : locationName,
        Suburb           : locationName,
        Ward             : ward      || '',
        Region           : region    || '',
        Extension        : extension || ''
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
      // Step 1: GET the case to retrieve the current ETag
      const casePath = `/sap/c4c/api/v1/case-service/cases/${caseId}`;
      LOG.info(`Fetching ETag for case ${caseId} via GET ${casePath}`);

      const getResp = await SC2.send({
        method  : 'GET',
        path    : casePath,
        headers : { 'Accept': 'application/json' }
      });

      // ETag may come from response body (@odata.etag or __metadata.etag)
      const etag =
        (getResp && getResp['@odata.etag']) ||
        (getResp && getResp.__metadata && getResp.__metadata.etag) ||
        null;

      if (!etag) {
        LOG.warn(`No ETag found in GET response for case ${caseId}. Proceeding without If-Match.`);
      } else {
        LOG.info(`ETag retrieved for case ${caseId}: ${etag}`);
      }

      // Step 2: PATCH with the retrieved ETag in If-Match header
      const patchHeaders = { 'Content-Type': 'application/json' };
      if (etag) patchHeaders['If-Match'] = etag;

      await SC2.send({
        method  : 'PATCH',
        path    : casePath,
        data    : sc2Payload,
        headers : patchHeaders
      });

      return {
        status  : 'SUCCESS',
        message : `Case ${caseId} updated with location "${fullName}".`
      };
    } catch (e) {
      const msg = e.message || 'Unknown error';
      LOG.error(`SC2 PATCH failed for case ${caseId}:`, msg);
      return req.error(502, `SC2 update failed: ${msg}`);
    }
  });
});
