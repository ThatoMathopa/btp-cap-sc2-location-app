// ─── External S/4HANA OData surface ──────────────────────────────────────────
// Service: ZCDS_GIS_CDS  EntitySet: ZCDS_GIS
@cds.external: true
service S4HANA_DESTINATION {
  @cds.persistence.skip: true
  entity ZCDS_GIS {
    key LocationName : String(255);
        Ward         : String(100);
        Region       : String(100);
        Extension    : String(50);
  }
}
