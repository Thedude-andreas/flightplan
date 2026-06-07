# Datakallor: nulage och vag bort fran PDF-parsning

Senast genomgangen: 2026-06-06.

Malet ar att minska beroendet av nedladdade PDF:er, HTML-scraping och lokala parserantaganden. Prioriteringen bor vara:

1. Anvand befintliga live-API:er dar de redan finns.
2. Byt statisk LFV/eAIP-parsning mot maskinlasbar AIXM/WFS nar atkomst finns.
3. Behall cache och manuell granskningsport for operativt viktiga data.
4. Lamna PDF/HTML som fallback tills en juridiskt och tekniskt hallbar API-kalla ar pa plats.

## Sammanfattning

| Omrade | Nulage | Rekommenderad riktning | Prioritet |
| --- | --- | --- | --- |
| NOTAM / PIB | LFV AROWeb-lista -> PDF -> server-parsning i `notam-briefing` | Utred Eurocontrol MyEAD/AIMSL eller LFV-konsultdata for strukturerad NOTAM. Behall PDF som fallback tills avtal finns. | Hog |
| SIGMET/ARS/AIRMET | LFV AROWeb-lista -> PDF -> server-parsning i `weather-briefing` | Testa AviationWeather.gov `airsigmet`/`isigmet` GeoJSON/JSON for geografiska SIGMET-lager. LFV-PDF kan vara kvar for svensk brieftext/LHP. | Hog |
| LHP routevader | LFV AROWeb HTML `<pre>`-block | Fraga LFV/SMHI om strukturerat LHP/API. Om inget finns: behall HTML-parser men isolera den som explicit fallback. | Medel |
| METAR/TAF | `map-weather-briefing` anvander AviationWeather.gov JSON. Klienten anvander fortfarande SkyVok for vissa fallback-/panelvagar. | Standardisera all METAR/TAF pa AviationWeather.gov-formatet, helst via Supabase-funktionen med en tydlig lokal fallback. Ersatt SkyVok-vagen. | Hog |
| Ytvader / hojdvind / elevation | Open-Meteo JSON fran klient | Bra nog som live-API for planeringsstod. Overvag servercache om anropsvolymen vaxer. | Lag |
| Airspace | LFV Digital AIM WFS GeoJSON | Redan ratt riktning. Utoka fran WFS dar fler lager behovs. | Lag |
| VFR points | LFV Digital AIM WFS GeoJSON | Redan ratt riktning. | Lag |
| Navaids | LFV WFS for VOR/DME/NDB, men radio/frekvensdata fran eAIP HTML/searchIndex | Behall WFS for navaids. Utred AIXM for frekvenser/COM-sektorer. | Medel |
| Flygplatser | AD 1.1/AD 2 via offline eAIP/searchIndex HTML | Utred AIXM/SDO for aerodrome och AD 2-data. LFV AIP Offline kan vara fallback. | Medel |
| Hinder | LFV WFS `mais:OBSE` via `lfv-obstacles` | Redan bra live-API. Jamfor mot AROWeb Dataset vid behov. | Lag |
| Platser/gazetteer | GeoNames `SE.zip` dump | Acceptabel batchkalla. Alternativ: Lantmateriet/OSM om licens och kvalitet motiverar byte. | Lag |
| Luftfartygsregister | Transportstyrelsens HTML-formular med CSRF-token | Fraga Transportstyrelsen om API/export. Annars behall som server-side fallback med tydlig felhantering. | Medel |

## Kallor i nuvarande kod

### LFV AROWeb PDF/HTML

- `supabase/functions/notam-briefing/index.ts`
  - `https://www.aro.lfv.se/Links/Link/ShowFileList?path=%5Cpibsweden%5C&torlinkName=NOTAM+Sweden&type=AIS`
  - Hittar `ESAA FIR VFR 24hr` PDF och extraherar text med `unpdf`.
  - Hamtar eAIP root fran `default_offline.html`, sedan `v2/js/datasource.js` och eSUP-sidor.
- `supabase/functions/weather-briefing/index.ts`
  - `https://www.aro.lfv.se/Links/Link/ShowFileList?type=MET&path=%5CAREA%5CSIGMET%5C&torlinkName=SIGMET%2FARS%2FAIRMET`
  - Hittar SIGMET/ARS/AIRMET PDF och extraherar text.
  - LHP hamtas som HTML via `ViewLink?TorLinkId=...` och parsas fran `<pre class="linkTextNormal">`.

