// No local entities — all data fetched live from S4HANA and SC2

service LocationService @(path: '/odata/v4/location') {

  // Search locations live from S4HANA
  action searchLocations(
    query  : String,
    ward   : String,
    region : String
  ) returns array of {
    LocationName : String;
    Ward         : String;
    Region       : String;
    Extension    : String;
  };

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
