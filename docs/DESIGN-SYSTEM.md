# Mindy Design System (de-vibe-coding)

The in-app look is being moved off "vibe-coded" ad-hoc styling onto a small, calm,
enterprise-grade system (Linear/Stripe/Ramp restraint). Everything here is **token-first**
and guarded by `scripts/audit-design-tokens.mjs` (a baseline drift guard wired into the
pre-push gate). The number of raw-color / arbitrary-hex usages can only trend DOWN.

## Where things live

| Thing | File |
|-------|------|
| Color / radius / shadow tokens | `src/app/globals.css` (`@theme inline`) |
| Card / panel surface primitive | `src/components/ui/Card.tsx` |
| Drift guard (baseline) | `scripts/audit-design-tokens.mjs` + `tests/fixtures/design-token-baseline.json` |

## Color tokens (Phase 1)

Use these utilities, **never** raw `slate/gray/zinc` or arbitrary `[#hex]`:

- Grounds/surfaces: `bg-ground` (slate-900) · `bg-ground-deep` (950) · `bg-surface` (800) · `bg-surface-2` (raised) · `bg-input` (slate-700 — input/chip fill, most-raised) · borders `border-hairline` (700), `border-surface` (800)
- Text: `text-ink` (primary, slate-50) · `text-ink-soft` (bright secondary, slate-300) · `text-muted` (secondary, slate-400) · `text-faint` (tertiary/disabled, slate-500) · `placeholder-faint`
- Brand: `bg-navy`/`text-navy` (one navy) · `text-accent`/`bg-accent` (Mindy violet — the single interactive accent)
- Status (SEPARATE from the accent, encodes state only): `ok` / `warn` / `crit` / `info`

**Exact slate→token no-op map** (used by the P5 migration — same hex, so swapping is invisible):
`bg-slate-900`→`bg-ground` · `bg-slate-950`→`bg-ground-deep` · `bg-slate-800`→`bg-surface` ·
`bg-slate-700`→`bg-input` · `border-slate-800`→`border-surface` · `border-slate-700`→`border-hairline` ·
`text-slate-300`→`text-ink-soft` · `text-slate-400`→`text-muted` · `text-slate-500`→`text-faint` ·
`placeholder-slate-500`→`placeholder-faint`. Opacity suffixes (`/40`, `/80`) carry over unchanged.
Shades with NO exact token (`text-slate-200`/`-600`, `border-slate-600`/`-500`) are LEFT — migrating
them would change the color (a regression), not clean it.

## Radius scale (Phase 3)

One corner scale by ROLE — stop hand-picking among `rounded` / `-md` / `-lg` / `-xl` / `-2xl`:

| Utility | Value | Use for |
|---------|-------|---------|
| `rounded-control` | 0.5rem (= rounded-lg) | buttons, inputs, chips with corners |
| `rounded-card` | 0.75rem (= rounded-xl) | cards / panels |
| `rounded-pill` | full | fully-round chips, avatars |

## Elevation scale (Phase 3)

A restrained 3-step scale — stop jumping straight to `shadow-2xl`:

| Utility | Use for |
|---------|---------|
| `shadow-raised` | hover/lifted cards, dropdowns |
| `shadow-overlay` | popovers, drawers, sticky bars |
| `shadow-modal` | dialogs / command palette |

## Type scale (Phase 4)

The app had **no heading step** — 942 `text-xs` / 898 `text-sm` and a pile of arbitrary
px sizes (`text-[10px]`×187, `text-[11px]`×154), with headings picked ad-hoc from
`text-lg`/`xl`/`2xl`. These named roles give new headings/labels a system to use. Each
utility bundles size + line-height + weight, so the class alone is a complete style:

| Utility | Size | Use for |
|---------|------|---------|
| `text-page` | 24px / 700 | panel or page H1 |
| `text-title` | 17px / 600 | card / section heading (a real step above body) |
| `text-eyebrow` | 11px / 600, tracked | uppercase labels |
| `text-micro` | 10px | dense meta / caption (unifies `text-[10px]`/`[11px]`) |

Body stays `text-sm`, secondary `text-xs` — unchanged. Adopt going forward (e.g.
`CardHeader` already uses `text-title`); migrate ad-hoc heading sizes opportunistically.

## Motion (Phase 4 cleanup)

Dead decorative CSS was removed (0 usages anywhere): `glow-cyan`, `text-gradient`,
`status-dot`, `animate-connector-pulse`, `animate-fade-in`, `animate-slide-up` (+ their
orphaned `@keyframes`). Motion still in use elsewhere (`glow-blue`, `glow-amber`,
`glow-emerald`, `animate-kitt`, `animate-shimmer`, `animate-glow-pulse`,
`premium/standard-gradient`) was LEFT — it's referenced by live (mostly marketing) surfaces;
removing it would be a regression, not cleanup.

## The `<Card>` primitive (Phase 3)

`src/components/ui/Card.tsx` is the ONE owner of the card shell
(`bg-slate-900 border border-slate-800 rounded-card`). New code should use it instead of
re-typing the shell — that shell was hand-copied ~100× across 16 files.

```tsx
import Card, { CardHeader } from '@/components/ui/Card';

<Card>…</Card>                                  // default: p-5, flat
<Card padding="sm">…</Card>                     // none | sm | md | lg  → p-0 / p-3 / p-5 / p-6
<Card interactive onClick={…}>…</Card>          // hover-lift for clickable cards
<Card elevation="raised">…</Card>               // shadow-raised at rest
<Card className="border-emerald-500/30">…</Card> // per-card accents still compose

<Card>
  <CardHeader title="Team Activity" subtitle="last 30 days" actions={<button/>} />
  …
</Card>
```

**Adoption model (chosen Jul 9 2026):** ship the primitive + tokens, adopt **going
forward**; the drift guard nudges the existing ~100 shells to migrate over time (same
approach that finished the emoji→lucide work). `Card.tsx` itself is the sanctioned home
for the shell's raw classes — it's recorded in the drift baseline, exactly like
`globals.css` owns the hex values. Each panel that adopts `<Card>` DROPS raw-neutral count.

## Roadmap

- **P1** ✅ semantic color tokens + drift guard (no visual change)
- **P2** ✅ collapse two blues → one `bg-navy`; emoji→lucide across all panels
- **P3** ✅ radius/shadow tokens + `<Card>` primitive (this doc), adopt going forward
- **P4** ✅ type scale (`text-page`/`title`/`eyebrow`/`micro`, wired into `CardHeader`) + deleted 7 truly-dead motion classes. Adopt going forward.
- **P5** (in progress) the raw-neutral → token migration via the exact no-op map above.
  **Batches shipped:** (1) Dashboard reference pass; (2) top-8 panels; (3) full `/app` sweep
  (`src/components/app` + `src/app/app`, 58 files incl. market-intel & onboarding pages).
  Baseline 10,557 → **7,377** (−3,180, ~30% of the total debt). The whole `/app` surface is now
  largely token-driven; leftovers are the no-exact-token shades (`text-slate-200`/`-600`,
  `border-slate-600`/`-500`) plus non-`/app` areas (marketing/admin), which migrate the same way
  when touched (python `\b`-anchored regex over the map; leave shades with no exact token).
