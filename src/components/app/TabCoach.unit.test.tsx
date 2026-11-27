// @vitest-environment jsdom
/** Tab coach: one step at a time, spotlight on the anchor, skip/remember/replay, keyboard, reduced motion. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TabCoach, { HINT_BOTTOM, findTabCoachAnchor } from './TabCoach';
import { TAB_TIPS, normalizeTabTipSteps, tabTipsStorageKey, type TabTips } from '@/lib/app/tab-tips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tips: TabTips = {
  steps: [
    { text: 'Fill in the filters.', anchor: '[data-tip="t-filters"]' },
    'Click a result.',
    { text: 'Track it.', anchor: '[data-tip="t-missing"]' },
  ],
  tip: 'A useful tip.',
};

let host: HTMLDivElement;
let root: Root;
let reducedMotion = false;

async function mount(panelId = 'forecasts', t: TabTips = tips) {
  await act(async () => { root.render(<TabCoach key={panelId} panelId={panelId} tips={t} />); });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const coach = () => q('tab-coach');
const text = () => q('tab-coach-text')?.textContent;
const progress = () => q('tab-coach-progress')?.textContent;
const click = async (id: string) => { await act(async () => { q(id)!.click(); }); };
const key = async (k: string, target: EventTarget = document.body) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
};

/** A page element with a real-looking box (jsdom has no layout). */
function addTarget(tip: string, rect = { top: 100, left: 50, width: 300, height: 80 }) {
  const el = document.createElement('div');
  el.setAttribute('data-tip', tip);
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON() {} }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  window.localStorage.clear();
  reducedMotion = false;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce') ? reducedMotion : false,
    media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('TabCoach', () => {
  it('shows one step at a time with "1 of 3", then Next through to the Tip, then Done', async () => {
    await mount();
    const dialog = coach()!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(q('tab-coach-text')!.getAttribute('aria-live')).toBe('polite');
    expect(dialog.textContent).toContain('How to use this tab');
    expect(progress()).toBe('1 of 3');
    expect(text()).toBe('Fill in the filters.');
    await click('tab-coach-next');
    expect(progress()).toBe('2 of 3');
    expect(text()).toBe('Click a result.');
    await click('tab-coach-next');
    expect(text()).toBe('Track it.');
    await click('tab-coach-next');
    expect(progress()).toBe('Tip');
    expect(text()).toBe('Tip: A useful tip.');
    expect(q('tab-coach-skip')).toBeNull();
    expect(q('tab-coach-next')!.textContent).toBe('Done');
    await click('tab-coach-next');
    expect(coach()).toBeNull();
    expect(window.localStorage.getItem(tabTipsStorageKey('forecasts'))).toBe('1');
  });

  it('the hint box is portalled to <body>, outside the panel layout', async () => {
    await mount();
    expect(coach()!.parentElement).toBe(document.body);
    expect(host.contains(coach())).toBe(false);
  });

  it('Skip remembers the tab, does not replay on remount, and "?" replays it from step 1', async () => {
    await mount();
    await click('tab-coach-next');
    await click('tab-coach-skip');
    expect(coach()).toBeNull();
    expect(window.localStorage.getItem(tabTipsStorageKey('forecasts'))).toBe('1');

    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(coach()).toBeNull();
    expect(q('tab-coach-replay')!.getAttribute('aria-expanded')).toBe('false');

    await click('tab-coach-replay');
    expect(progress()).toBe('1 of 3');
    expect(q('tab-coach-replay')!.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(q('tab-coach-next')); // replay moves focus into the hint
  });

  it('remembers per tab: another tab still auto-plays', async () => {
    window.localStorage.setItem(tabTipsStorageKey('forecasts'), '1');
    await mount('forecasts');
    expect(coach()).toBeNull();
    await mount('recompetes');
    expect(coach()).not.toBeNull();
  });

  it('anchor found: dims the page and draws the ring at the element, with an arrow', async () => {
    addTarget('t-filters', { top: 200, left: 40, width: 300, height: 80 });
    await mount();
    const ring = q('tab-coach-ring')!;
    expect(ring).not.toBeNull();
    expect(ring.style.top).toBe('194px');
    expect(ring.style.left).toBe('34px');
    expect(ring.style.width).toBe('312px');
    expect(ring.style.height).toBe('92px');
    expect(ring.style.boxShadow).toContain('9999px'); // the dim layer
    expect(ring.className).toContain('pointer-events-none'); // page stays usable
    const arrow = q('tab-coach-arrow')!;
    expect(arrow.getAttribute('data-direction')).toBe('down'); // room above: arrow points down at it
    expect(parseFloat(arrow.style.top)).toBeLessThan(194);
  });

  it('anchor missing, a plain-string step, or an invalid selector: hint only, no ring', async () => {
    addTarget('t-filters');
    await mount();
    expect(q('tab-coach-ring')).not.toBeNull();
    await click('tab-coach-next'); // plain string step
    expect(q('tab-coach-ring')).toBeNull();
    expect(text()).toBe('Click a result.');
    await click('tab-coach-next'); // anchor not on the page
    expect(q('tab-coach-ring')).toBeNull();
    expect(q('tab-coach-arrow')).toBeNull();
    expect(text()).toBe('Track it.');
    expect(findTabCoachAnchor('[[[not a selector')).toBeNull();
  });

  it('a hidden (zero-size) anchor is treated as missing', async () => {
    addTarget('t-filters', { top: 0, left: 0, width: 0, height: 0 });
    await mount();
    expect(q('tab-coach-ring')).toBeNull();
    expect(coach()).not.toBeNull();
  });

  it('a collapsed anchor (width but 0 height) is treated as missing', async () => {
    addTarget('t-filters', { top: 100, left: 50, width: 300, height: 0 });
    await mount();
    expect(q('tab-coach-ring')).toBeNull();
    expect(findTabCoachAnchor('[data-tip="t-filters"]')).toBeNull();
  });

  it('a transparent or visibility:hidden anchor is missing, including inside an opacity-0 parent', () => {
    const a = addTarget('t-a');
    a.style.opacity = '0';
    expect(findTabCoachAnchor('[data-tip="t-a"]')).toBeNull();
    const b = addTarget('t-b');
    b.style.visibility = 'hidden';
    expect(findTabCoachAnchor('[data-tip="t-b"]')).toBeNull();
    const parent = document.createElement('div');
    parent.style.opacity = '0'; // e.g. Dashboard's collapsed Review Fit expander (max-h-0 opacity-0)
    document.body.appendChild(parent);
    const c = addTarget('t-c');
    parent.appendChild(c);
    expect(findTabCoachAnchor('[data-tip="t-c"]')).toBeNull();
    parent.style.opacity = '1';
    expect(findTabCoachAnchor('[data-tip="t-c"]')).toBe(c);
  });

  it('an anchor that appears later gets highlighted when it shows', async () => {
    vi.useFakeTimers();
    try {
      await mount();
      expect(q('tab-coach-ring')).toBeNull();
      addTarget('t-filters');
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(q('tab-coach-ring')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrolls an off-screen anchor into view before highlighting', async () => {
    const el = addTarget('t-filters', { top: 5000, left: 40, width: 300, height: 80 });
    const spy = vi.fn();
    el.scrollIntoView = spy;
    await mount();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center', behavior: 'smooth' }));
  });

  it('iframe tabs (map / watchlist / saved) never highlight', async () => {
    addTarget('t-filters');
    await mount('map');
    expect(coach()).not.toBeNull();
    expect(q('tab-coach-ring')).toBeNull();
  });

  it('keyboard: Enter / ArrowRight advance, Esc skips; typing in a field is left alone', async () => {
    await mount();
    await key('ArrowRight');
    expect(progress()).toBe('2 of 3');
    await key('Enter');
    expect(progress()).toBe('3 of 3');
    const input = document.createElement('input');
    document.body.appendChild(input);
    await key('Enter', input);
    await key('Escape', input);
    expect(progress()).toBe('3 of 3');
    await key('Escape');
    expect(coach()).toBeNull();
    expect(window.localStorage.getItem(tabTipsStorageKey('forecasts'))).toBe('1');
  });

  it('reduced motion: no slide, pulse or nudge, and scrolling is instant', async () => {
    reducedMotion = true;
    const el = addTarget('t-filters', { top: 5000, left: 40, width: 300, height: 80 });
    const spy = vi.fn();
    el.scrollIntoView = spy;
    await mount();
    expect(coach()!.style.animation).toBe('');
    expect(q('tab-coach-glow')!.style.animation).toBe('');
    expect(q('tab-coach-arrow')!.style.animation).toBe('');
    expect(q('tab-coach-ring')!.style.transition).toBe('');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('motion allowed: the hint slides in', async () => {
    await mount();
    expect(coach()!.style.animation).toContain('mindy-coach-in');
  });

  it('blocked storage: the coach still runs and Skip still closes it for this view', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await mount();
    expect(coach()).not.toBeNull();
    await click('tab-coach-skip');
    expect(coach()).toBeNull();
  });

  it('phone width: full width with 16px gutters, lifted clear of the "Get help" button', async () => {
    await mount();
    const cls = coach()!.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(['fixed', 'left-4', 'right-4']));
    expect(coach()!.getAttribute('data-position')).toBe('bottom');
    expect(coach()!.style.bottom).toBe(`${HINT_BOTTOM}px`);
  });

  it('never sits under the site-wide "Get help" button (help-widget.ts: fixed, 18px from the bottom, ~37px tall)', async () => {
    // Widget top edge = 18 + 37 = 55px from the bottom on desktop (12 + 37 = 49px on phones).
    expect(HINT_BOTTOM).toBeGreaterThanOrEqual(88);
    await mount();
    const cls = coach()!.className.split(/\s+/);
    // No Tailwind bottom-* utility that could pull the box back down at some breakpoint.
    expect(cls.some(c => /(^|:)bottom-/.test(c))).toBe(false);
    expect(parseFloat(coach()!.style.bottom)).toBeGreaterThanOrEqual(88);
  });

  it('stays dark in the light app theme: explicit colours, no remappable theme tokens', async () => {
    addTarget('t-filters');
    await mount();
    const box = coach()!;
    expect(box.style.backgroundColor).toBe('rgb(17, 24, 39)'); // #111827
    expect(box.style.color).toBe('rgb(243, 244, 246)'); // #f3f4f6
    const next = q('tab-coach-next')!;
    expect(next.style.backgroundColor).toBe('rgb(245, 158, 11)');
    expect(next.style.color).toBe('rgb(17, 24, 39)');
    expect(q('tab-coach-skip')!.style.color).not.toBe('');
    expect(q('tab-coach-ring')!.style.borderColor).not.toBe('');
    // mi-light.css / app-map.css remap slate / gray / white / amber tokens to light values in /app.
    const themed = /(^|:)(bg|text|border|shadow)-(slate|gray|zinc|neutral|stone|white|black|amber)\b/;
    for (const el of [box, ...Array.from(box.querySelectorAll('*')), q('tab-coach-ring')!, q('tab-coach-arrow')!]) {
      const bad = (el.getAttribute('class') || '').split(/\s+/).filter(c => themed.test(c));
      expect(bad, el.outerHTML.slice(0, 80)).toEqual([]);
    }
  });

  it('every anchor in the registry is a valid CSS selector', () => {
    const frag = document.createDocumentFragment();
    for (const [id, t] of Object.entries(TAB_TIPS)) {
      for (const s of normalizeTabTipSteps(t!)) {
        if (s.anchor) expect(() => frag.querySelector(s.anchor!), `${id}: ${s.anchor}`).not.toThrow();
      }
    }
  });
});
