# PRD: Light / Dark Mode — Themeable Mindy

> Mindy is **dark-only** today. Add a proper light mode as a user setting —
> but the real work is making the UI *themeable* (the colors are hard-coded),
> not the toggle itself.

**Status:** Draft / scoping — 2026-06-05. **DO NOT EXECUTE** — exploratory /
nice-to-have; queue behind the current fix list.
**Trigger:** Eric: "Does Mindy have a white or dark mode or only dark? Can this
be part of user settings?"

---

## 1. Current state (measured 2026-06-05)

- **Dark-only.** No theme toggle, no `next-themes`, no light styles anywhere.
- `globals.css` HAS CSS variables (`--background: #0f172a`, `--foreground`),
  but the app **doesn't use them** for component colors.
- **~29 app component files hard-code dark Tailwind classes** directly:
  `bg-slate-900`, `bg-slate-950`, `text-white`, `text-slate-300`, `border-
  slate-800`, etc. These do NOT flip with a theme.
- Tailwind v4 (CSS-based config, no tailwind.config.js).

**So:** the toggle is trivial; making the app *render correctly* in light mode
is the substance. A toggle without the refactor = white-on-white in dozens of
places (broken).

---

## 2. The real work: semantic theme tokens

The fix isn't "add light classes everywhere" (doubles the styling, drifts).
It's **one source of truth**: define semantic tokens that mean a ROLE, not a
color, and flip them by theme.

```css
/* globals.css */
:root {                      /* light */
  --surface: #ffffff;
  --surface-2: #f1f5f9;
  --text: #0f172a;
  --text-muted: #475569;
  --border: #e2e8f0;
  --accent: #059669;
}
.dark {                      /* dark (current look) */
  --surface: #0f172a;
  --surface-2: #1e293b;
  --text: #f1f5f9;
  --text-muted: #94a3b8;
  --border: #1e293b;
  --accent: #10b981;
}
```
Wire to Tailwind v4 `@theme` so classes like `bg-surface`, `text-text`,
`border-border` exist. Then **convert components**: `bg-slate-900` → `bg-surface`,
`text-white` → `text-text`, `border-slate-800` → `border-border`, etc.

This is the bulk of the effort — ~29 components, methodical, verify each in
BOTH modes. Charts/badges with semantic colors (emerald = good, amber = warn,
rose = bad) mostly stay; only the neutral surface/text/border palette flips.

---

## 3. The easy parts (after tokens exist)

- **Root class:** put `dark` (or not) on `<html>`. `next-themes` handles this
  + system-preference detection + no-flash-on-load. Add the dep.
- **Toggle UI:** a sun/moon switch in Settings (and maybe the header).
- **Persistence:** store `theme: 'dark' | 'light' | 'system'` in user settings
  (the UnifiedSettingsPanel + `user_notification_settings` or a profile field).
  Default `dark` (current look) so nothing changes for existing users until they
  opt in. `next-themes` also persists to localStorage for instant load.

---

## 4. Phasing

- **Phase 1 — Token foundation:** define the semantic tokens + Tailwind `@theme`
  wiring. No visible change yet (dark still default).
- **Phase 2 — Convert the shell + high-traffic panels:** sidebar, header,
  Dashboard, Alerts, Decision Makers, Market Research, Pipeline. Verify each in
  both modes (screenshot light + dark).
- **Phase 3 — Convert the rest + the toggle/setting:** remaining panels, then
  ship the toggle (gated so light isn't user-visible until coverage is complete).
- **Phase 4 — Polish:** charts, badges, email templates (separate — emails are
  their own dark templates; light-mode email is out of scope unless asked).

Do NOT ship the toggle before Phase 2/3 coverage — a broken light mode is worse
than no light mode.

---

## 5. Risks / gotchas

- **Hard-coded hex** (not just Tailwind classes) — inline `style={{ background:
  '#0f172a' }}` and `bg-[#...]` need finding too (grep `#0`/`bg-\[`).
- **Charts** (the vertical fiscal-year bars, etc.) — emerald on dark vs light
  needs a contrast check.
- **Render-verify burden:** every converted panel must be checked in BOTH modes,
  doubling the screenshot QA. Budget for it.
- **Scope creep:** light-mode EMAIL is a separate, bigger thing (email clients,
  the existing dark templates). Out of scope unless requested.

---

## 6. Success criteria

- A theme setting (dark / light / system) in Settings, persisted per user,
  default dark (no change for existing users until they opt in).
- Every `/app` panel renders correctly in BOTH modes (no white-on-white,
  readable contrast — WCAG AA on text).
- One token source of truth; no per-component light/dark duplication.
- No flash-of-wrong-theme on load (next-themes).

---

## 7. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Mindy is dark-only; light mode is a themeable-tokens refactor, not a toggle. Scope as PRD, build later — exploratory/nice-to-have, queue behind current fixes. Default stays dark; light is opt-in. | Eric |
