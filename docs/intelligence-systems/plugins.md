# Intelligence System Plugins

> External integrations and data source connectors

## Overview

Plugins are modular connectors to external data sources and services. Each plugin abstracts the complexity of interacting with a specific API or data format.

---

## Plugin 1: USASpending Plugin

### Purpose
Query federal contract award data from USASpending.gov API.

### Capabilities
- Contract awards search by NAICS, agency, date range
- Spending aggregations by agency, contractor, NAICS
- Award details with obligation amounts
- Recipient (contractor) information

### Configuration
```typescript
// src/lib/plugins/usaspending/config.ts

interface USASpendingConfig {
  baseUrl: string;           // https://api.usaspending.gov
  timeout: number;           // 30000ms
  retries: number;           // 3
  cacheEnabled: boolean;     // true
  cacheTTL: number;          // 86400 (24 hours)
}

const defaultConfig: USASpendingConfig = {
  baseUrl: 'https://api.usaspending.gov',
  timeout: 30000,
  retries: 3,
  cacheEnabled: true,
  cacheTTL: 86400
};
```

### Methods
```typescript
// src/lib/plugins/usaspending/index.ts

interface USASpendingPlugin {
  // Contract search
  searchContracts(params: ContractSearchParams): Promise<ContractResult[]>;

  // Spending aggregations
  getSpendingByAgency(naics: string, years: number): Promise<AgencySpending[]>;
  getSpendingByContractor(naics: string, state?: string): Promise<ContractorSpending[]>;

  // Expiring contracts (for recompete)
  getExpiringContracts(params: ExpiringContractParams): Promise<ExpiringContract[]>;

  // Award details
  getAwardDetails(awardId: string): Promise<AwardDetail>;
}

interface ExpiringContractParams {
  naics?: string;
  agency?: string;
  state?: string;
  expiringWithinMonths: number;
  minValue?: number;
  setAside?: string;
}
```

### Usage
```typescript
import { usaspending } from '@/lib/plugins/usaspending';

// Get contracts expiring in next 18 months
const expiring = await usaspending.getExpiringContracts({
  naics: '541512',
  expiringWithinMonths: 18,
  minValue: 100000
});

// Get spending by agency
const spending = await usaspending.getSpendingByAgency('541512', 3);
```

### Status
✅ **Implemented** via MCP tool `mcp__usaspending__search_contracts`

---

## Plugin 2: SAM.gov Plugin

### Purpose
Query opportunities and entity data from SAM.gov APIs.

### Capabilities
- Opportunity search (RFP, RFQ, Sources Sought, etc.)
- Entity lookup (contractor registration)
- Forecasts (planned procurements)

### Configuration
```typescript
// src/lib/plugins/samgov/config.ts

interface SAMGovConfig {
  apiKey: string;            // Required
  baseUrl: string;           // https://api.sam.gov
  opportunitiesPath: string; // /opportunities/v2
  entityPath: string;        // /entity-information/v3
  rateLimit: {
    requestsPerMinute: number;  // 10
    requestsPerDay: number;     // 1000
  };
}
```

### Methods
```typescript
// src/lib/plugins/samgov/index.ts

interface SAMGovPlugin {
  // Opportunities
  searchOpportunities(params: OpportunityParams): Promise<Opportunity[]>;
  getOpportunityDetails(noticeId: string): Promise<OpportunityDetail>;

  // Entity
  searchEntities(params: EntityParams): Promise<Entity[]>;
  getEntityByUEI(uei: string): Promise<EntityDetail>;

  // Forecasts
  getForecasts(params: ForecastParams): Promise<Forecast[]>;

  // Health check
  checkHealth(): Promise<HealthStatus>;
}

interface OpportunityParams {
  naics?: string;           // Single NAICS (no commas!)
  keywords?: string;
  state?: string;
  setAside?: string;
  postedFrom?: string;      // MM/dd/yyyy format
  postedTo?: string;
  noticeType?: string[];    // ['p', 'r', 'k', 'o', 's', 'i']
}
```

### Important Rules
```typescript
// ⚠️ SAM.gov API does NOT support comma-separated NAICS
// WRONG: naics: '541512,541611'
// RIGHT: Make parallel requests for each NAICS

async function searchMultipleNaics(naicsCodes: string[]): Promise<Opportunity[]> {
  const results = await Promise.all(
    naicsCodes.map(naics => samgov.searchOpportunities({ naics }))
  );
  return deduplicateByNoticeId(results.flat());
}
```

