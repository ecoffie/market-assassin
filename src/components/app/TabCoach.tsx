'use client';

/**
 * Tab coach — step-by-step "how to use this tab" hints (owner request, 2026-11-27). Ships OFF behind
 * NEXT_PUBLIC_TAB_TIPS, mounted ONCE by PanelContainer (src/components/app/panels/index.tsx).
 *
 *  - A small hint card slides into the bottom-right corner (full width with 16px gutters on a phone)
 *    and shows ONE step at a time ("1 of 3") with Next and Skip; after the last step it shows the "Tip:".
 *    It sits HINT_BOTTOM px up so the site-wide "Get help" button (help-widget.ts, fixed 18px from the
 *    bottom-right, z-index far above ours) never covers Next / Skip.
 *  - Looks like the rest of Mindy (owner request, 2026-11-27): a white card with a hairline border and the
 *    modal shadow, the title in the site serif (Libre Baskerville, loaded for /app by LightThemeScope),
 *    a navy primary "Next", a quiet "Skip", and the ring / arrow in the app accent with a soft glow.
 *    Every colour is an app token (surface / hairline / ink / ink-soft / muted / navy / accent, see
 *    globals.css @theme, re-valued by mi-light.css + app-map.css), so the card follows the light /app
 *    look and the dark default palette alike. No warm game-style highlight colours anywhere.
 *  - When a step names an `anchor` (a CSS selector) and that element is on the page, the page dims
 *    slightly, the element gets a glowing ring and a small arrow points at it. The overlay is
 *    pointer-events:none, so the page stays fully usable. No anchor / not found / iframe tab = hint only.
 *  - Finished or skipped is remembered per tab in localStorage (every access in try/catch), so it does not
 *    replay on its own; the small "?" button replays it.
 *  - prefers-reduced-motion: no slide, pulse, nudge or smooth scroll.
 *  - Keyboard: Esc skips, Enter / ArrowRight go to the next step. Non-modal dialog; focus is never trapped.
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, HelpCircle } from 'lucide-react';
import {
  TAB_TIPS_DEFAULT_TITLE,
  TAB_TIPS_IFRAME_PANELS,
  normalizeTabTipSteps,
  tabTipsStorageKey,
  type TabTips,
} from '@/lib/app/tab-tips';

interface Box { top: number; left: number; width: number; height: number }

const RING_PAD = 6;
const ARROW = 28;
/** Clearance above the "Get help" button: it is ~37px tall at 18px (12px on phones) from the bottom. */
export const HINT_BOTTOM = 88;

/** The site serif (public-site tokens: MP_FONT_STACKS.serif). Inline, because app-map.css forces its
 *  display sans onto every h2 in /app with a selector no utility class can beat. */
export const COACH_SERIF = '"Libre Baskerville", Georgia, serif';

/**
 * Theme tokens the coach is painted with — Tailwind utilities over the app's --color-* variables.
 * Contrast (WCAG AA), /app light (app-map.css) · dark default (globals.css):
 *   title ink on surface 17.2 · 13.4; body ink-soft 9.6 · 9.9; muted 5.85 · 5.7 (small text needs 4.5);
 *   Next white on navy 4.66 · 10.4 (hover 6.4 · 8.7). Ring / arrow use the accent on the page
 *   (non-text, needs 3:1): 4.66 on the white app ground · 3.1 on the dark ground.
 */
export const COACH_CLASSES = {
  card: 'bg-surface border-hairline text-ink-soft shadow-modal',
  title: 'text-ink',
  muted: 'text-muted',
  next: 'bg-navy hover:bg-navy-hover text-white',
  skip: 'text-muted hover:text-ink hover:bg-surface-2',
  arrow: 'text-accent',
} as const;

/** A light veil (app shadow ink rgb(16 24 40)) — enough to lift the target, not a dark-room effect. */
const VEIL = 'rgba(16, 24, 40, 0.16)';

function readDone(panelId: string): boolean {
  try {
    return window.localStorage.getItem(tabTipsStorageKey(panelId)) === '1';
  } catch {
    return false;
  }
}

function writeDone(panelId: string): void {
  try {
    window.localStorage.setItem(tabTipsStorageKey(panelId), '1');
  } catch {
    /* storage unavailable — the coach simply runs again next time */
  }
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

function subscribeReducedMotion(onChange: () => void): () => void {
  try {
    if (typeof window.matchMedia !== 'function') return () => {};
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  } catch {
    return () => {};
  }
}

const noopSubscribe = () => () => {};

/**
 * Visible = a real box (width AND height > 0), not visibility:hidden, and neither it nor an ancestor is
 * fully transparent (a collapsed `max-h-0 opacity-0` section still has a width, so one dimension is not
 * enough).
 */
function isVisibleAnchor(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  try {
    if (window.getComputedStyle(el).visibility === 'hidden') return false;
    for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
      const o = parseFloat(window.getComputedStyle(n).opacity);
      if (!Number.isNaN(o) && o <= 0) return false;
    }
  } catch {
    /* no computed style: fall back to the box check */
  }
  return true;
}

