# BTP CAP — S/4HANA Location Search + Service Cloud V2 Case Extension Field Update

A full-stack SAP BTP application that:
1. Pulls location data from S/4HANA via OData V2
2. Caches it in SAP HANA Cloud for fast search
3. Embeds a searchable UI as a **URL Mashup** inside a Service Cloud V2 Case
4. Writes the selected location back to **extension fields** on the SC2 case via REST API

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SAP Service Cloud Version 2                          │
│                                                                               │
│   ┌────────────────────────────────────────────────────────────────────┐     │
│   │  Case Detail Page                                                   │     │
│   │                                                                     │     │
│   │   Standard fields          │   URL Mashup (iFrame)                 │     │
│   │   ─────────────────        │   ─────────────────────────────────   │     │
│   │   Case ID: CS-10001        │   [ Search locations...          ]    │     │
│   │   Status:  Open            │   Ward ▾   Region ▾   [Reset]        │     │
│   │                            │   ┌──────────────────────────────┐   │     │
│   │   Extension fields         │   │ City Hall (EXT-100)   [Use]  │   │     │
│   │   (written by this app):   │   │ Library   (EXT-300)   [Use]  │   │     │
│   │   locationName_KUT ──────◄─┼───│ Health Clinic         [Use]  │   │     │
│   │   ward_KUT          ──────◄┼───│ ...                          │   │     │
│   │   region_KUT        ──────◄┼───└──────────────────────────────┘   │     │
│   │   extensionField_KUT ─────◄┼───                                    │     │
│   │   fullLocationName_KUT ───◄┼───                                    │     │
│   └────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
                │  REST PATCH /case-service/cases/{caseId}
                ▼
┌───────────────────────────────────────────────────────────┐
│                     SAP BTP                               │
│                                                           │
│   ┌──────────────────────────────────────────────────┐   │
│   │           CAP Node.js Service                    │   │
│   │        /odata/v4/location                        │   │
│   │                                                  │   │
│   │   Actions:                                       │   │
│   │   • syncFromS4()          ──────────────────┐   │   │
│   │   • updateCaseLocation()  ──► SC2 PATCH ─┐  │   │   │
│   └──────────────────────────────────────────┼──┼───┘   │
│                                              │  │        │
│   ┌─────────────────────┐                   │  │        │
│   │  SAP HANA Cloud     │                   │  │        │
│   │  Locations (cache)  │◄──────────────────┘  │        │
│   │  CaseLocationLog    │                       │        │
│   └─────────────────────┘                       │        │
│                                                 │        │
│   ┌──────────────────────────┐                  │        │
│   │  BTP Destination Service │◄─────────────────┘        │
│   │  S4HANA_DESTINATION      │                            │
│   │  SC2_DESTINATION         │                            │
│   └──────────┬───────────────┘                            │
└──────────────┼────────────────────────────────────────────┘
               │
     ┌─────────┴──────────┐
     │                    │
     ▼                    ▼
