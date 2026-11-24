// @vitest-environment jsdom
/**
 * "Start here" for signed-in users (nightly team, 2026-11-23). Every onboarding finish lands on the
 * homepage ('/?onboarded=1'), which used to show only the signed-out sales page; the ProductTour
 * auto-start listens on /app?onboarded=1, which nothing links to any more. These tests pin the
 * 3-step guide, its real destinations, its show/hide rules, and that the homepage renders it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import HomePage from './page';
import FirstRunGuide, { FirstRunGuideView } from './FirstRunGuide';
import {
  FIRST_RUN_GUIDE_KEY,
  FIRST_RUN_STEPS,
  markStepDone,
  parseGuideState,
  readGuideState,
  shouldShowGuide,
  writeGuideState,
} from '@/lib/onboarding/first-run-guide';
import { MAPS_HOME_PATH } from '@/lib/mindy/maps-home';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();
// Mirrors the account script's announce(): window.__mindySession first, then the event.
const sessionEvent = (s: string) => {
  (window as { __mindySession?: unknown }).__mindySession = s;
  document.dispatchEvent(new CustomEvent('mindy:session', { detail: s }));
};

describe('first-run guide: steps', () => {
  it('is exactly the 3-step daily workflow, in order', () => {
    expect(FIRST_RUN_STEPS.map((s) => s.title)).toEqual([
      'Tell Mindy what you sell',
      "See what's new for you",
      'Ask Mindy about a match',
    ]);
  });

  it('every step links to a page that exists today', () => {
    const routeFile: Record<string, string> = {
      '/opportunity-map': 'src/app/opportunity-map/route.ts',
      '/opportunity-map/saved': 'src/app/opportunity-map/saved/route.ts',
    };
    for (const s of FIRST_RUN_STEPS) {
      expect(routeFile[s.href], s.href).toBeTruthy();
      expect(() => readFileSync(join(ROOT, routeFile[s.href]))).not.toThrow();
    }
  });

  it('names controls that really exist on the Map (no invented buttons)', () => {
    const map = readFileSync(join(ROOT, 'src/app/opportunity-map/route.ts'), 'utf8');
    expect(map).toContain('</svg>Save search</button>');
    expect(map).toContain('>Ask Mindy about this opportunity</button>');
    expect(FIRST_RUN_STEPS[0].detail).toContain('Save search');
    expect(FIRST_RUN_STEPS[2].detail).toContain('Ask Mindy about this opportunity');
    // "Updates" is the account-menu label for /opportunity-map/saved.
    const menu = readFileSync(join(ROOT, 'src/app/opportunity-map/account-menu.ts'), 'utf8');
    expect(menu).toMatch(/href="\/opportunity-map\/saved"[^>]*>.*?Updates<\/a>/);
  });

  it('carries no prices, plans or trial claims', () => {
    const copy = FIRST_RUN_STEPS.map((s) => `${s.title} ${s.detail} ${s.cta}`).join(' ');
    expect(copy).not.toMatch(/\$|price|plan|trial|free|credit/i);
  });
});

describe('first-run guide: state', () => {
  it('shows only to a signed-in visitor who has not dismissed or finished it', () => {
    const fresh = parseGuideState(null);
    expect(shouldShowGuide('valid', fresh)).toBe(true);
    expect(shouldShowGuide('signed-out', fresh)).toBe(false);
    expect(shouldShowGuide(undefined, fresh)).toBe(false);
    expect(shouldShowGuide('valid', { ...fresh, dismissed: true })).toBe(false);
    const all = FIRST_RUN_STEPS.reduce((st, s) => markStepDone(st, s.id), fresh);
    expect(shouldShowGuide('valid', all)).toBe(false);
    expect(shouldShowGuide('valid', markStepDone(fresh, 'whats-new'))).toBe(true);
  });

  it('survives corrupt or hostile stored values', () => {
    expect(parseGuideState('not json')).toEqual({ dismissed: false, done: [] });
    expect(parseGuideState('{"dismissed":"yes","done":["ask-mindy","bogus","ask-mindy",3]}'))
      .toEqual({ dismissed: false, done: ['ask-mindy'] });
  });

  it('never throws when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readGuideState(blocked)).toEqual({ dismissed: false, done: [] });
    expect(() => writeGuideState(blocked, { dismissed: true, done: [] })).not.toThrow();
    expect(readGuideState(null)).toEqual({ dismissed: false, done: [] });
  });
});

describe('first-run guide: view', () => {
  it('renders three numbered links to the real pages and a Hide button', () => {
    const d = new DOMParser().parseFromString(renderToStaticMarkup(<FirstRunGuideView state={parseGuideState(null)} />), 'text/html');
    expect(d.querySelector('h2')?.textContent).toBe('Start here');
    expect(Array.from(d.querySelectorAll('li a')).map((a) => a.getAttribute('href')))
      .toEqual(['/opportunity-map', '/opportunity-map/saved', '/opportunity-map']);
    expect(d.querySelector('[data-testid="first-run-guide-dismiss"]')?.textContent).toBe('Hide');
    expect(d.body.textContent).toContain('0 of 3 opened');
  });
});

describe('first-run guide: on the homepage (call site)', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    window.localStorage.clear();
    delete (window as { __mindySession?: unknown }).__mindySession;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('onboarding finishes land on the homepage', () => {
    // If this moves, the guide has to move with it.
    expect(MAPS_HOME_PATH).toBe('/');
    const onboarding = readFileSync(join(ROOT, 'src/app/app/onboarding/page.tsx'), 'utf8');
    expect(onboarding).toContain('`${MAPS_HOME_PATH}?onboarded=1`');
  });

  it('a signed-out visitor sees the sales page and no guide', () => {
    act(() => root.render(<HomePage />));
    expect(host.querySelector('[data-testid="first-run-guide"]')).toBeNull();
  });

  it('a signed-in visitor sees Start here; Hide removes it for good', () => {
    act(() => root.render(<HomePage />));
    act(() => sessionEvent('valid'));
    const guide = host.querySelector('[data-testid="first-run-guide"]');
    expect(guide).not.toBeNull();
    expect(guide?.querySelectorAll('li a')).toHaveLength(3);

    act(() => (host.querySelector('[data-testid="first-run-guide-dismiss"]') as HTMLButtonElement).click());
    expect(host.querySelector('[data-testid="first-run-guide"]')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(FIRST_RUN_GUIDE_KEY) || '{}').dismissed).toBe(true);
  });

  it('opening a step ticks it; opening all three completes the guide', () => {
    // Links navigate in a browser; jsdom does not, so stop the navigation and keep the click.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('click', stop);
    (window as { __mindySession?: unknown }).__mindySession = 'valid';
    act(() => root.render(<FirstRunGuide />));
    const links = () => Array.from(host.querySelectorAll('li a')) as HTMLAnchorElement[];
    act(() => links()[1].click());
    expect(host.querySelector('li[data-step="whats-new"]')?.getAttribute('data-done')).toBe('1');
    expect(host.textContent).toContain('1 of 3 opened');
    act(() => links()[0].click());
    act(() => links()[2].click());
    expect(host.querySelector('[data-testid="first-run-guide"]')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(FIRST_RUN_GUIDE_KEY) || '{}').done).toHaveLength(3);
    document.removeEventListener('click', stop);
  });
});
