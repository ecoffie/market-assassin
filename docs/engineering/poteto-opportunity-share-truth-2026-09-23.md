# POTETO — Opportunity Share Truth ✓

**Frozen 2026-09-23.** Product merge `a7e41178` (#1650). Docs-only freeze; no product changes.

    OPPORTUNITY → URL → CRAWLER → METADATA → PREVIEW → CLICK

Every hop is verified against production on the merged commit. A link a contractor sends to a
teaming partner previews as *the opportunity*, not as the product.

## The chain

| Hop | What must be true | Verified |
|---|---|---|
| **OPPORTUNITY** | One `sam_opportunities` row; every field a verified column or omitted | Minot MACC IDIQ, `c392ada23e564e9d9d90c20f474b10cb` |
| **URL** | `?opp=<32-hex notice_id>` on `/opportunity-map` | 200, no redirect, no auth wall |
| **CRAWLER** | Facebook, LinkedIn and X user-agents all reach the server-rendered head | 50/50 production sweep |
| **METADATA** | `title`, `og:title`, `og:description`, `og:image`, canonical, Twitter tags | present on all three agents |
| **PREVIEW** | The platforms' own scrapers render the opportunity card | Post Inspector ✓ · Sharing Debugger ✓ |
| **CLICK** | The map itself is unchanged for humans | plain map + unknown id unaffected |

## Production evidence

Requested `https://getmindy.ai/opportunity-map?opp=c392ada23e564e9d9d90c20f474b10cb` as
`facebookexternalhit/1.1`, `LinkedInBot/1.0` and `Twitterbot/1.0`. All three returned:

- `<title>` and `og:title` — *Minot Air Force Base Multiple Award Construction Contract (MACC)
  IDIQ — Government Opportunity*
- `og:description` — *Dept. of the Air Force · Dept. of Defense · Place of performance:
  Minot AFB, ND · Responses due Sep 28, 2026 · Solicitation …*
- `og:image` → `/opportunity-map/og/c392ada23e564e9d9d90c20f474b10cb` — **HTTP 200,
  `image/png`, 71,992 bytes**

**Manual platform verification.** LinkedIn Post Inspector and Facebook Sharing Debugger each
scraped the URL and rendered the opportunity-specific card. The generic "GETMINDY.AI / Mindy
Map" preview is gone. Facebook's `fb:app_id` warning and LinkedIn's missing
author/publication-date notices are advisory; neither affects rendering.

## Controls — what must NOT change

| Case | Expected | Observed |
|---|---|---|
| `/opportunity-map` with no `opp` | unchanged page | `<title>Mindy Map</title>`, no `og:` tags |
| Unknown 32-hex id | unchanged page, no invention | `<title>Mindy Map</title>`, no `og:` tags |

`fc-` ids, embeds and DB errors leave the page unchanged by the same path.

## Truth rules this freeze locks

- **Every field is a verified column or omitted.** Nothing is estimated to fill a card.
- **Deadline as SAM issued it** — the raw offset string, never a UTC-shifted date.
- **Place of performance only** — never the buying office.
- **Closed, archived and award notices are labelled**, so an old link cannot read as an open bid.
- The OG route lives **outside `/api/`** because robots.txt disallows `/api/` and Twitterbot
  obeys robots.

## Anchors

| | |
|---|---|
| Metadata | `renderOppShareHead` → `src/lib/opportunities/share-metadata.ts` |
| Route | `shareHeadP` → `src/app/opportunity-map/route.ts` |
| Card | `src/app/opportunity-map/og/[id]/route.tsx` |
| Tests | `share-metadata.unit.test.ts` (13) · `share-metadata-route.unit.test.ts` (6, invokes GET) |
| Ledger | `docs/REPAIR-LEDGER.md` → Opportunity share metadata — **LIVE · FROZEN** |