### Status
✅ **Implemented** via MCP tool `mcp__samgov__search_opportunities`

---

## Plugin 3: Grants.gov Plugin

### Purpose
Query grant opportunities from Grants.gov public API.

### Capabilities
- Grant search by keyword, agency, category
- Grant details
- Forecasted grants
- Agency listing

### Configuration
```typescript
// src/lib/plugins/grantsgov/config.ts

interface GrantsGovConfig {
  baseUrl: string;           // https://apply07.grants.gov
  searchEndpoint: string;    // /grantsws/rest/opportunities/search
  timeout: number;           // 30000
  // No API key required - public API
}
```

### Methods
```typescript
// src/lib/plugins/grantsgov/index.ts

interface GrantsGovPlugin {
  searchGrants(params: GrantSearchParams): Promise<Grant[]>;
  getGrantDetails(oppNumber: string): Promise<GrantDetail>;
  searchForecasted(params: GrantSearchParams): Promise<Grant[]>;
  listAgencies(): Promise<Agency[]>;
  listCategories(): Promise<Category[]>;
  checkHealth(): Promise<HealthStatus>;
}

interface GrantSearchParams {
  keyword?: string;
  agency?: string;           // HHS, DOD, NSF, etc.
  category?: string;         // HL (Health), ST (Science/Tech), etc.
  status?: string;           // posted, forecasted, closed, archived
  rows?: number;             // Default: 25, max: 100
}
```

### Status
✅ **Implemented** via MCP tool `mcp__grantsgov__search_grants`

---

## Plugin 4: Multisite Aggregator Plugin

### Purpose
Query aggregated opportunities from NIH, DARPA, NSF, DOE labs, and other sources.

### Capabilities
- Unified search across 10+ sources
- Source health monitoring
- Manual scrape triggering
- NIH RePORTER direct queries

### Methods
```typescript
// src/lib/plugins/multisite/index.ts

interface MultisitePlugin {
  searchMultisite(params: MultisiteParams): Promise<AggregatedOpportunity[]>;
  getSourceHealth(): Promise<SourceHealth[]>;
  getStats(): Promise<MultisiteStats>;
  searchNIH(params: NIHParams): Promise<NIHProject[]>;
  triggerScrape(source: string, dryRun?: boolean): Promise<ScrapeResult>;
  listSources(): Promise<Source[]>;
}

interface MultisiteParams {
  keywords?: string;
  naics?: string;
  source?: string;           // 'nih_reporter', 'darpa_baa', etc.
  opportunityType?: string;  // 'solicitation', 'grant', 'sbir_sttr'
  postedFrom?: string;
  closingAfter?: string;
  setAside?: string;
  state?: string;
}
```

### Status
✅ **Implemented** via MCP tool `mcp__multisite__search_multisite`

---

## Plugin 5: Agency Scraper Plugin

### Purpose
Scrape agency-specific portals for forecasts and opportunities.

### Target Sites
| Agency | Portal | Auth Required |
|--------|--------|---------------|
| GSA | acquisitiongateway.gov | No |
| DHS | apfs-cloud.dhs.gov | No |
| VA | va.gov/osdbu | No |
| Navy | neco.navy.mil | Yes (CAGE) |
| Army | army.mil/smallbusiness | No |
| Air Force | sbo.afmc.af.mil | No |

### Configuration
```typescript
// src/lib/plugins/agency-scraper/config.ts

interface ScraperConfig {
  headless: boolean;         // true for production
  timeout: number;           // 60000ms
  userAgent: string;         // Custom UA
  proxy?: string;            // Optional proxy
  retries: number;           // 3
}
```

### Methods
```typescript
// src/lib/plugins/agency-scraper/index.ts

interface AgencyScraperPlugin {
  scrapeForecasts(agency: string): Promise<ScrapedForecast[]>;
  scrapeEvents(source: string): Promise<ScrapedEvent[]>;
  getLastScrapeTime(source: string): Promise<Date>;
}
```

