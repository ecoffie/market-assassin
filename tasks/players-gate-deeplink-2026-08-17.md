# The Players gate is bypassed by a deep link — attempted 2026-08-17, NOT shipped

**Status: OPEN. One attempt made and REVERTED — the obvious fix breaks the map's boot.**
Nothing was pushed or deployed. Read the "Why the obvious fix fails" section before retrying;
it is the whole reason this is still open.

---

## The defect, measured (not inferred)

`/today`'s nav emits Players as a plain anchor:

```
src/app/today/route.ts:353    <a href="/opportunity-map?mode=buyers">Players</a>
```

The map's own nav does NOT — it intercepts first:

```
src/app/opportunity-map/route.ts:1466
  <a class="zh-mode" ... onclick="__playersGate('companies')">Players</a>
```

So a signed-out visitor arriving from `/today` reaches `setMapMode('buyers')` directly, never
passing through `window.__playersGate` (`route.ts:2656`).

### What actually happens (verified on live prod, signed out)

```
https://getmindy.ai/opportunity-map?mode=buyers
  mode:              "buyers"
  pins:              0
  feed rows:         0
  feed text:         "Meet the buyers behind the opportunities…"
  unlock panel:      NOT shown
  sign-in modal:     NOT shown
```

**The data is protected.** `contacts-map` returns its honest empty state — no paid rows leak.
The paywall's BACKSTOP fires (there is one at `route.ts:2253` for exactly this reason).

**What's missing is the pitch.** The visitor lands in buyers mode with an empty map and no
prompt — a dead end instead of the conversion moment. `__playersGate` would have opened the
sign-in modal with the unlock panel ("7 outcomes", real blur, Google/MS/Email) and switched
mode only in the resume callback.

> **This is a CONVERSION problem, not a security hole.** That distinction sets the priority —
> it is not urgent, and it is not worth risking the demo surface for.

---

## Why the obvious fix fails (the part that matters)

The natural change is to route the deep link through the gate instead of `setMapMode`:

```js
// src/app/opportunity-map/route.ts ~7746, inside the deep-link block
var GATED={buyers:1,companies:1};
if(_mode&&GATED[_mode]&&typeof window.__playersGate==='function'){
  try{ if(window.__mapMode!==_mode)window.__playersGate(_mode); }catch(e){}
} else if(_mode&&DATASET[_mode]&&typeof window.setMapMode==='function'){ ... }
```

**This breaks page initialization completely.** With it applied, `?mode=buyers` leaves EVERY map
global undefined — `__playersGate`, `openSignInModal`, `setMapMode`, `__STATE_CENTROIDS`,
`__mapMode`. The map never boots. No page error is thrown; it simply never finishes.

### Isolated by control test — this is not a guess

| build | `?mode=buyers` |
|---|---|
| `main` (control, unmodified) | ✅ `gate:"function"`, `mode:"buyers"` |
| full change (both hunks) | ❌ `gate:"undefined"`, `mode:"undefined"` |
| **retry hunk ONLY** | ✅ works — the retry hunk is INNOCENT |
| **gate-dispatch hunk** | ❌ **the breaker** |

Only `buyers` and `companies` break. `?mode=recompete`, `?agency=`, and a no-param load are all
fine, which is what points the finger at the gate call itself.

### The cause

When signed out, `__playersGate` calls `window.openSignInModal(...)` (`route.ts:2660-2662`).
That is correct from a **click**. It is not safe at **boot** — the deep-link block runs during
initialization, and opening the modal there kills the rest of the boot sequence before
VIEWPORT_JS finishes defining its globals.

**The gate is not the problem. Calling it during page init is.**

---

## What a real fix needs

The gate must fire AFTER the map is up, not during it. Two shapes worth considering:

1. **Defer to a ready hook** — have the deep-link block set a pending intent and let the map's
   existing post-boot path consume it, so the modal opens once initialization is complete.
2. **Reuse the nav interception** — the click path already works; make the deep link land in a
   state that triggers that same interception rather than re-implementing it at boot.

Either way this is a change to the **boot sequence**, not a 5-line patch. It needs its own
browser proof: assert every map global is defined AND the unlock panel renders, on the same load.

⚠️ **Do not "fix" this by making the gate silent at boot** (e.g. skipping the modal when the
map isn't ready). That reproduces today's dead end with extra code.

---

## Two dead ends already ruled out — don't re-try these

Both were MY wrong guesses on 2026-08-17, each costing a full rebuild:

1. **"The comments broke the string."** Rewrote the block's comments to plain ASCII on the theory
   they were terminating a quoted CSS/JS string. **Still broken.** This block is inside a template
   literal where multi-line `//` comments are legal.
2. **"The multi-line `if` broke the emitted JS."** Collapsed the two-line condition to one line.
   **Still broken.**

The lesson: hunk-by-hunk isolation answered this in ONE pass and should have been the first move,
not the third. Two rebuilds were spent on theories that a single control test would have killed.

---

## Cheaper alternative (not attempted)

Point `/today`'s Players link at a surface that already gates cleanly, rather than deep-linking
into map internals. `/today` ships no map JS, so its link must stay a plain `<a href>` — but it
does not have to be `?mode=buyers`.

---

## Priority

**Deliberately deferred past the 2026-08-22 demo.** It touches page initialization on the demo
surface; the failure mode is "the map does not load at all," which is far worse than the current
dead end. The data is already protected. Revisit with room to test.

---

*Written 2026-08-17 after the attempt was reverted. Branch `fix/players-gate-deeplink` was
never pushed; the worktree was reset to origin/main.*
