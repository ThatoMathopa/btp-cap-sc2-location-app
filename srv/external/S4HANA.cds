// ─── External S/4HANA OData V2 surface ──────────────────────────────────────
// Service: ZCDS_GIS_CDS  EntitySet: ZCDS_GIS
namespace S4HANA;

@cds.external: true
@cds.persistence.skip: true
entity ZCDS_GIS {
  key LocationName : String(255);
  Ward             : String(100);
  Region           : String(100);
  Extension        : String(50);
}