/** The first visible element matching `selector`, outside the coach itself — or null (never throws). */
export function findTabCoachAnchor(selector: string, exclude?: Element | null): HTMLElement | null {
  let matches: NodeListOf<Element>;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    return null; // invalid selector: hint only
  }
  for (const el of Array.from(matches)) {
    if (!(el instanceof HTMLElement)) continue;
    if (exclude && exclude.contains(el)) continue;
    if (isVisibleAnchor(el)) return el;
  }
  return null;
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

const KEYFRAMES = `
@keyframes mindy-coach-in { from { transform: translateY(16px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes mindy-coach-pulse { 0%, 100% { opacity: .35 } 50% { opacity: 1 } }
@keyframes mindy-coach-nudge-down { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(5px) } }
@keyframes mindy-coach-nudge-up { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
.mindy-coach-ring { border-color: var(--color-accent) }
.mindy-coach-glow {
  box-shadow: 0 0 12px 2px var(--color-accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 18%, transparent), 0 0 18px 4px color-mix(in srgb, var(--color-accent) 35%, transparent);
}
@media (prefers-reduced-motion: reduce) { [data-coach-anim] { animation: none !important; transition: none !important } }
`;

export default function TabCoach({ panelId, tips }: { panelId: string; tips: TabTips }) {
  const title = tips.title || TAB_TIPS_DEFAULT_TITLE;
  const steps = normalizeTabTipSteps(tips);
  const highlightAllowed = !TAB_TIPS_IFRAME_PANELS.has(panelId);
  const dialogId = useId();
  const titleId = useId();
  const textId = useId();

  // Server render and hydration render nothing (hydrated=false); the remembered choice applies after.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  // What the user did in this view: null = nothing yet (use the remembered default);
  // 'closed' = finished/skipped; a number = the open step (steps.length = the "Tip:" screen).
  const [userPhase, setPhase] = useState<null | 'closed' | number>(null);
  // The measured box of the current anchor, tagged with that anchor so a stale box never paints.
  const [measured, setMeasured] = useState<{ anchor: string; box: Box } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const replayRef = useRef<HTMLButtonElement | null>(null);
  const focusNext = useRef(false);

  const phase: null | 'closed' | number = !hydrated ? null : (userPhase ?? (readDone(panelId) ? 'closed' : 0));
  const open = typeof phase === 'number';
  const index = open ? (phase as number) : -1;
  const onTip = open && index >= steps.length;
  const anchor = open && !onTip && highlightAllowed ? steps[index]?.anchor : undefined;
  const target = anchor && measured && measured.anchor === anchor ? measured.box : null;

  const finish = useCallback(() => {
    const hadFocus = !!(boxRef.current && boxRef.current.contains(document.activeElement));
    writeDone(panelId);
    setPhase('closed');
    // Keep keyboard users in place: focus goes to the "?" button, never lost to <body>.
    if (hadFocus) requestAnimationFrame(() => replayRef.current?.focus());
  }, [panelId]);

  const next = useCallback(() => {
    // userPhase is null while the auto-played first run is showing step 1.
    setPhase(p => (typeof p === 'number' ? p + 1 : p === null ? 1 : p));
  }, []);

  const replay = () => {
    focusNext.current = true;
    setPhase(0);
  };

  // Replay (a user action) moves focus into the hint; the automatic first show does not steal focus.
  useEffect(() => {
    if (open && focusNext.current) {
      focusNext.current = false;
      nextRef.current?.focus();
    }
  }, [open, phase]);

  // Find, gently scroll to, and track the step's anchor. Recomputed on scroll (any scroller) and resize,
  // and re-polled so an element that appears later (results, lazy panels) gets highlighted when it shows.
  useEffect(() => {
    if (!anchor) return;
    let scrolled = false;
    let raf = 0;
    const measure = () => {
      const el = findTabCoachAnchor(anchor, boxRef.current);
      if (!el) { setMeasured(prev => (prev ? null : prev)); return; }
      if (!scrolled) {
        scrolled = true;
        const r0 = el.getBoundingClientRect();
        const inView = r0.top >= 0 && r0.bottom <= window.innerHeight;
        if (!inView && typeof el.scrollIntoView === 'function') {
          try {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
          } catch { /* very old browsers: ignore */ }
        }
      }
      const r = el.getBoundingClientRect();
      setMeasured(prev => {
        const b = prev?.anchor === anchor ? prev.box : null;
        return b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height
          ? prev
          : { anchor, box: { top: r.top, left: r.left, width: r.width, height: r.height } };
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const poll = window.setInterval(measure, 400);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.clearInterval(poll);
    };
  }, [anchor, reduced]);

  // Keyboard: Esc skips; Enter / ArrowRight advance. Never steals keys from a field the user is typing in.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
      const t = e.target;
      const inBox = !!(boxRef.current && t instanceof Node && boxRef.current.contains(t));
      const neutral = !t || t === document.body || t === document.documentElement || t === window;
      if (e.key === 'Escape') {
        if (!inBox && isEditable(t)) return;
        finish();
        return;
      }
      if (e.key === 'ArrowRight' && (neutral || inBox)) {
        e.preventDefault();
        if (onTip) finish(); else next();
        return;
      }
      if (e.key === 'Enter' && (neutral || (inBox && !(t instanceof HTMLButtonElement)))) {
        e.preventDefault();
        if (onTip) finish(); else next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onTip, finish, next]);

  if (phase === null) return null;

  const replayButton = (
    <div className="flex justify-end px-4 pt-3 sm:px-6" data-testid="tab-coach-replay-row">
      <button
        ref={replayRef}
        type="button"
        onClick={replay}
        aria-label={`Show ${title.toLowerCase()}`}
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        title={title}
        data-testid="tab-coach-replay"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-surface text-muted hover:text-ink transition-colors"
      >
        <HelpCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );

  if (!open || typeof document === 'undefined') return replayButton;

  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  // Keep the hint off the highlighted element: move it to the top when the target sits in its corner
  // (the box spans roughly HINT_BOTTOM .. HINT_BOTTOM + 200px from the bottom).
  const boxAtTop = !!target && target.top + target.height > vh - (HINT_BOTTOM + 220) && (vw < 640 || target.left + target.width > vw - 420);
  const arrowAbove = !!target && target.top - RING_PAD - ARROW - 4 > 0;
  const arrowLeft = target ? Math.min(Math.max(target.left + target.width / 2 - ARROW / 2, 8), Math.max(8, vw - ARROW - 8)) : 0;
  const arrowTop = target
    ? (arrowAbove ? target.top - RING_PAD - ARROW - 4 : target.top + target.height + RING_PAD + 4)
    : 0;
  const anim = (value: string): CSSProperties => (reduced ? {} : { animation: value });

  const overlay = (
    <>
      <style>{KEYFRAMES}</style>
      {target && (
        <>
          <div
            aria-hidden="true"
            data-testid="tab-coach-ring"
            className="mindy-coach-ring pointer-events-none fixed z-[58] rounded-xl border-2"
            style={{
              top: target.top - RING_PAD,
              left: target.left - RING_PAD,
              width: target.width + RING_PAD * 2,
              height: target.height + RING_PAD * 2,
              // The huge spread shadow dims the page everywhere except the highlighted element.
              boxShadow: `0 0 0 9999px ${VEIL}`,
              transition: reduced ? undefined : 'top 150ms ease, left 150ms ease, width 150ms ease, height 150ms ease',
            }}
            data-coach-anim=""
          >
            <div
              className="mindy-coach-glow absolute inset-0 rounded-xl"
              style={{ ...anim('mindy-coach-pulse 1.6s ease-in-out infinite') }}
              data-coach-anim=""
              data-testid="tab-coach-glow"
            />
          </div>
          <div
            aria-hidden="true"
            data-testid="tab-coach-arrow"
            data-direction={arrowAbove ? 'down' : 'up'}
            className={`pointer-events-none fixed z-[59] drop-shadow ${COACH_CLASSES.arrow}`}
            style={{ top: arrowTop, left: arrowLeft, width: ARROW, height: ARROW, ...anim(`${arrowAbove ? 'mindy-coach-nudge-down' : 'mindy-coach-nudge-up'} 1.2s ease-in-out infinite`) }}
            data-coach-anim=""
          >
            {arrowAbove
              ? <ArrowDown className="h-7 w-7" strokeWidth={3} />
              : <ArrowUp className="h-7 w-7" strokeWidth={3} />}
          </div>
        </>
      )}
      <div
        ref={boxRef}
        id={dialogId}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        data-testid="tab-coach"
        data-position={boxAtTop ? 'top' : 'bottom'}
        className={`fixed left-4 right-4 z-[61] rounded-xl border p-4 text-sm ${COACH_CLASSES.card} sm:left-auto sm:right-6 sm:w-[22rem] ${boxAtTop ? 'top-4 sm:top-6' : ''}`}
        style={{
          ...(boxAtTop ? {} : { bottom: HINT_BOTTOM }),
          ...anim('mindy-coach-in 220ms ease-out'),
        }}
        data-coach-anim=""
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className={`text-base font-bold leading-snug ${COACH_CLASSES.title}`} style={{ fontFamily: COACH_SERIF, letterSpacing: '-0.01em' }} data-testid="tab-coach-title">{title}</h2>
          <span className={`shrink-0 text-xs ${COACH_CLASSES.muted}`} data-testid="tab-coach-progress">
            {onTip ? 'Tip' : `${index + 1} of ${steps.length}`}
          </span>
        </div>
        <p id={textId} aria-live="polite" className="mt-2 break-words leading-relaxed" data-testid="tab-coach-text">
          {onTip
            ? <><strong className={`font-semibold ${COACH_CLASSES.title}`}>Tip:</strong> {tips.tip}</>
            : steps[index]?.text}
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          {!onTip && (
            <button
              type="button"
              onClick={finish}
              data-testid="tab-coach-skip"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${COACH_CLASSES.skip}`}
            >
              Skip
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={onTip ? finish : next}
            data-testid="tab-coach-next"
            className={`${COACH_CLASSES.next} rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors`}
          >
            {onTip ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {replayButton}
      {createPortal(overlay, document.body)}
    </>
  );
}
