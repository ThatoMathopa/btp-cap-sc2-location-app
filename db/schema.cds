namespace com.company.locations;

using { cuid, managed } from '@sap/cds/common';

// ─── Cached location records pulled from S/4HANA ────────────────────────────
entity Locations : cuid, managed {
  locationName     : String(255)  @title: 'Location Name';
  ward             : String(100)  @title: 'Ward';
  region           : String(100)  @title: 'Region';
  extension        : String(50)   @title: 'Extension';

  // Computed: "Location Name (Extension)"
  fullLocationName : String(320)  @title: 'Full Location Name'  @readonly;

  // S/4HANA source key — used for delta sync / dedup
  s4LocationId     : String(36)   @title: 'S/4HANA Location ID';
}

// ─── Audit log: which case had which location written into SC2 ───────────────
entity CaseLocationLog : cuid, managed {
  caseId           : String(50)   @title: 'Service Cloud Case ID';
  s4LocationId     : String(36)   @title: 'S/4HANA Location ID';
  locationName     : String(255);
  ward             : String(100);
  region           : String(100);
  extension        : String(50);
  fullLocationName : String(320);
  status           : String(20) default 'PENDING'; // PENDING | SUCCESS | ERROR
  errorMessage     : String(500);
}