Risk: parsing ar beroende av LFV:s sidstruktur, PDF-textlayout och rubriker. Det ar sarskilt kansligt for NOTAM-geometrier, sidbrytningar och koordinatformat.

### LFV eAIP / AIP Offline

- `scripts/aviation-se/fetch-lfv-aip.mjs`
  - `https://aro.lfv.se/Content/eaip/AIP_OFFLINE.zip`
- `scripts/aviation-se/parse-ad-1.1-airports.mjs`
  - Laster `AD 1.1` och fyller koordinater fran `AD 2`.
  - Fallback via aktuell eAIP `searchIndex.js`.
- `scripts/aviation-se/parse-lfv-radio-nav.mjs`
  - Laster ENR 2.1, ENR 2.2 och AD 2.18 via `searchIndex.js`/HTML.

Risk: fungerar som batchpipeline, men ar inte idealiskt som datakontrakt. `searchIndex.js` ar sokindex, inte ett officiellt API-schema.

### LFV Digital AIM WFS

- `scripts/aviation-se/parse-lfv-wfs-airspaces.mjs`
  - `https://daim.lfv.se/geoserver/ows`
  - Lager: `mais:CTR`, `mais:TMAS`, `mais:TIA`, `mais:TIZ`, `mais:RSTA`, `mais:DNGA`, `mais:ATZ`, `mais:TRA`.
- `scripts/aviation-se/parse-lfv-vfr-points.mjs`
  - Lager: `mais:ECTR`, `mais:VFRH`.
- `scripts/aviation-se/parse-lfv-radio-nav.mjs`
  - Lager: `mais:VOR`, `mais:DMEV`, `mais:DME`, `mais:NDB`.
- `supabase/functions/lfv-obstacles/index.ts`
  - Lager: `mais:OBSE`.

Detta ar basta befintliga LFV-sparet: GeoJSON via WFS, tydliga lager och mindre parsing.

### Vader-API:er

- `supabase/functions/map-weather-briefing/index.ts`
  - `https://aviationweather.gov/api/data/metar`
  - `https://aviationweather.gov/api/data/taf`
  - JSON, batchad per ICAO, kort Supabase-cache.
- `src/features/flightplan/openMeteoAloft.ts`
  - `https://api.open-meteo.com/v1/forecast`
  - Hojdvind fran trycknivaer.
- `src/features/flightplan/openMeteoSurfaceWeather.ts`
  - `https://api.open-meteo.com/v1/forecast`
  - Temperatur och MSL-tryck.
- `src/features/flightplan/openMeteoElevation.ts`
  - `https://api.open-meteo.com/v1/elevation`
- `src/features/flightplan/weather.ts`
  - Anvander `METAR_TAF_API_BASE_URL = 'https://skyvok.com/api'` for klientfallback och vissa panelhamtningar.

METAR/TAF ar redan i ratt lage via AviationWeather.gov for kartvader. SkyVok-vagen ar en onodig extra tredjepartskalla jamfort med befintlig backend och bor ersattas med samma datakontrakt som `map-weather-briefing`.

### Register och ovriga externa kallor

- `supabase/functions/aircraft-registry-lookup/index.ts`
  - Transportstyrelsens soktjanst `https://etjanster-luftfart.transportstyrelsen.se/en-gb/sokluftfartyg`
  - HTML-formular, CSRF-token och HTML-tabellparsning.
- `scripts/aviation-se/parse-geonames-places.mjs`
  - `https://download.geonames.org/export/dump/SE.zip`

## Externa alternativ att utreda

### Eurocontrol EAD / MyEAD

Eurocontrol EAD ar den mest relevanta strukturerade vagen for NOTAM och AIXM-baserad aeronautisk data i Europa. EAD Basic ar inte for operativ anvandning, men MyEAD ger API-atkomst efter avtal och integration.

Relevans:

- NOTAM: ersatt LFV PDF-PIB med strukturerad INO/NOTAM-data.
- AIXM: ersatt delar av eAIP/searchIndex-parsningen for flygplatser, frekvenser, airspace och permanent statisk data.

Konsekvens:

- Kraver sannolikt organisationskonto, avtal, utvecklardokument och eventuellt avgifter beroende pa anvandning.
- Bor hanteras som separat integrationsspike innan kodandring.

