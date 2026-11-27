import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appActionsEnabledFor, parseActionSurface, actionNamesFor, proposeAppActionToolDef, createAppActionProposer,
  PROPOSE_APP_ACTION, APP_ACTIONS_NOTE, WRITE_CONFIRM_HINTS, pendingWriteNote, type ActionEvent,
} from './propose';
import { ACTIONS, MAX_ACTIONS_PER_TURN } from './registry';

const mk = (o: { surface?: 'map' | 'app'; hasPro?: boolean } = {}) => {
  const sent: ActionEvent[] = [];
  let n = 0;
  const p = createAppActionProposer({ surface: o.surface ?? 'map', hasPro: o.hasPro ?? false, emit: (e) => sent.push(e), newId: () => `act-${++n}` });
  return { p, sent };
};

describe('appActionsEnabledFor (flag + allowlist, default off)', () => {
  it('off without the flag, on only for listed emails or *', () => {
    expect(appActionsEnabledFor('eric@x.com', {})).toBe(false);
    expect(appActionsEnabledFor('eric@x.com', { ASK_MINDY_APP_ACTIONS_ALLOWLIST: 'eric@x.com' })).toBe(false);
    expect(appActionsEnabledFor('Eric@X.com', { ASK_MINDY_APP_ACTIONS: 'true', ASK_MINDY_APP_ACTIONS_ALLOWLIST: ' eric@x.com ,erika@x.com' })).toBe(true);
    expect(appActionsEnabledFor('other@x.com', { ASK_MINDY_APP_ACTIONS: 'true', ASK_MINDY_APP_ACTIONS_ALLOWLIST: 'eric@x.com' })).toBe(false);
    expect(appActionsEnabledFor('any@x.com', { ASK_MINDY_APP_ACTIONS: 'true', ASK_MINDY_APP_ACTIONS_ALLOWLIST: '*' })).toBe(true);
    expect(appActionsEnabledFor(null, { ASK_MINDY_APP_ACTIONS: 'true', ASK_MINDY_APP_ACTIONS_ALLOWLIST: '*' })).toBe(false);
    expect(appActionsEnabledFor('eric@x.com', { ASK_MINDY_APP_ACTIONS: '1', ASK_MINDY_APP_ACTIONS_ALLOWLIST: '*' })).toBe(false);
  });
});

describe('parseActionSurface', () => {
  it('explicit surface wins; the Map drawer is recognised by its display hint; default is the app', () => {
    expect(parseActionSurface({ surface: 'map' })).toBe('map');
    expect(parseActionSurface({ surface: 'app', display: 'narrow_panel' })).toBe('app');
    expect(parseActionSurface({ display: 'narrow_panel' })).toBe('map');
    expect(parseActionSurface({})).toBe('app');
    expect(parseActionSurface({ surface: 'evil' })).toBe('app');
  });
});

describe('proposeAppActionToolDef', () => {
  it('names only this surface\'s registered actions; no top-level oneOf/anyOf (providers refuse it)', () => {
    const def = proposeAppActionToolDef('map');
    expect(def.function.name).toBe(PROPOSE_APP_ACTION);
    const params = def.function.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
    expect(params).not.toHaveProperty('oneOf');
    expect(params).not.toHaveProperty('anyOf');
    expect((params.properties as { name: { enum: string[] } }).name.enum).toEqual(actionNamesFor('map'));
    for (const n of actionNamesFor('map')) expect(def.function.description).toContain(n);
  });
  it('the app surface has no actions yet, so the route never offers the tool there', () => {
    expect(actionNamesFor('app')).toEqual(Object.entries(ACTIONS).filter(([, d]) => d.surfaces.includes('app')).map(([n]) => n));
    expect(actionNamesFor('app')).toHaveLength(0);
  });
});