┌──────────┐      ┌───────────────────┐
│ S/4HANA  │      │ Service Cloud V2  │
│ Location │      │ Case REST API     │
│ OData V2 │      │ (extension fields)│
└──────────┘      └───────────────────┘
```

---

## Project Structure

```
btp-cap-sc2-location-app/
├── db/
│   └── schema.cds                        # Locations cache + CaseLocationLog
├── srv/
│   ├── external/
│   │   └── S4HANA.cds                    # External OData model (S/4HANA surface)
│   ├── location-service.cds              # OData V4 service + Fiori annotations
│   ├── location-service.js               # Handler: sync, computed field, SC2 PATCH
│   └── server.js                         # Mock S4 + SC2 endpoints for local dev
├── app/
│   └── mashup/
│       └── webapp/
│           ├── Component.js
│           ├── manifest.json
│           ├── index.html
│           ├── controller/
│           │   ├── App.controller.js
│           │   └── LocationMashup.controller.js  # Live search, SC2 update, URL params
│           ├── view/
│           │   ├── App.view.xml
│           │   └── LocationSearch.view.xml       # Search bar + filter + table
│           └── i18n/
│               └── i18n.properties
├── mta.yaml                              # BTP Multi-Target App deployment
├── xs-security.json                      # XSUAA roles & scopes
├── package.json
├── .cdsrc.json
└── .env.example
```

---

## Computed Field

`fullLocationName` is built server-side on every sync and stored in HANA:

```
"City Hall"      + "EXT-100"  →  "City Hall (EXT-100)"
"Police Station" + ""         →  "Police Station"
```

It is also written to `fullLocationName_KUT` on the SC2 case.

---

## Service Cloud V2 Extension Fields

### Step 1 — Create extension fields in SC2

Go to **Settings → Extensibility Administration**, select the **Case** business object,
and create these fields (all type `Text`):

| Field Label        | Technical Name (API)    | Type   |
|--------------------|-------------------------|--------|
| Location Name      | `locationName_KUT`      | Text   |
| Ward               | `ward_KUT`              | Text   |
| Region             | `region_KUT`            | Text   |
| Extension          | `extensionField_KUT`    | Text   |
| Full Location Name | `fullLocationName_KUT`  | Text   |

> The `_KUT` suffix stands for **Key User Tool** — SAP adds it automatically for extension fields.

### Step 2 — Expose extension fields on the Case layout

1. Open a Case in SC2
2. Click **Adapt → Edit Master Layout**
3. Drag the five fields from the field panel onto the Case detail section
4. Save and publish the layout

### Step 3 — Register the URL Mashup in SC2

1. Go to **Settings → Mashup Authoring → URL Mashup**
2. Click **New**
3. Fill in:
   - **Mashup Name**: `Location Search`
   - **URL**: `https://<your-btp-app-url>/index.html?caseId={CaseId}`
   - **Port Binding**: bind `{CaseId}` to the Case `ID` field
4. Save and activate

### Step 4 — Embed mashup on the Case page

1. Open a Case, enter Adaptation Mode
2. Add a new **Section** to the page
3. Inside the section, add a **Mashup** element
4. Select your **Location Search** mashup
5. Publish the page layout

---

## Local Development

### Prerequisites
- Node.js ≥ 20
- `@sap/cds-dk` globally: `npm install -g @sap/cds-dk`

### Run locally

```bash
git clone <repo-url>
cd btp-cap-sc2-location-app
npm install
cds watch
```

| URL | What it does |
|-----|-------------|
| `http://localhost:4004` | CAP index page |
| `http://localhost:4004/odata/v4/location/Locations` | OData endpoint |
| `http://localhost:4004/mashup/webapp/index.html` | UI Mashup (no caseId) |
| `http://localhost:4004/mashup/webapp/index.html?caseId=CS-10001` | UI Mashup with mock case |
| `http://localhost:4004/mock/s4/LocationSet` | Mock S/4HANA data |
| `http://localhost:4004/mock/sc2/sap/c4c/api/v1/case-service/cases` | Mock SC2 endpoint |

### Load mock data (first-time setup)

Open the OData service and call the sync action:

```bash
curl -X POST http://localhost:4004/odata/v4/location/syncFromS4
```

Or click the **Sync from S/4HANA** button in the UI.

---

## OData API Reference

### Read locations

```
GET /odata/v4/location/Locations
GET /odata/v4/location/Locations?$filter=contains(fullLocationName,'Hall')
GET /odata/v4/location/Locations?$filter=ward eq 'Ward A' and region eq 'North'
GET /odata/v4/location/Locations?$search=clinic
GET /odata/v4/location/Locations?$orderby=fullLocationName asc&$top=10
```

### Sync from S/4HANA

```
POST /odata/v4/location/syncFromS4
Content-Type: application/json
```

### Update case extension fields

