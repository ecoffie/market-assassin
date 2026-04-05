# Component Registry

> Master index of all skills, tools, and agents in the Federal Market Scanner system

## Quick Reference

| Type | Count | Status |
|------|-------|--------|
| Skills (Slash Commands) | 11 defined | 2 built, 9 planned |
| MCP Tools | 8 configured | 1 to build |
| Agents | 5 defined | 0 built (spec only) |

---

## Skills (Slash Commands)

### Core Market Intelligence

| Skill | Purpose | Status | Spec |
|-------|---------|--------|------|
| `/market-scan` | Full market analysis (NAICS + state) | Planned | [market-scan-spec.md](~/.claude/skill-specs/market-scan-spec.md) |
| `/visibility-gap` | SAM vs USASpending comparison | Planned | [visibility-gap-spec.md](~/.claude/skill-specs/visibility-gap-spec.md) |
| `/recompete-analysis` | Expiring contract tracking | Planned | [recompete-analysis-spec.md](~/.claude/skill-specs/recompete-analysis-spec.md) |
| `/competitor-profile` | Competitor intelligence | Planned | TBD |
| `/spending-analysis` | Deep dive on spending patterns | Planned | TBD |

### Discovery & Events

| Skill | Purpose | Status | Spec |
|-------|---------|--------|------|
| `/event-discovery` | Find relevant federal events | Planned | [event-discovery-spec.md](~/.claude/skill-specs/event-discovery-spec.md) |
| `/forecast-scan` | Upcoming procurements | Planned | TBD |
| `/grant-scan` | Grants.gov opportunities | Planned | TBD |

### Operations

| Skill | Purpose | Status | Spec |
|-------|---------|--------|------|
| `/multisite-status` | Health check for all sources | Built | [multisite-status.md](~/.claude/commands/multisite-status.md) |
| `/daily-ops` | Morning operations check | Built | [daily-ops.md](~/.claude/commands/daily-ops.md) |

---

## MCP Tools

### Active & Configured

| Tool | Server | Purpose | Endpoint |
|------|--------|---------|----------|
| `mcp__samgov__*` | samgov | SAM.gov opportunities, entities, forecasts | `/Users/ericcoffie/mcp-servers/samgov/index.js` |
| `mcp__grantsgov__*` | grantsgov | Federal grants ($700B/year) | `/Users/ericcoffie/mcp-servers/grantsgov/index.js` |
| `mcp__multisite__*` | multisite | Aggregated sources (NIH, etc.) | `/Users/ericcoffie/mcp-servers/multisite/index.js` |
| `mcp__usaspending__*` | usaspending | Spending data, awards, recompetes | `/Users/ericcoffie/mcp-servers/usaspending-mcp/index.js` |
| `mcp__stripe__*` | stripe | Customer/subscription management | `/Users/ericcoffie/mcp-servers/stripe-admin/index.js` |
| `mcp__vimeo__*` | vimeo | Video uploads | `/Users/ericcoffie/mcp-servers/vimeo/index.js` |
| `mcp__framer__*` | framer | Website design (SSE) | `mcp.unframer.co` |
| `mcp__perplexity__*` | perplexity | AI research/search | `/Users/ericcoffie/mcp-servers/perplexity/index.js` |

### Recently Configured

| Tool | Server | Purpose | Endpoint |
|------|--------|---------|----------|
| `mcp__usaspending__*` | usaspending | Spending data, awards, recompetes | `/Users/ericcoffie/mcp-servers/usaspending-mcp/index.js` |

### To Build

| Tool | Purpose | Priority | Spec |
|------|---------|----------|------|
| `event-aggregator-mcp` | Federal event discovery | **High** | [event-aggregator-spec.md](docs/tool-interfaces/event-aggregator-spec.md) |
| `recompete-tracker` | Expiration monitoring | High | TBD |
| `jsearch-mcp` | Private sector job aggregation | Medium | TBD |
| `usajobs-mcp` | Federal job opportunities | Medium | TBD |

---

## Agents

### Defined (Spec Complete)

| Agent | Purpose | Spec | Triggers |
|-------|---------|------|----------|
| Market Scanner | Autonomous market analysis | [market-scanner-agent.md](docs/agent-specs/market-scanner-agent.md) | User request, weekly schedule |
| Recompete Alert | Expiration monitoring | TBD | Daily scan, 6-month threshold |
| Event Discovery | Event matching | TBD | Weekly scan |
| Competitive Intel | Competitor tracking | TBD | User request, award alerts |
| Visibility Gap | Gap analysis | TBD | Market scan sub-task |

### Agent Hierarchy

```
Market Scanner Agent (Primary)
    │
    ├── Visibility Gap Agent (Sub-task)
    │
    ├── Recompete Alert Agent (Async spawn)
    │
    ├── Competitive Intel Agent (On-demand)
    │
    └── Event Discovery Agent (On-demand)
```

