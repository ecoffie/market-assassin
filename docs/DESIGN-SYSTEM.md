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

- Grounds/surfaces: `bg-ground` `bg-ground-deep` `bg-surface` `bg-surface-2` · borders `border-hairline`
- Text: `text-ink` (primary) · `text-muted` (secondary) · `text-faint` (tertiary/disabled)
- Brand: `bg-navy`/`text-navy` (one navy) · `text-accent`/`bg-accent` (Mindy violet — the single interactive accent)
- Status (SEPARATE from the accent, encodes state only): `ok` / `warn` / `crit` / `info`

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
- **P4** (next) type scale (no heading step today: 853 `text-xs` / 772 `text-sm`) + delete dead marketing motion (glow/shimmer/KITT) + finish the raw-neutral → token migration by screen traffic.
