/**
 * Today home (draft, default OFF): the switch, the data parsing (unknown is never zero) and the call
 * sites in /app that must leave the app unchanged while the switch is off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  homePanel,
  isTodayHomeEnabled,
  isTodayPanelParam,
  parseTodayMatches,
  parseTodaySearches,
  savedSearchLine,
  todayRequests,
} from './today-home';
import { KNOWN_PANELS } from './known-panels';

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

afterEach(() => { vi.unstubAllEnvs(); });

describe('the switch is OFF by default', () => {
  it('only the exact value "on" turns it on', () => {
    expect(isTodayHomeEnabled(undefined)).toBe(false);
    expect(isTodayHomeEnabled('')).toBe(false);
    expect(isTodayHomeEnabled('true')).toBe(false);
    expect(isTodayHomeEnabled('1')).toBe(false);
    expect(isTodayHomeEnabled('on')).toBe(true);
  });

  it('reads NEXT_PUBLIC_TODAY_HOME when no value is passed', () => {
    vi.stubEnv('NEXT_PUBLIC_TODAY_HOME', '');
    expect(isTodayHomeEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_TODAY_HOME', 'on');
    expect(isTodayHomeEnabled()).toBe(true);
  });

  it('off: the home panel is still the dashboard and ?panel=today is ignored', () => {
    expect(homePanel(false, 'dashboard')).toBe('dashboard');
    expect(isTodayPanelParam('today', false)).toBe(false);
    expect(KNOWN_PANELS.has('today' as never)).toBe(false);
  });

  it('on: Today is home and deep-linkable', () => {
    expect(homePanel(true, 'dashboard')).toBe('today');
    expect(isTodayPanelParam('today', true)).toBe(true);
    expect(isTodayPanelParam('map', true)).toBe(false);
  });
});

describe('saved searches (watchlist-brief) — unknown is never zero', () => {
  it('a failed or malformed response is unavailable, not an empty list', () => {
    expect(parseTodaySearches(null)).toEqual({ state: 'unavailable' });
    expect(parseTodaySearches({ success: false, error: 'x' })).toEqual({ state: 'unavailable' });
    expect(parseTodaySearches({ success: true })).toEqual({ state: 'unavailable' });
  });

  it('keeps rows with real counts and drops rows whose counts are missing', () => {
    const r = parseTodaySearches({
      success: true,
      searches: [
        { id: 's1', name: 'Cyber at VA', newCount: 4, matchedCount: 22, capped: false },
        { id: 's2', name: 'No counts' },
        { id: 's3', name: '', newCount: 0, matchedCount: 300, capped: true },
      ],
    });
    expect(r).toEqual({
      state: 'ok',
      value: [
        { id: 's1', name: 'Cyber at VA', newCount: 4, matchedCount: 22, capped: false },
        { id: 's3', name: 'Saved search', newCount: 0, matchedCount: 300, capped: true },
      ],
    });
  });

  it('"new since your last visit" only when there is something new; a capped count reads as a floor', () => {
    expect(savedSearchLine({ id: 'a', name: 'A', newCount: 4, matchedCount: 22, capped: false }))
      .toBe('4 new since your last visit · 22 open matches');
    expect(savedSearchLine({ id: 'a', name: 'A', newCount: 0, matchedCount: 1, capped: false })).toBe('1 open match');
    expect(savedSearchLine({ id: 'a', name: 'A', newCount: 0, matchedCount: 300, capped: true })).toBe('300+ open matches');
    expect(savedSearchLine({ id: 'a', name: 'A', newCount: 0, matchedCount: 5, capped: false })).not.toContain('0 new');
  });
});

describe('top matches (mi-dashboard)', () => {
  it('a failed response is unavailable', () => {
    expect(parseTodayMatches(undefined)).toEqual({ state: 'unavailable' });
    expect(parseTodayMatches({ success: false })).toEqual({ state: 'unavailable' });
  });

  it('keeps at most three rows with a valid SAM notice id and a title', () => {
    const opp = (i: number, over: Record<string, unknown> = {}) => ({
      notice_id: String(i).repeat(32).slice(0, 32), title: `Opp ${i}`, department: 'GSA', response_deadline: '2026-12-04T17:00:00Z', ...over,
    });
    const r = parseTodayMatches({ success: true, opportunities: [opp(1, { notice_id: 'bad' }), opp(2), opp(3, { title: '' }), opp(4), opp(5), opp(6)] });
    expect(r.state).toBe('ok');
    if (r.state !== 'ok') return;
    expect(r.value.map((m) => m.title)).toEqual(['Opp 2', 'Opp 4', 'Opp 5']);
    expect(r.value[0]).toEqual({ noticeId: '2'.repeat(32), title: 'Opp 2', buyer: 'GSA', deadline: '2026-12-04' });
  });

  it('reads only the existing APIs', () => {
    expect(todayRequests('a+b@c.com')).toEqual({
      searches: '/api/app/watchlist-brief?email=a%2Bb%40c.com',
      matches: '/api/mi-dashboard?email=a%2Bb%40c.com&limit=3',
    });
  });
});

describe('call sites in /app', () => {
  const page = read('app', 'app', 'page.tsx');
  const sidebar = read('components', 'app', 'UnifiedSidebar.tsx');
  const panels = read('components', 'app', 'panels', 'index.tsx');
  const todayPanel = read('components', 'app', 'panels', 'TodayPanel.tsx');

  it('/app starts on HOME_PANEL, which is the dashboard unless the switch is on', () => {
    expect(page).toContain("const TODAY_HOME = isTodayHomeEnabled();");
    expect(page).toContain("const HOME_PANEL: AppPanel = homePanel(TODAY_HOME, 'dashboard');");
    expect(page).toContain('useState<AppPanel>(HOME_PANEL)');
    expect(page).toContain('useRef<AppPanel>(HOME_PANEL)');
    expect(page).not.toContain("useState<AppPanel>('dashboard')");
    // Reload returns home; the URL drops ?panel= only for home.
    expect(page).toContain('setActivePanel(HOME_PANEL);');
    expect(page).toContain("if (panel !== HOME_PANEL) params.set('panel', panel);");
    // ?panel=today is honoured only through the switch.
    expect(page).toContain('isTodayPanelParam(panelParam, TODAY_HOME)');
  });

  it('the sidebar shows Today only while the switch is on, above Map', () => {
    expect(sidebar).toContain('const TODAY_HOME = isTodayHomeEnabled();');
    const nav = sidebar.slice(sidebar.indexOf('<nav className="flex-1'));
    const today = nav.indexOf('{TODAY_HOME && renderShellItem(TODAY_ITEM)}');
    expect(today).toBeGreaterThan(-1);
    expect(today).toBeLessThan(nav.indexOf('renderShellItem(MAP_ITEM)'));
  });

  it('the panel router renders Today only while the switch is on', () => {
    expect(panels).toMatch(/case 'today':\s*return TODAY_HOME\s*\?\s*<TodayPanel /);
  });

  it('Today never marks the Watchlist seen and uses the existing Ask Mindy handoff', () => {
    expect(todayPanel).not.toContain('mark_seen');
    expect(todayPanel).toContain('MAP_SELECTED_OPP_KEY');
    expect(todayPanel).toContain("onPanelChange?.('chat')");
    expect(todayPanel).toContain("onPanelChange?.('map')");
  });
});