---

## Tool Interface Quick Reference

### samgov-mcp

| Method | Purpose | Key Params |
|--------|---------|------------|
| `search_opportunities` | Find active opps | naics, state, setAside |
| `get_opportunity` | Full details | noticeId |
| `search_entities` | Find contractors | query, uei, state |
| `get_forecast` | Planned procurements | naics, agency |
| `check_api_health` | Health check | - |

### grantsgov-mcp

| Method | Purpose | Key Params |
|--------|---------|------------|
| `search_grants` | Find grants | keyword, agency, status |
| `get_grant` | Full details | oppNum |
| `search_forecasted` | Upcoming grants | keyword, agency |
| `list_agencies` | All grant agencies | - |
| `list_categories` | Funding categories | - |

### multisite-mcp

| Method | Purpose | Key Params |
|--------|---------|------------|
| `search_multisite` | Unified search | naics, state, source |
| `search_nih` | NIH RePORTER | keywords, agencies, activityCodes |
| `get_multisite_stats` | Source statistics | - |
| `check_source_health` | Health by source | sourceId |

### usaspending-mcp (To Configure)

| Method | Purpose | Key Params |
|--------|---------|------------|
| `search_awards` | Find awards | naics, state, fiscal_year |
| `get_spending_by_agency` | Agency breakdown | naics, fiscal_years |
| `get_spending_by_state` | Geographic distribution | naics, fiscal_year |
| `get_vendor_awards` | Contractor history | uei, vendor_name |
| `get_expiring_contracts` | Recompete candidates | naics, expires_before |

---

## Skill-to-Tool Mapping

| Skill | Primary Tools | Secondary Tools |
|-------|---------------|-----------------|
| `/market-scan` | usaspending, samgov | grantsgov, multisite |
| `/visibility-gap` | usaspending, samgov | - |
| `/recompete-analysis` | usaspending | samgov (cross-ref) |
| `/competitor-profile` | usaspending, samgov | - |
| `/forecast-scan` | samgov | - |
| `/grant-scan` | grantsgov | multisite (NIH) |
| `/event-discovery` | event-aggregator | - |

---

## Agent-to-Tool Mapping

| Agent | Required Tools | Optional Tools |
|-------|----------------|----------------|
| Market Scanner | usaspending, samgov | grantsgov, multisite |
| Recompete Alert | usaspending, samgov | - |
| Event Discovery | event-aggregator | samgov (industry days) |
| Competitive Intel | usaspending, samgov | - |
| Visibility Gap | usaspending, samgov | - |

---

## Database Tables

| Table | Purpose | Used By |
|-------|---------|---------|
| `aggregated_opportunities` | Normalized opps from all sources | multisite-mcp, crons |
| `multisite_sources` | Source configuration | multisite-mcp |
| `scrape_log` | Audit trail | All crons |
| `spending_cache` | USASpending cache (24hr TTL) | usaspending-mcp |
| `recompete_tracking` | Monitored expirations | Recompete Alert agent |
| `event_calendar` | Aggregated events | Event Discovery agent |
| `user_profiles` | User preferences | All personalized features |
| `briefing_log` | Sent briefings | Daily/Weekly alerts |

---

## Configuration Files

| File | Purpose |
|------|---------|
| `~/.mcp.json` | MCP server configuration |
| `~/.claude/commands/*.md` | Slash command definitions |
| `~/.claude/skill-specs/*.md` | Skill specifications |
| `vercel.json` | Cron schedules |
| `.env.local` | Environment variables |

---

## Build Priority Matrix

| Component | Impact | Frequency | Effort | Priority |
|-----------|--------|-----------|--------|----------|
| Configure usaspending-mcp | High | Daily | Low | **P0** |
| `/market-scan` skill | High | Daily | Medium | **P1** |
| `/visibility-gap` skill | High | Weekly | Low | **P1** |
| Recompete Alert agent | High | Daily | High | **P2** |
| Event Aggregator tool | Medium | Weekly | High | **P2** |
| `/competitor-profile` skill | Medium | Weekly | Medium | **P3** |

---

## Status Legend

| Status | Meaning |
|--------|---------|
| Built | Code complete, deployed |
| Planned | Specification exists |
| TBD | Concept defined, no spec |
| Needs Config | Code exists, needs setup |

---

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `federal-market-scanner.md` | System overview |
| `data-flow-architecture.md` | Component connections |
| `tool-interfaces/*.md` | Detailed tool specs |
| `agent-specs/*.md` | Agent decision trees |
| `~/.claude/skill-specs/*.md` | Skill definitions |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-05 | Initial registry |

---

*Last Updated: April 5, 2026*