### Scraper Implementations
```typescript
// Each agency has a custom scraper due to different page structures

// src/lib/plugins/agency-scraper/scrapers/gsa.ts
async function scrapeGSAForecast(page: Page): Promise<ScrapedForecast[]> {
  await page.goto('https://acquisitiongateway.gov/forecast');
  await page.waitForSelector('.forecast-table');
  // Extract table data...
}

// src/lib/plugins/agency-scraper/scrapers/dhs.ts
async function scrapeDHSForecast(page: Page): Promise<ScrapedForecast[]> {
  await page.goto('https://apfs-cloud.dhs.gov');
  // Different structure...
}
```

### Status
📋 **Planned** - Requires Puppeteer setup

---

## Plugin 6: PDF Extractor Plugin

### Purpose
Extract structured data from Congressional Budget Justifications and other PDFs.

### Capabilities
- PDF text extraction
- Table recognition
- AI-assisted program identification
- Dollar amount extraction

### Configuration
```typescript
// src/lib/plugins/pdf-extractor/config.ts

interface PDFExtractorConfig {
  aiModel: string;           // 'gpt-4o' or 'claude-3'
  maxPages: number;          // 100
  tableRecognition: boolean; // true
}
```

### Methods
```typescript
// src/lib/plugins/pdf-extractor/index.ts

interface PDFExtractorPlugin {
  extractText(buffer: Buffer): Promise<string>;
  extractTables(buffer: Buffer): Promise<Table[]>;
  extractPrograms(buffer: Buffer, agency: string): Promise<BudgetProgram[]>;
}
```

### Status
📋 **Planned** - Requires pdf-parse and AI integration

---

## Plugin 7: Stripe Plugin

### Purpose
Customer and subscription management for intelligence products.

### Capabilities
- Customer lookup by email
- Subscription status checks
- Payment history
- Revenue reporting

### Methods
```typescript
// Already implemented via MCP

interface StripePlugin {
  searchCustomers(email: string): Promise<Customer[]>;
  getCustomer(customerId: string): Promise<CustomerDetail>;
  checkSubscription(email: string): Promise<Subscription>;
  listPayments(customerId: string): Promise<Payment[]>;
  getRevenueReport(days: number): Promise<RevenueReport>;
}
```

### Status
✅ **Implemented** via MCP tool `mcp__stripe__check_subscription`

---

## Plugin 8: Vimeo Plugin

### Purpose
Video upload and management for training content.

### Methods
```typescript
// Already implemented via MCP

interface VimeoPlugin {
  upload(filePath: string, name: string): Promise<Video>;
  bulkUpload(directory: string, pattern: string): Promise<Video[]>;
  listVideos(folderId?: string): Promise<Video[]>;
  updateVideo(videoId: string, metadata: VideoMetadata): Promise<Video>;
}
```

### Status
✅ **Implemented** via MCP tool `mcp__vimeo__vimeo_upload`

---

## Plugin Registry

| Plugin | Status | MCP Tool | Use Case |
|--------|--------|----------|----------|
| USASpending | ✅ Live | `usaspending-mcp` | Spending analysis, recompetes |
| SAM.gov | ✅ Live | `samgov-mcp` | Opportunities, entities |
| Grants.gov | ✅ Live | `grantsgov-mcp` | Grant opportunities |
| Multisite | ✅ Live | `multisite-mcp` | NIH, DARPA, aggregated |
| Agency Scraper | 📋 Planned | None | Agency forecasts |
| PDF Extractor | 📋 Planned | None | Budget intelligence |
| Stripe | ✅ Live | `stripe-mcp` | Customer management |
| Vimeo | ✅ Live | `vimeo-mcp` | Video content |

---

## Adding New Plugins

```typescript
// src/lib/plugins/template/index.ts

import { PluginBase, PluginConfig, PluginHealth } from '@/lib/plugins/types';

interface MyPluginConfig extends PluginConfig {
  customOption: string;
}

export class MyPlugin extends PluginBase<MyPluginConfig> {
  async initialize(): Promise<void> {
    // Setup connection, validate config
  }

  async healthCheck(): Promise<PluginHealth> {
    return {
      status: 'healthy',
      latency: 100,
      lastChecked: new Date()
    };
  }

  async myMethod(params: MyParams): Promise<MyResult> {
    // Implementation
  }
}

export const myPlugin = new MyPlugin(config);
```

---

*Last Updated: April 5, 2026*
