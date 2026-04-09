'use strict';

const cds = require('@sap/cds');
const LOG = cds.log('location-srv');

function buildFullName(locationName = '', extension = '') {
  const n = (locationName || '').trim();
  const e = (extension   || '').trim();
  if (!n) return e;
  return e ? `${n} (${e})` : n;
}

module.exports = cds.service.impl(async function (srv) {

  let SC2;
  try { SC2 = await cds.connect.to('SC2_DESTINATION'); }
  catch (e) { LOG.warn('SC2_DESTINATION not configured:', e.message); }

  // ── READ Locations — live pass-through to S4HANA ─────────────────────────
  // CAP handles this automatically via the external service projection.

  // ── ACTION: updateCaseLocation ────────────────────────────────────────────
  srv.on('updateCaseLocation', async (req) => {
    const { caseId, locationName, ward, region, extension } = req.data;

    if (!caseId)       return req.error(400, 'caseId is required.');
    if (!locationName) return req.error(400, 'locationName is required.');

    const fullLocationName = buildFullName(locationName, extension);

    const sc2Payload = {
      LocationName_KUT : locationName,
      Ward_KUT         : ward,
      Region_KUT       : region,
      Extension_KUT    : extension
    };

    LOG.info(`Updating SC2 case ${caseId} with location "${fullLocationName}"`);

    if (SC2) {
      try {
        // Resolve base URL: from BTP destination binding in production,
        // or SC2_BASE_URL env var for local dev
        const baseUrl = (
          SC2.options?.credentials?.url ||
          process.env.SC2_BASE_URL       ||
          'http://localhost:4004/mock/sc2'
        ).replace(/\/$/, '');

        // Resolve auth header: from BTP destination binding or env var
        const authHeader = SC2.options?.credentials?.headers?.Authorization ||
                           process.env.SC2_AUTH_HEADER                        ||
                           'Basic CHANGEME';

        const axios = require('axios');

        // Step 1: fetch CSRF token
        const csrfResp = await axios.get(
          `${baseUrl}/sap/c4c/api/v1/case-service/cases`,
          {
            params:  { '$top': 1 },
            headers: { Authorization: authHeader, 'X-CSRF-Token': 'Fetch' }
          }
        );
        const token   = csrfResp.headers['x-csrf-token'];
        const cookies = csrfResp.headers['set-cookie'];

        // Step 2: PATCH the case
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

        LOG.info(`SC2 case ${caseId} updated successfully.`);

      } catch (e) {
        const sc2Error = e.response?.data?.message || e.message;
        LOG.error(`SC2 PATCH failed for case ${caseId}:`, sc2Error);
        return req.error(502, `SC2 update failed: ${sc2Error}`);
      }
    } else {
      LOG.info('[DEV] SC2_DESTINATION not configured. Would have sent:', sc2Payload);
    }

    return {
      status  : 'SUCCESS',
      message : `Case ${caseId} updated with location "${fullLocationName}".`
    };
  });
});
