'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('location-srv');

function buildFullName(locationName = '', extension = '') {
  const n = (locationName || '').trim();
  const e = (extension   || '').trim();
  return e ? `${n} (${e})` : n;
}

async function fetchSC2CsrfToken(baseUrl, authHeader) {
  const axios = require('axios');
  const resp  = await axios.get(
    `${baseUrl}/sap/c4c/api/v1/case-service/cases`,
    {
      params:  { '$top': 1 },
      headers: { Authorization: authHeader, 'X-CSRF-Token': 'Fetch' }
    }
  );
  return {
    token:   resp.headers['x-csrf-token'],
    cookies: resp.headers['set-cookie']
  };
}

module.exports = cds.service.impl(async function (srv) {

  let S4, SC2;
  try { S4  = await cds.connect.to('S4HANA_DESTINATION'); }
  catch (e) { LOG.warn('S4HANA_DESTINATION not configured:', e.message); }

  try { SC2 = await cds.connect.to('SC2_DESTINATION'); }
  catch (e) { LOG.warn('SC2_DESTINATION not configured:', e.message); }

  // ── ACTION: searchLocations — fetch live from S4HANA ─────────────────────
  srv.on('searchLocations', async (req) => {
    const { query, ward, region } = req.data;

    if (!S4) {
      // Dev mock — return filtered mock data
      let data = [
        { LocationName: 'City Hall',             Ward: 'Ward A', Region: 'North',   Extension: 'EXT-100' },
        { LocationName: 'Community Centre',      Ward: 'Ward B', Region: 'South',   Extension: 'EXT-200' },
        { LocationName: 'Public Library',        Ward: 'Ward A', Region: 'East',    Extension: 'EXT-300' },
        { LocationName: 'Sports Complex',        Ward: 'Ward C', Region: 'West',    Extension: 'EXT-400' },
        { LocationName: 'Health Clinic',         Ward: 'Ward D', Region: 'North',   Extension: 'EXT-500' },
        { LocationName: 'Fire Station 3',        Ward: 'Ward B', Region: 'South',   Extension: 'EXT-600' },
        { LocationName: 'Police Precinct 7',     Ward: 'Ward C', Region: 'East',    Extension: ''        },
        { LocationName: 'Water Treatment Plant', Ward: 'Ward E', Region: 'West',    Extension: 'EXT-800' },
        { LocationName: 'Recycling Depot',       Ward: 'Ward F', Region: 'North',   Extension: 'EXT-900' },
        { LocationName: 'Parks Office',          Ward: 'Ward A', Region: 'Central', Extension: 'EXT-010' }
      ];
      const q = (query || '').toLowerCase();
      if (q)      data = data.filter(r => r.LocationName.toLowerCase().includes(q));
      if (ward)   data = data.filter(r => r.Ward   === ward);
      if (region) data = data.filter(r => r.Region === region);
      return data;
    }

    try {
      const filter = {};
      if (query)  filter.LocationName = { like: `%${query}%` };
      if (ward)   filter.Ward   = ward;
      if (region) filter.Region = region;

      const cqn = Object.keys(filter).length
        ? SELECT.from('S4HANA.ZCDS_GIS').where(filter)
        : SELECT.from('S4HANA.ZCDS_GIS');

      return await S4.run(cqn);
    } catch (e) {
      LOG.error('S4 search failed:', e);
      return req.error(500, `S4 search failed: ${e.message}`);
    }
  });

  // ── ACTION: updateCaseLocation — PATCH SC2 case ───────────────────────────
  srv.on('updateCaseLocation', async (req) => {
    const { caseId, locationName, ward, region, extension } = req.data;

    if (!caseId)       return req.error(400, 'caseId is required.');
    if (!locationName) return req.error(400, 'locationName is required.');

    const fullName = buildFullName(locationName, extension);

    const sc2Payload = {
      LocationName_KUT : locationName,
      Ward_KUT         : ward     || '',
      Region_KUT       : region   || '',
      Extension_KUT    : extension || ''
    };

    LOG.info(`Updating SC2 case ${caseId} with location "${fullName}"`);

    if (SC2) {
      try {
        const axios   = require('axios');
        const baseUrl = (
          SC2.options?.credentials?.url ||
          process.env.SC2_BASE_URL       ||
          'http://localhost:4004/mock/sc2'
        ).replace(/\/$/, '');

        const authHeader = SC2.options?.credentials?.headers?.Authorization ||
                           process.env.SC2_AUTH_HEADER || 'Basic CHANGEME';

        const { token, cookies } = await fetchSC2CsrfToken(baseUrl, authHeader);

        await axios.patch(
          `${baseUrl}/sap/c4c/api/v1/case-service/cases/${caseId}`,
          sc2Payload,
          {
            headers: {
              'Content-Type'  : 'application/json',
              'Authorization' : authHeader,
              'X-CSRF-Token'  : token,
              'Cookie'        : (cookies || []).join('; ')
            }
          }
        );
      } catch (e) {
        const msg = e.response?.data?.message || e.message;
        LOG.error(`SC2 PATCH failed for case ${caseId}:`, msg);
        return req.error(502, `SC2 update failed: ${msg}`);
      }
    } else {
      LOG.info('[DEV] SC2_DESTINATION not configured. Would have sent:', sc2Payload);
    }

    return {
      status  : 'SUCCESS',
      message : `Case ${caseId} updated with location "${fullName}".`
    };
  });
});
