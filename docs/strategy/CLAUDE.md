# GovCon Giants - Master Project Reference

## Quick Project Finder

| Say This | Project | Location |
|----------|---------|----------|
| "**$82B page**", "govcon funnels", "marketing site" | GovCon Funnels | `/Users/ericcoffie/govcon-funnels` |
| "**tools**", "market assassin", "dev" | Market Assassin | `./market-assassin` (this folder) |
| "**live shop**", "production", "shop.govcongiants" | GovCon Shop | `/Users/ericcoffie/govcon-shop` |

---

## Project Details

### 1. GovCon Funnels (Marketing Site)
**Location:** `/Users/ericcoffie/govcon-funnels`
**Live URL:** govcongiants.org
**Identifier:** "$82 BILLION UNSPENT" hero page

**Pages:**
- `/` - Main homepage with $82B hero
- `/bootcamp` - January Bootcamp
- `/surge` - Surge Bootcamp
- `/free-course` - Free course signup
- `/opp` - Opportunity Hunter
- `/resources` - Free resources

```bash
cd /Users/ericcoffie/govcon-funnels && npm run dev
```

---

### 2. Market Assassin (Dev/Staging Tools)
**Location:** `./market-assassin` (subfolder)
**Purpose:** Development environment for GovCon tools
**Has its own CLAUDE.md:** Yes - see `./market-assassin/CLAUDE.md`

**Current ops notes (April 25, 2026):**
- Weekly alerts use a cache-backed Sunday/Monday batch window in `market-assassin/vercel.json`.
- Weekly alerts, weekly deep dives, pursuit briefs, and briefing sends should use the shared `sendEmail()` helper: Resend primary, Office 365 fallback only.
- Weekly alert health is tracked in the Market Assassin Operations dashboard separately from daily alerts.

**Tools:**
- Federal Market Assassin ($297-$497)
- GovCon Content Generator ($197-$397)
- Federal Contractor Database ($497)
- Recompete Contracts Tracker ($397)
- Opportunity Hunter (Free + $49 Pro + $19/mo Alert Pro)
- Action Planner Dashboard
- Forecast Intelligence (Free) — `/forecasts` — 7,648 forecasts from 11 agencies, $94.5B coverage

```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin" && npm run dev
```

---

### 3. GovCon Shop (Live Production)
**Location:** `/Users/ericcoffie/govcon-shop`
**Live URL:** shop.govcongiants.org
**Purpose:** Production shop - handle with care!

```bash
cd /Users/ericcoffie/govcon-shop && npm run dev
```

---

## This Folder Contents

| Item | Purpose |
|------|---------|
| `market-assassin/` | Main Next.js dev project |
| `TOOL-BUILD.md` | **Feature roadmap for all tools** |
| `Eric Docs/` | Documentation files |
| `email-templates/` | Email template files |
| `webinar/` | Webinar materials |
| `convert-*.js` | Data conversion scripts |
| `*.csv` | Data files (contractors, courses) |

---

## Tool Development Roadmap

**See:** [`market-assassin/TOOL-BUILD.md`](./market-assassin/TOOL-BUILD.md)

Comprehensive feature list and development priorities for all GovCon tools:
- Federal Market Assassin enhancements
- Recompete Contracts Tracker features
- Opportunity Hunter / Opp Scout Pro updates
- Content Generator improvements
- Contractor Database additions
- Action Planner completion
- 30-Day Certification Program (new product)

---

## IMPORTANT: No Framer
**None of these projects use Framer.** Do not use Framer MCP tools. All are pure Next.js/React codebases.

---

## Available Skills (Slash Commands)

| Command | Purpose |
|---------|---------|
| `/deploy [project]` | Build and deploy to Vercel with verification |
| `/continue` | Resume previous session from tasks/todo.md |
| `/goto [shortcut]` | Quick switch projects (ma, shop, funnels, bootcamp) |
| `/fix-colors [file]` | Apply canonical GovCon color scheme |
| `/from-prd [name]` | Find PRD and scaffold implementation |
| `/debug-api` | Systematic API error diagnosis |
| `/create-bootcamp [date] [topic]` | Generate 8-hour bootcamp agenda |
| `/cross-ref [source1] [source2]` | Compare data sources, find gaps |
| `/expand-search [naics] [state]` | Expand limited search results |
| `/handoff` | End session with state saved for next time |

---

*Last Updated: April 25, 2026*
