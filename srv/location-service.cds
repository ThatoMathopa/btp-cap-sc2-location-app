using { S4HANA } from './external/S4HANA';

// ─────────────────────────────────────────────────────────────────────────────
//  LocationService — live pass-through to S4HANA, no local DB
// ─────────────────────────────────────────────────────────────────────────────
service LocationService @(path: '/odata/v4/location') {

  // Live read from S4HANA — no cache
  @readonly
  entity Locations as projection on S4HANA.ZCDS_GIS;

  // Write selected location into SC2 case extension fields
  action updateCaseLocation(
    caseId       : String,
    locationName : String,
    ward         : String,
    region       : String,
    extension    : String
  ) returns {
    status  : String;
    message : String;
  };
}

// ─── UI Annotations ──────────────────────────────────────────────────────────
annotate LocationService.Locations with @(

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: LocationName, Label: 'Location Name' },
    { $Type: 'UI.DataField', Value: Ward,         Label: 'Ward'          },
    { $Type: 'UI.DataField', Value: Region,       Label: 'Region'        },
    { $Type: 'UI.DataField', Value: Extension,    Label: 'Extension'     }
  ],

  UI.SelectionFields: [ LocationName, Ward, Region ]

) {
  LocationName @Search.defaultSearchElement: true;
  Ward         @Search.defaultSearchElement: true;
  Region       @Search.defaultSearchElement: true;
};