```
POST /odata/v4/location/updateCaseLocation
Content-Type: application/json

{
  "caseId": "CS-10001",
  "locationId": "LOC-001"
}
```

Response:
```json
{
  "status": "SUCCESS",
  "message": "Case CS-10001 updated with location \"City Hall (EXT-100)\"."
}
```

### Audit log

```
GET /odata/v4/location/CaseLocationLog
GET /odata/v4/location/CaseLocationLog?$filter=caseId eq 'CS-10001'
GET /odata/v4/location/CaseLocationLog?$filter=status eq 'ERROR'
```

---

## BTP Deployment

### 1. Configure destinations in `mta.yaml`

**S/4HANA destination:**
```yaml
- Name:           S4HANA_DESTINATION
  URL:            https://<s4hana-host>/sap/opu/odata/sap/API_LOCATION_SRV
  Authentication: BasicAuthentication        # or OAuth2SAMLBearerAssertion
  User:           <user>
  Password:       <password>
  ProxyType:      OnPremise                  # OnPremise = Cloud Connector
                                             # Internet  = Cloud S/4HANA
  sap-client:     "100"
```

**Service Cloud V2 destination:**
```yaml
- Name:            SC2_DESTINATION
  URL:             https://<tenant>.crm.cloud.sap
  Authentication:  OAuth2ClientCredentials
  tokenServiceURL: https://<tenant>.authentication.<region>.hana.ondemand.com/oauth/token
  clientId:        <client-id>
  clientSecret:    <client-secret>
```

### 2. Build and deploy

```bash
# Install MBT build tool (once)
npm install -g mbt

# Build the MTA archive
mbt build -t ./mta_archives

# Log in to Cloud Foundry
cf login -a <api-endpoint> -o <org> -s <space>

# Deploy
cf deploy ./mta_archives/btp-cap-sc2-location-app_1.0.0.mtar
```

### 3. Assign role collections in BTP Cockpit

| Role Collection        | Who gets it                        |
|------------------------|------------------------------------|
| `Location_Viewer`      | Agents who only need to search     |
| `Location_CaseUpdater` | Agents who update case fields      |

---

## Adapting to Your S/4HANA Service

If your S/4HANA OData entity or field names differ, update two files:

**`srv/external/S4HANA.cds`** — match your EDMX:
```cds
entity LocationSet {
  key LocationId   : String(36);
  LocationName     : String(255);
  Ward             : String(100);
  Region           : String(100);
  Extension        : String(50);
}
```

**`srv/location-service.js`** — update the field mapping in `syncFromS4`:
```js
const rows = s4Records.map((r) => ({
  ID               : r.LocationId,       // ← your key field
  locationName     : r.LocationName,     // ← your name field
  ward             : r.Ward,             // ← your ward field
  region           : r.Region,           // ← your region field
  extension        : r.Extension,        // ← your extension field
  fullLocationName : buildFullName(r.LocationName, r.Extension)
}));
```

## Adapting Extension Field Names

If your SC2 extension fields have different technical names, update the payload
in `srv/location-service.js` inside `updateCaseLocation`:

```js
const sc2Payload = {
  locationName_KUT     : loc.locationName,      // ← your field name
  ward_KUT             : loc.ward,
  region_KUT           : loc.region,
  extensionField_KUT   : loc.extension,
  fullLocationName_KUT : loc.fullLocationName
};
```

---

## How the Case ID flows into the Mashup

Service Cloud V2 URL mashups support **parameter binding**. When you register the
mashup URL as:

```
https://<app-url>/index.html?caseId={CaseId}
```

SC2 replaces `{CaseId}` with the actual case ID at runtime before loading the iFrame.
The controller reads it with:

```javascript
_getUrlParam('caseId')  // → e.g. "8a80cb8193d24b890193d4cb123a0001"
```

This ID is then passed to the `updateCaseLocation` CAP action which calls the SC2
REST API to PATCH the case.