describe('createAppActionProposer', () => {
  it('a valid view action is emitted once, normalised by the registry, and the model is told "proposed", never done', () => {
    const { p, sent } = mk();
    const r = p.propose({ name: 'map.apply_view', args: { q: '  janitorial  ', filters: { state: 'fl, ga' } } });
    expect(r).toMatchObject({ status: 'proposed', id: 'act-1' });
    expect(String(r.note)).toMatch(/Do not say it was done/);
    expect(sent).toEqual([{ type: 'action', id: 'act-1', name: 'map.apply_view', args: { q: 'janitorial', filters: { state: 'FL,GA' } } }]);
    expect(sent[0]).not.toHaveProperty('needs_confirm');
  });

  it('invalid input is refused whole and nothing is emitted (unknown name, unknown arg, bad value, wrong surface)', () => {
    const { p, sent } = mk();
    expect(p.propose({ name: 'map.delete_everything', args: {} })).toMatchObject({ status: 'rejected', reason: 'unknown' });
    expect(p.propose({ name: 'map.search', args: { q: 'x y', url: 'https://evil' } })).toMatchObject({ status: 'rejected', reason: 'arg:url' });
    expect(p.propose({ name: 'map.go_to', args: { state: 'Florida' } })).toMatchObject({ status: 'rejected', reason: 'place' });
    expect(p.propose({ name: 'map.search', args: { q: '<script>' } })).toMatchObject({ status: 'rejected', reason: 'q' });
    expect(p.propose({} as Record<string, unknown>)).toMatchObject({ status: 'rejected' });
    expect(sent).toEqual([]);
    const app = mk({ surface: 'app' });
    expect(app.p.propose({ name: 'map.search', args: { q: 'janitorial' } })).toMatchObject({ status: 'rejected', reason: 'surface' });
    expect(app.sent).toEqual([]);
  });

  it(`at most ${MAX_ACTIONS_PER_TURN} accepted per turn; refusals do not use up the budget`, () => {
    const { p, sent } = mk();
    p.propose({ name: 'map.go_to', args: { state: 'zz9' } }); // refused
    for (let i = 0; i < MAX_ACTIONS_PER_TURN; i++) expect(p.propose({ name: 'map.go_to', args: { state: 'FL' } }).status).toBe('proposed');
    expect(p.propose({ name: 'map.go_to', args: { national: true } })).toMatchObject({ status: 'rejected', reason: 'max' });
    expect(sent).toHaveLength(MAX_ACTIONS_PER_TURN);
    expect(p.log.map((l) => l.outcome)).toEqual(['rejected:place', 'proposed', 'proposed', 'proposed', 'rejected:max']);
  });

  it('map.open_record only for a notice id a tool returned THIS turn (never one only the model typed)', () => {
    const { p, sent } = mk();
    expect(p.propose({ name: 'map.open_record', args: { notice_id: 'abc123def' } })).toMatchObject({ status: 'rejected', reason: 'unsourced' });
    // A previous action's own reply is not evidence.
    p.observeToolResult(PROPOSE_APP_ACTION, '{"notice_id":"abc123def"}');
    expect(p.propose({ name: 'map.open_record', args: { notice_id: 'abc123def' } })).toMatchObject({ status: 'rejected', reason: 'unsourced' });
    p.observeToolResult('find_opportunities', JSON.stringify({ open: [{ notice_id: 'abc123def', title: 'Janitorial' }] }));
    expect(p.propose({ name: 'map.open_record', args: { notice_id: 'abc123def' } })).toMatchObject({ status: 'proposed' });
    expect(sent.map((e) => e.name)).toEqual(['map.open_record']);
  });

  it('a pro-gated or write action follows the gate and carries needs_confirm (registry entries injected for the test)', () => {
    const saved = { ...ACTIONS };
    try {
      ACTIONS['map.save_test'] = { ...ACTIONS['map.search'], kind: 'write', needsConfirm: true, gate: 'pro' };
      const free = mk({ hasPro: false });
      expect(free.p.propose({ name: 'map.save_test', args: { q: 'janitorial' } })).toMatchObject({ status: 'rejected', reason: 'gate' });
      expect(free.sent).toEqual([]);
      const pro = mk({ hasPro: true });
      const r = pro.p.propose({ name: 'map.save_test', args: { q: 'janitorial' } });
      expect(r).toMatchObject({ status: 'proposed' });
      expect(String(r.note)).toMatch(/NOT DONE YET/);
      expect(String(r.note)).toContain('Click the button under this answer to confirm it.');
      expect(pro.sent[0]).toMatchObject({ name: 'map.save_test', needs_confirm: true });
    } finally {
      for (const k of Object.keys(ACTIONS)) if (!(k in saved)) delete ACTIONS[k];
    }
  });
});

