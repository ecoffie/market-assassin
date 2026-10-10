/**
 * Save search from the DEFAULT Map must not 400 — executed end to end.
 *
 * The default Map turns all three horizons on (Open · Recompete · Forecast). The alert cron emails
 * Open (open now) and Forecast (coming soon) only, and the shared saved-search service refuses any
 * recompete request with 400 unsupported_alert_scope rather than substitute. The Map sent its raw
 * toggles, so every default signed-in save failed from 2026-08-30 (#1400) on, behind a bare
 * "Couldn't save".
 *
 * Here the REAL click handler runs in a VM, and the body it POSTs is fed to the REAL
 * createSavedSearch (DB mocked). So the claims are measured, not inferred:
 *   1. the default Map saves, with the emailable horizons only, and says Recompete is left out;
 *   2. supported horizon sets save exactly as toggled — nothing is added;
 *   3. Recompete alone is refused in the browser with a plain explanation, and nothing is sent;
 *   4. the server's refusal of a recompete scope is unchanged (MCP / direct callers);
 *   5. a server error is shown to the reader, not swallowed;
 *   6. existing saved searches carrying recompete:true are untouched and still editable;
 *   7. the anonymous watch path still stores what it stored, and its alert offer names the horizons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { createSavedSearch, updateSavedSearch } from '@/lib/saved-searches/service';

const mockFrom = vi.fn();
vi.mock('@/lib/app/workspace', () => ({
  getAppSupabase: () => ({ from: mockFrom }),
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
}));

const SRC = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const unT = (s: string) => s.replace(/\\\\/g, '\\');

function saveBlock(): string {
  const s = SRC.indexOf("  var _ss=document.getElementById('saveSearchBtn');");
  const e = SRC.indexOf('  // Apply a SAVED SEARCH to the map in-place');
  if (s < 0 || e < 0) throw new Error('save-search block not found');
  return unT(SRC.slice(s, e));
}

type Horizons = { open?: boolean; recompete?: boolean; forecast?: boolean };
type Run = {
  posts: Array<{ url: string; body: Record<string, unknown> }>;
  prompts: string[]; confirms: string[]; alerts: string[];
};

async function clickSave(opts: {
  horizons?: Horizons; mode?: string; signedIn?: boolean;
  serverReply?: Record<string, unknown>;
}): Promise<Run> {
  const run: Run = { posts: [], prompts: [], confirms: [], alerts: [] };
  const btn: { innerHTML: string; textContent: string; onclick: null | (() => void) } = { innerHTML: '', textContent: '', onclick: null };
  const signedIn = opts.signedIn !== false;
  const win: Record<string, unknown> = { __horizons: opts.horizons, requireSignIn: () => true, __claimAnonWatches() {} };
  const ctx: Record<string, unknown> = {
    window: win, JSON, Object, String, Math,
    MODE: opts.mode ?? 'open', Q: '', FILT: { naics: '541512', agency: '', state: '', setAside: '' },
    map: { getBounds: () => ({ getWest: () => -125, getSouth: () => 24, getEast: () => -66, getNorth: () => 50 }) },
    document: { getElementById: (id: string) => (id === 'saveSearchBtn' ? btn : null) },
    localStorage: { getItem: () => (signedIn ? 'tok' : null) },
    location: { href: '' },
    _uemail: () => (signedIn ? 'reader@example.test' : ''),
    _anonId: () => 'anon:11111111-2222-4333-8444-555555555555',
    _track() {},
    prompt: (msg: string, def: string) => { run.prompts.push(msg); return def; },
    confirm: (msg: string) => { run.confirms.push(msg); return false; },
    alert: (msg: string) => { run.alerts.push(msg); },
    setTimeout: (fn: () => void) => { fn(); return 0; },
    fetch: (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      run.posts.push({ url, body });
      const reply = opts.serverReply ?? { success: true, name: 'x' };
      return Promise.resolve({ json: async () => reply });
    },
  };
  ctx.window = Object.assign(win, { prompt: ctx.prompt });
  vm.createContext(ctx);
  vm.runInContext(saveBlock(), ctx);
  btn.onclick!();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return run;
}

/** Feed what the Map POSTed into the real shared service, with an empty account and a capturing insert. */
async function serverAccepts(body: Record<string, unknown>) {
  let inserted: Record<string, unknown> | null = null;
  mockFrom.mockImplementation(() => ({
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    insert: (row: Record<string, unknown>) => {
      inserted = row;
      return { select: () => ({ single: () => Promise.resolve({ data: { ...row, id: 'new', created_at: 'x', updated_at: 'x' }, error: null }) }) };
    },
  }));
  const res = await createSavedSearch({
    userEmail: String(body.email), name: String(body.name), mode: body.mode as 'open',
    filters: body.filters as Record<string, unknown>, bbox: null,
  });
  return { res, inserted: inserted as Record<string, unknown> | null };
}

const RECOMPETE_NOTE = 'Recompete (coming back) is not included in email alerts.';

