'use strict';
const cds = require('@sap/cds');

cds.on('bootstrap', (app) => {
  if (process.env.NODE_ENV === 'production') return;

  // ── Mock S/4HANA LocationSet ─────────────────────────────────────────────
  app.get('/mock/s4/ZCDS_GIS', (_req, res) => {
    res.json({ value: [
      { LocationId:'LOC-001', LocationName:'City Hall',             Ward:'Ward A', Region:'North',   Extension:'EXT-100' },
      { LocationId:'LOC-002', LocationName:'Community Centre',      Ward:'Ward B', Region:'South',   Extension:'EXT-200' },
      { LocationId:'LOC-003', LocationName:'Public Library',        Ward:'Ward A', Region:'East',    Extension:'EXT-300' },
      { LocationId:'LOC-004', LocationName:'Sports Complex',        Ward:'Ward C', Region:'West',    Extension:'EXT-400' },
      { LocationId:'LOC-005', LocationName:'Health Clinic',         Ward:'Ward D', Region:'North',   Extension:'EXT-500' },
      { LocationId:'LOC-006', LocationName:'Fire Station 3',        Ward:'Ward B', Region:'South',   Extension:'EXT-600' },
      { LocationId:'LOC-007', LocationName:'Police Precinct 7',     Ward:'Ward C', Region:'East',    Extension:''        },
      { LocationId:'LOC-008', LocationName:'Water Treatment Plant', Ward:'Ward E', Region:'West',    Extension:'EXT-800' },
      { LocationId:'LOC-009', LocationName:'Recycling Depot',       Ward:'Ward F', Region:'North',   Extension:'EXT-900' },
      { LocationId:'LOC-010', LocationName:'Parks Office',          Ward:'Ward A', Region:'Central', Extension:'EXT-010' }
    ]});
  });

  // ── Mock SC2 Case PATCH (returns CSRF token on GET, accepts PATCH) ────────
  app.get('/mock/sc2/sap/c4c/api/v1/case-service/cases', (_req, res) => {
    res.set('X-CSRF-Token', 'mock-csrf-token-dev');
    res.json({ value: [] });
  });

  app.patch('/mock/sc2/sap/c4c/api/v1/case-service/cases/:id', (req, res) => {
    cds.log('mock-sc2').info(`[MOCK SC2] PATCH case ${req.params.id}:`, req.body);
    res.status(204).send();
  });

  cds.log('server').info('Mock endpoints active: /mock/s4 and /mock/sc2');
});

module.exports = cds.server;