describe('pending writes are worded as waiting, never as done (prod: "I\'ve sent … to your pursuits" before Add)', () => {
  it('every registered write has a hint, and its button matches the Map client\'s ACT_WRITES label', () => {
    const writes = Object.entries(ACTIONS).filter(([, d]) => d.needsConfirm).map(([n]) => n).sort();
    expect(Object.keys(WRITE_CONFIRM_HINTS).sort()).toEqual(writes);
    const mapSrc = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
    const m = mapSrc.match(/var ACT_WRITES=(\{[^}]*\});/);
    expect(m).not.toBeNull();
    const client = JSON.parse(m![1].replace(/'/g, '"')) as Record<string, string>;
    for (const n of writes) expect(client[n]).toBe(WRITE_CONFIRM_HINTS[n].button);
  });

  it('add_to_pursuits returns the click instruction and forbids done-wording', () => {
    const note = pendingWriteNote('map.add_to_pursuits');
    expect(note).toContain('Say exactly: "Click Add to save it to My Pursuits."');
    expect(note).toMatch(/NOT DONE YET/);
    expect(note).toMatch(/Never write "I've added", "I've sent"/);
  });

  it('the proposer hands the model that note for a real pursuits write', () => {
    const { p, sent } = mk();
    p.observeToolResult('find_opportunities', JSON.stringify({ open: [{ notice_id: 'abc123def' }] }));
    const r = p.propose({ name: 'map.add_to_pursuits', args: { kind: 'opportunity', notice_id: 'abc123def' } });
    expect(r).toMatchObject({ status: 'proposed', note: pendingWriteNote('map.add_to_pursuits') });
    expect(sent[0]).toMatchObject({ name: 'map.add_to_pursuits', needs_confirm: true });
  });

  it('the system note tells the model a write is waiting until the click', () => {
    expect(APP_ACTIONS_NOTE).toMatch(/only WAITING until the customer clicks/);
    expect(APP_ACTIONS_NOTE).toContain('Click Add to save it to My Pursuits');
  });
});

describe('chat route wiring (static guard)', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/app/chat/route.ts'), 'utf8');
  it('never offered on card turns, only behind the flag, only where the surface has actions', () => {
    expect(src).toMatch(/const actions: AppActionProposer \| null = !cardCtx && appActionsEnabledFor\(auth\.email\) && actionNamesFor\(actionSurface\)\.length/);
  });
  it('the tool runs only through the proposer, and every successful result feeds the open_record evidence', () => {
    expect(src).toMatch(/if \(actions && n === PROPOSE_APP_ACTION\) \{\s*const r = actions\.propose\(a\);/);
    expect(src).toMatch(/onResult: \(n: string, c: string\) => actions\.observeToolResult\(n, c\)/);
  });
  it('research mode: the actions note rides in the per-turn system part, never the cached static prefix', () => {
    expect(src).toMatch(/system: RESEARCH_SYSTEM_STATIC,\n\s*systemDynamic: researchSystemDynamic\(\{ today, profileBlock: userProfileBlock \}\) \+ \(actions \? `\\n\\n\$\{APP_ACTIONS_NOTE\}` : ''\),/);
  });
});
