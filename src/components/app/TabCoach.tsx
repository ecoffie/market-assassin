'use client';

/**
 * Tab coach — game-style "how to use this tab" hints (owner request, 2026-11-27). Ships OFF behind
 * NEXT_PUBLIC_TAB_TIPS, mounted ONCE by PanelContainer (src/components/app/panels/index.tsx).
 *
 *  - A small dark hint box slides into the bottom-right corner (full width with 16px gutters on a phone)
 *    and shows ONE step at a time ("1 of 3") with Next and Skip; after the last step it shows the "Tip:".
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
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return el;
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
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-surface text-muted hover:text-white transition-colors"
      >
        <HelpCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );

  if (!open || typeof document === 'undefined') return replayButton;

  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  // Keep the hint off the highlighted element: move it to the top when the target sits in its corner.
  const boxAtTop = !!target && target.top + target.height > vh - 240 && (vw < 640 || target.left + target.width > vw - 420);
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
            className="pointer-events-none fixed z-[58] rounded-xl border-2 border-amber-400"
            style={{
              top: target.top - RING_PAD,
              left: target.left - RING_PAD,
              width: target.width + RING_PAD * 2,
              height: target.height + RING_PAD * 2,
              // The huge spread shadow dims the page everywhere except the highlighted element.
              boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.45)',
              transition: reduced ? undefined : 'top 150ms ease, left 150ms ease, width 150ms ease, height 150ms ease',
            }}
            data-coach-anim=""
          >
            <div
              className="absolute inset-0 rounded-xl"
              style={{ boxShadow: '0 0 16px 4px rgba(251, 191, 36, 0.65)', ...anim('mindy-coach-pulse 1.6s ease-in-out infinite') }}
              data-coach-anim=""
              data-testid="tab-coach-glow"
            />
          </div>
          <div
            aria-hidden="true"
            data-testid="tab-coach-arrow"
            data-direction={arrowAbove ? 'down' : 'up'}
            className="pointer-events-none fixed z-[59] text-amber-300 drop-shadow"
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
        className={`fixed left-4 right-4 z-[61] rounded-xl border border-white/10 bg-slate-950/95 p-4 text-sm text-white shadow-2xl shadow-black/60 sm:left-auto sm:right-6 sm:w-[22rem] ${boxAtTop ? 'top-4 sm:top-6' : 'bottom-4 sm:bottom-6'}`}
        style={anim('mindy-coach-in 220ms ease-out')}
        data-coach-anim=""
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-xs font-semibold uppercase tracking-wider text-amber-300">{title}</h2>
          <span className="shrink-0 text-xs text-slate-400" data-testid="tab-coach-progress">
            {onTip ? 'Tip' : `${index + 1} of ${steps.length}`}
          </span>
        </div>
        <p id={textId} aria-live="polite" className="mt-2 break-words leading-relaxed text-slate-100" data-testid="tab-coach-text">
          {onTip
            ? <><strong className="text-amber-300">Tip:</strong> {tips.tip}</>
            : steps[index]?.text}
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          {!onTip && (
            <button
              type="button"
              onClick={finish}
              data-testid="tab-coach-skip"
              className="rounded-md px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              Skip
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={onTip ? finish : next}
            data-testid="tab-coach-next"
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
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
