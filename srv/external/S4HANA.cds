// ─── External S/4HANA OData surface ──────────────────────────────────────────
// Service: ZCDS_GIS_CDS  EntitySet: ZCDS_GIS
// Fields as returned by the OData service (lowercase from ABAP CDS view)
namespace S4HANA;

@cds.external: true
@cds.persistence.skip: true
entity ZCDS_GIS {
  key name      : String(255);
      ward      : String(100);
      region    : String(100);
      extension : String(50);
}
