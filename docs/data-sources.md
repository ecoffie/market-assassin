# Federal Data Sources for GovCon Products

Reference for building future GovCon tools using federal open data APIs.

---

## Currently Integrated

| Dataset | Source | API | Status |
|---------|--------|-----|--------|
| Contract Opportunities | SAM.gov | `api.sam.gov/opportunities` | ✅ Live |
| Entity Management | SAM.gov | `api.sam.gov/entity-information` | ✅ Live |
| Contract Awards | USASpending | `api.usaspending.gov` | ✅ Live |
| Federal Hierarchy | SAM.gov | `api.sam.gov/hierarchy` | ✅ Live |
| Subaward Reporting | SAM.gov | `api.sam.gov/subawards` | ⏳ Waiting (System Account) |

---

## Data Catalogs

| Catalog | URL | Description |
|---------|-----|-------------|
| Data.gov | https://catalog.data.gov/dataset/ | Central repository for all federal open data |
| GSA Open Tech | https://open.gsa.gov/api/ | GSA API documentation |
| USASpending | https://api.usaspending.gov | Federal spending data |
| SAM.gov Data Services | https://sam.gov/data-services | SAM file extracts and APIs |

---

## Future Product Ideas

### 1. SBIR/STTR Opportunity Finder
**Data Source:** SBIR.gov API, SBA datasets
**Use Case:** Find R&D funding opportunities for small businesses
**Datasets:**
- SBIR/STTR Awards: https://www.sbir.gov/api
- SBA Data: https://catalog.data.gov/organization/sba-gov

### 2. GSA Schedule Vehicle Matcher
**Data Source:** GSA Advantage, Schedule Sales Data
**Use Case:** Match contractors to available contract vehicles
**Datasets:**
- GSA Schedules: https://catalog.data.gov/dataset?organization=gsa-gov
- GSA eLibrary: https://www.gsaelibrary.gsa.gov/

### 3. Win Rate Calculator
**Data Source:** USASpending historical awards
**Use Case:** Calculate win probability based on past performance
**Datasets:**
- Award History: https://api.usaspending.gov/api/v2/awards/
- Recipient Profiles: https://api.usaspending.gov/api/v2/recipient/

### 4. Teaming Network Mapper
**Data Source:** USASpending Subawards, SAM.gov Subaward API
**Use Case:** Visualize prime-sub relationships for teaming opportunities
**Datasets:**
- Subawards: https://api.usaspending.gov/api/v2/subawards/
- SAM Subaward: https://api.sam.gov/subawards (requires System Account)

### 5. Certification Tracker
**Data Source:** SBA Dynamic Small Business Search, SAM.gov Entity
**Use Case:** Track 8(a), SDVOSB, WOSB, HUBZone certifications
**Datasets:**
- SBA DSBS: https://web.sba.gov/pro-net/search/dsp_dsbs.cfm
- SAM Entity: https://api.sam.gov/entity-information

### 6. Budget Intel Tool
**Data Source:** USASpending Budget Authority, OMB Data
**Use Case:** Forecast agency spending by NAICS/PSC
**Datasets:**
- Budget Authority: https://api.usaspending.gov/api/v2/budget_authority/
- Agency Budgets: Already cached in `src/data/agency-budget-data.json`

### 7. Set-Aside Opportunity Analyzer
**Data Source:** SAM.gov Opportunities, FPDS historical
**Use Case:** Analyze set-aside trends by agency, NAICS
**Datasets:**
- Opportunities: https://api.sam.gov/opportunities
- Set-aside codes in opportunity data

### 8. Incumbent Intelligence
**Data Source:** USASpending Awards, FPDS
**Use Case:** Identify incumbents on expiring contracts
**Datasets:**
- Award Details: https://api.usaspending.gov/api/v2/awards/{id}/
- `latest_transaction_contract_data.number_of_offers_received` for bid counts

---

## API Key Sources

| API | Key Source | Rate Limit |
|-----|------------|------------|
| SAM.gov (Public) | https://api.data.gov/signup/ | 1,000/day |
| SAM.gov (System Account) | SAM.gov Workspace | 10,000/day |
| USASpending | No key required | Generous |
| SBIR.gov | https://www.sbir.gov/api | Unknown |
| Data.gov CKAN | https://catalog.data.gov | No key |

---

## Top Federal Data Publishers

| Agency | Datasets | GovCon Relevance |
|--------|----------|------------------|
| Census Bureau | 144,572 | Demographic targeting |
| NOAA | 94,680 | Environmental contracts |
| DOI | 44,399 | Land/resource contracts |
| NASA | 34,770 | Tech/R&D contracts |
| HHS | 19,631 | Healthcare contracts |
| DoD | Various | Defense contracts |
| GSA | Various | Schedules, vehicles |
| SBA | Various | Small biz programs |

---

## Quick Links

- **Data.gov API Docs:** https://docs.ckan.org/en/2.11/api/index.html
- **SAM.gov API Docs:** https://open.gsa.gov/api/
- **USASpending API Docs:** https://api.usaspending.gov/docs/
- **Federal Service Desk:** https://www.fsd.gov (for SAM.gov support)

---

*Last Updated: March 29, 2026*
