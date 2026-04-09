using { com.company.locations as db } from '../db/schema';

// ─────────────────────────────────────────────────────────────────────────────
//  LocationService — consumed by the UI Mashup embedded in Service Cloud V2
// ─────────────────────────────────────────────────────────────────────────────
service LocationService @(path: '/odata/v4/location') {

  // ── Searchable location list (read from HANA cache) ───────────────────────
  @readonly
  entity Locations as projection on db.Locations;

  // ── Audit log (admin view) ────────────────────────────────────────────────
  @readonly
  entity CaseLocationLog as projection on db.CaseLocationLog;

  // ── Actions ───────────────────────────────────────────────────────────────

  // Pull latest locations from S/4HANA into local HANA cache
  action syncFromS4() returns String;

  // Write selected location into Service Cloud V2 extension fields on a case
  action updateCaseLocation(
    caseId       : String,   // SC2 Case UUID / ObjectID
    locationId   : String    // ID from Locations entity
  ) returns {
    status       : String;
    message      : String;
  };
}

// ─── UI Annotations (Fiori Elements / mashup table) ─────────────────────────
annotate LocationService.Locations with @(

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: fullLocationName, Label: 'Full Location Name' },
    { $Type: 'UI.DataField', Value: locationName,     Label: 'Location Name'      },
    { $Type: 'UI.DataField', Value: ward,             Label: 'Ward'               },
    { $Type: 'UI.DataField', Value: region,           Label: 'Region'             },
    { $Type: 'UI.DataField', Value: extension,        Label: 'Extension'          }
  ],

  UI.HeaderInfo: {
    TypeName:       'Location',
    TypeNamePlural: 'Locations',
    Title:       { Value: fullLocationName },
    Description: { Value: region }
  },

  UI.SelectionFields: [ fullLocationName, locationName, ward, region ]

) {
  fullLocationName @Search.defaultSearchElement: true;
  locationName     @Search.defaultSearchElement: true;
  ward             @Search.defaultSearchElement: true;
  region           @Search.defaultSearchElement: true;
};