Lankar:

- https://www.eurocontrol.int/service/european-ais-database
- https://www.ead.eurocontrol.int/cms-eadbasic/opencms/en/ead-solutions/my-ead/

### LFV AIM-konsult / dataleverans

LFV skriver att de kan tillhandahalla aeronautisk information och dataproducter pa andra satt an AIP, via konsultbasis. Det ar relevant for en svensk-first produkt om MyEAD blir for tungt.

Relevans:

- Strukturerad svensk NOTAM/PIB eller AIP-derived data.
- Eventuellt officiellare hinder/airspace/frekvenspaket an att anvanda publika HTML/PDF-vagar.

Lank:

- https://lfv.se/en/services/information-services/aeronautical-information

### AviationWeather.gov

API:t ar dokumenterat med OpenAPI och stodjer METAR/TAF samt flera varningsprodukter. Det ar redan i bruk for kartvader.

Relevans:

- Behall for METAR/TAF.
- Testa `airsigmet`/`isigmet` i JSON/GeoJSON som ersattning eller komplement till LFV SIGMET-PDF.

Lank:

- https://aviationweather.gov/data/api/

### Open-Meteo

Open-Meteo ar redan en bra JSON-kalla for modellbaserat planeringsvader och elevation. Den ersatter inte officiella aviation briefings, men passar for prestanda- och vindberakning.

Lank:

- https://open-meteo.com/en/docs

## Foreslagen prioriterad backlog

### 1. Ersatt dubbel METAR/TAF-kalla

Status: snabb vinst.

Atgard:

- Spara AviationWeather.gov/Supabase som enda METAR/TAF-vag.
- Ersatt SkyVok-anropen i klientfallback/panelhamtning med AviationWeather.gov-format eller en Supabase-baserad helper.
- Lagga till ett test eller enkel script-check som verifierar att `map-weather-briefing` klarar svenska ICAO-listor.

### 2. Spike: SIGMET via AviationWeather.gov GeoJSON

Status: tekniskt enkel att testa.

Atgard:

- Hamta `airsigmet`/`isigmet` for relevant bbox/FIR om API:t ger europeiska poster for ESAA/kringliggande FIR.
- Jamfor mot LFV PDF for samma tidpunkt.
- Om tackning ar bra: bygg ny parserfri SIGMET-kalla och behall LFV-PDF som fallback/kallank.

### 3. Spike: MyEAD for NOTAM

Status: storst effekt, men kraver atkomst.

Atgard:

- Kontakta Eurocontrol for MyEAD access och Data User Agreement.
- Begar teknisk dokumentation for INO/NOTAM och eventuellt AIMSL/AIXM.
- Nar atkomst finns: bygg separat Supabase-funktion med samma responskontrakt som `notam-briefing`, sa UI:t inte behover byggas om direkt.

### 4. Flytta mer LFV static data fran eAIP HTML till WFS/AIXM

Status: medelstor.

Atgard:

- Lista tillgangliga LFV WFS-lager med `GetCapabilities`.
- Se om flygplatser, frekvenser eller mer AD-data finns i WFS.
- Om inte: anvand AIXM via EAD/MyEAD eller LFV-dataleverans som malbild.
- Behall nuvarande eAIP-pipeline for nightly refresh tills battre data finns.

### 5. Transportstyrelsen-register

Status: bor inte prioriteras fore operativa flygdata.

Atgard:

- Fraga Transportstyrelsen om officiell API/export for luftfartygsregistret.
- Om inget finns: behall HTML-formularparsing server-side, men lagg till tydligare kontraktstest med fixture for tabellformatet.

## Beslutspunkt

Rekommenderad forsta implementation ar inte att riva ut PDF-parsern direkt. Den basta ordningen ar:

1. Standardisera METAR/TAF pa AviationWeather.gov och ersatt SkyVok som extra tredjepartsvag.
2. Testa SIGMET GeoJSON fran AviationWeather.gov mot LFV-PDF.
3. Starta accessprocess for MyEAD eller LFV-dataleverans for NOTAM/AIXM.
4. Nar strukturerad NOTAM finns, byt backendkalla men behall responskontrakt och cache.

Det ger mindre risk i UI och datahantering, samtidigt som de mest skora PDF-delarna fasas ut forst nar en verifierad ersattare finns.