describe('Save search from the Map — horizons the alert can deliver', () => {
  beforeEach(() => { mockFrom.mockReset(); });

  it('the DEFAULT Map (all three horizons on) saves — Open + Forecast, Recompete disclosed', async () => {
    const run = await clickSave({ horizons: { open: true, recompete: true, forecast: true } });
    expect(run.posts).toHaveLength(1);
    expect(run.posts[0].url).toBe('/api/app/saved-searches');
    const sent = run.posts[0].body;
    expect((sent.filters as Record<string, unknown>).horizons).toEqual({ open: true, recompete: false, forecast: true });
    expect(run.prompts[0]).toContain('Email alerts will include: Open + Forecast.');
    expect(run.prompts[0]).toContain(RECOMPETE_NOTE);
    expect(run.confirms[0]).toContain('new Open + Forecast matches');
    expect(run.confirms[0]).toContain(RECOMPETE_NOTE);
    expect(run.alerts).toEqual([]);

    const { res, inserted } = await serverAccepts(sent);
    expect(res.ok).toBe(true);
    expect((inserted!.filters as Record<string, unknown>).horizons).toEqual({ open: true, recompete: false, forecast: true });
  });

  it('before the fix the same default body is exactly what the server refuses', async () => {
    const { res } = await serverAccepts({
      email: 'reader@example.test', name: 'n', mode: 'open',
      filters: { naics: '541512', horizons: { open: true, recompete: true, forecast: true } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsupported_alert_scope');
  });

  it.each<[string, Horizons, Horizons, string]>([
    ['Open only', { open: true, recompete: false, forecast: false }, { open: true, recompete: false, forecast: false }, 'Open'],
    ['Open + Forecast', { open: true, recompete: false, forecast: true }, { open: true, recompete: false, forecast: true }, 'Open + Forecast'],
    ['Forecast only', { open: false, recompete: false, forecast: true }, { open: false, recompete: false, forecast: true }, 'Forecast'],
    ['no horizon state (pre-horizon map)', undefined as unknown as Horizons, { open: true, recompete: false, forecast: false }, 'Open'],
  ])('supported set %s saves exactly as toggled, with no Recompete note', async (_n, on, want, label) => {
    const run = await clickSave({ horizons: on });
    const sent = run.posts[0].body;
    expect((sent.filters as Record<string, unknown>).horizons).toEqual(want);
    expect(run.prompts[0]).toContain(`Email alerts will include: ${label}.`);
    expect(run.prompts[0]).not.toContain('Recompete');
    const { res } = await serverAccepts(sent);
    expect(res.ok).toBe(true);
  });

  it('Open + Recompete saves Open only and says so', async () => {
    const run = await clickSave({ horizons: { open: true, recompete: true, forecast: false } });
    expect((run.posts[0].body.filters as Record<string, unknown>).horizons).toEqual({ open: true, recompete: false, forecast: false });
    expect(run.prompts[0]).toContain(RECOMPETE_NOTE);
    expect((await serverAccepts(run.posts[0].body)).res.ok).toBe(true);
  });

  it('Recompete ONLY is refused in the browser with an explanation — nothing is sent, no Open substituted', async () => {
    const run = await clickSave({ horizons: { open: false, recompete: true, forecast: false } });
    expect(run.posts).toEqual([]);
    expect(run.prompts).toEqual([]);
    expect(run.alerts[0]).toContain('Recompete (coming back) is not available as an email alert yet');
  });

  it('a legacy recompete MODE is refused the same way', async () => {
    const run = await clickSave({ mode: 'recompete', horizons: { open: true, recompete: true, forecast: true } });
    expect(run.posts).toEqual([]);
    expect(run.alerts[0]).toContain('not available as an email alert yet');
  });

  it('a server refusal is shown to the reader, not swallowed behind "Couldn\'t save"', async () => {
    const run = await clickSave({
      horizons: { open: true, recompete: false, forecast: false },
      serverReply: { success: false, error: 'scope=profile requires at least one NAICS code' },
    });
    expect(run.alerts[0]).toBe("Couldn't save this search: scope=profile requires at least one NAICS code");
  });
});

describe('Existing saved searches are not touched', () => {
  beforeEach(() => { mockFrom.mockReset(); });

  it('a stored row with horizons.recompete=true still updates (alerts toggle) — scope is not re-validated', async () => {
    const row = {
      id: 'old', user_email: 'reader@example.test', name: 'Old default', mode: 'open',
      filters: { naics: '541512', horizons: { open: true, recompete: true, forecast: true } },
      bbox: null, alerts_enabled: true, alert_frequency: 'daily', last_alerted_at: null,
      last_seen_notice_ids: [], total_alerts_sent: 3, created_at: 'x', updated_at: 'x',
    };
    let patch: Record<string, unknown> | null = null;
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }) }),
      update: (p: Record<string, unknown>) => {
        patch = p;
        return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { ...row, ...p }, error: null }) }) }) }) };
      },
    }));
    const res = await updateSavedSearch({ userEmail: 'reader@example.test', id: 'old', alertFrequency: 'weekly' });
    expect(res.ok).toBe(true);
    expect(patch).not.toBeNull();
    expect(patch!).not.toHaveProperty('filters');
  });

  it('the Map save path only ever INSERTS — it never sends a write for an existing row', async () => {
    const run = await clickSave({ horizons: { open: true, recompete: true, forecast: true } });
    expect(run.posts.map((p) => p.url)).toEqual(['/api/app/saved-searches']);
    expect(run.posts[0].body).not.toHaveProperty('id');
    expect(run.posts[0].body).not.toHaveProperty('action');
  });
});

describe('Anonymous watch path', () => {
  it('stores the toggles it always stored, and the alert offer names the emailable horizons', async () => {
    const run = await clickSave({ signedIn: false, horizons: { open: true, recompete: true, forecast: true } });
    expect(run.posts[0].url).toBe('/api/app/map-watch');
    expect((run.posts[0].body.filters as Record<string, unknown>).horizons).toEqual({ open: true, recompete: true, forecast: true });
    expect(run.confirms[0]).toContain('Get email alerts for new Open + Forecast matches?');
    expect(run.confirms[0]).toContain(RECOMPETE_NOTE);
  });

  it('a Recompete-only anonymous watch is kept, and no alert is offered', async () => {
    const run = await clickSave({ signedIn: false, horizons: { open: false, recompete: true, forecast: false } });
    expect(run.posts[0].url).toBe('/api/app/map-watch');
    expect(run.confirms).toEqual([]);
  });
});
