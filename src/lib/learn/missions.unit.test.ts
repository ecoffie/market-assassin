/**
 * The rules the approved Learn copy depends on (Eric, 2026-10-10). Each one is a decision, not a style.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTION_PLAN_STEPS } from './action-plan';
import { MISSIONS, OUTSIDE_STEPS, STAGES, missionById } from './missions';

const ALL_TEXT = JSON.stringify({ MISSIONS, OUTSIDE_STEPS, STAGES });

describe('coverage — all 27 Action Plan steps, stable IDs', () => {
  it('every step is taught by a mission or listed as Outside Mindy', () => {
    const covered = new Set([...MISSIONS.flatMap((m) => m.steps), ...OUTSIDE_STEPS.map((o) => o.step)]);
    for (const s of ACTION_PLAN_STEPS) expect(covered.has(s.id), s.id).toBe(true);
  });
  it('no mission cites a step that does not exist', () => {
    const ids = new Set(ACTION_PLAN_STEPS.map((s) => s.id));
    for (const id of [...MISSIONS.flatMap((m) => m.steps), ...OUTSIDE_STEPS.map((o) => o.step)]) expect(ids.has(id), id).toBe(true);
  });
  it('the approved mission set: B1–B7, I1–I6, A1–A8, W1–W4', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual([
      'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6',
      'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'W1', 'W2', 'W3', 'W4',
    ]);
  });
  it('ids and slugs are unique; every Next exists', () => {
    expect(new Set(MISSIONS.map((m) => m.slug)).size).toBe(MISSIONS.length);
    for (const m of MISSIONS) if (m.next) expect(missionById(m.next), `${m.id} → ${m.next}`).not.toBeNull();
  });
});

describe('stages — Beginner / Intermediate / Advanced, then After the Win', () => {
  it('names and order', () => {
    expect(STAGES.map((s) => `${s.level}:${s.name}`)).toEqual([
      'Beginner:Learn the Game', 'Intermediate:Play the Game', 'Advanced:Win the Game', 'After the Win:After the Win',
    ]);
  });
  it('B → learn, I → play, A → win, W → after (B6/B7 stay in Beginner)', () => {
    for (const m of MISSIONS) expect(m.stage).toBe({ B: 'learn', I: 'play', A: 'win', W: 'after' }[m.id[0]]);
  });
});

describe('honest availability', () => {
  it('Coming next and Outside Mindy missions have no Do-it link', () => {
    for (const m of MISSIONS) if (m.status !== 'live') expect(m.doIt, m.id).toBeUndefined();
  });
  it('every live mission has a Do-it link', () => {
    for (const m of MISSIONS) if (m.status === 'live') expect(m.doIt, m.id).toBeDefined();
  });
  it('Coming next = I6, A7, A8; After the Win is outside Mindy', () => {
    expect(MISSIONS.filter((m) => m.status === 'coming-next').map((m) => m.id)).toEqual(['I6', 'A7', 'A8']);
    expect(MISSIONS.filter((m) => m.stage === 'after').every((m) => m.status === 'outside' && m.access === 'outside')).toBe(true);
  });
  it('proposal tutorials are labeled Pro (decision 2): A1, A3, A4', () => {
    expect(MISSIONS.filter((m) => m.access === 'pro').map((m) => m.id)).toEqual(['A1', 'A3', 'A4']);
  });
  it('a Pro label never claims the action is blocked', () => {
    expect(ALL_TEXT).not.toMatch(/\b(locked|blocked|upgrade to unlock|requires an upgrade)\b/i);
  });
  it('exactly five live missions are "Not tracked yet" (decision 3): I2, I4, I5, A2, A5', () => {
    expect(MISSIONS.filter((m) => m.status !== 'outside' && !m.tracked).map((m) => m.id)).toEqual(['I2', 'I4', 'I5', 'A2', 'A5']);
  });
});

describe('Do-it links land on the view the tutorial describes', () => {
  // A market parameter makes the Map's return-memory restore stand down (return-continuity rule).
  const MARKET = /[?&](horizon|mode|strategy|setAside|naics|q|state|agency)=/;
  const HONORED = new Set(['horizon', 'mode', 'strategy', 'setAside', 'next']);
  for (const m of MISSIONS.filter((x) => x.doIt)) {
    it(`${m.id}: ${m.doIt!.href}`, () => {
      const u = new URL(m.doIt!.href, 'https://getmindy.ai');
      expect(u.pathname.startsWith('/')).toBe(true);
      for (const k of u.searchParams.keys()) expect(HONORED.has(k), `${m.id} param ${k}`).toBe(true);
      if (u.pathname === '/opportunity-map') expect(m.doIt!.href).toMatch(MARKET);
      const hz = u.searchParams.get('horizon');
      if (hz) for (const h of hz.split(',')) expect(['open', 'recompete', 'forecast']).toContain(h);
      const mode = u.searchParams.get('mode');
      if (mode) expect(['open', 'recompete', 'forecast', 'companies']).toContain(mode);
    });
  }
  it('B5 (watch) opens with Coming Back OFF — a watch cannot email it', () => {
    expect(missionById('B5')!.doIt!.href).toBe('/opportunity-map?horizon=open,forecast');
  });
});

describe('vocabulary', () => {
  it('uses the horizon names, Tutorial Library, never Playbook', () => {
    expect(ALL_TEXT).toContain('Coming Back');
    expect(ALL_TEXT).toContain('Coming Soon');
    expect(ALL_TEXT).not.toMatch(/playbook/i);
  });
  it('no invented dollar figures in tutorial copy (decision 5)', () => {
    expect(ALL_TEXT).not.toMatch(/\$\s?\d/);
  });
  it('no internal notes leak into rendered fields', () => {
    const rendered = JSON.stringify(MISSIONS.map(({ evidence: _e, ...rest }) => rest));
    expect(rendered).not.toMatch(/user_|saved_searches|mcp_call_log|ruling|E[3-8]\b|PR \d/);
  });
  it('every glossary link resolves', () => {
    const g = readFileSync(join(process.cwd(), 'src/data/glossary.ts'), 'utf8');
    for (const slug of new Set(MISSIONS.flatMap((m) => m.glossary || []))) expect(g, slug).toMatch(new RegExp(`slug: *['"]${slug}['"]`));
  });
});
