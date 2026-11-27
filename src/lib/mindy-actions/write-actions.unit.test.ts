/**
 * Ask Mindy write actions: parse, idempotency, and that every action goes through the button's own lib with
 * DB-sourced pursuit fields (never model args).
 */
import { describe, it, expect, vi } from 'vitest';
import { parseWriteAction, executeWriteAction, type WriteActionDeps, type WriteAction } from './write-actions';

const CTX = { email: 'pat@example.com', workspaceId: 'ws-1', asClient: false, clientOwnerEmail: 'client@x', origin: '' };

function fakeDb(rows: Record<string, Record<string, unknown> | null>) {
  return {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return q;
    },
  } as unknown as WriteActionDeps['db'];
}

function deps(over: Partial<WriteActionDeps> = {}, rows: Record<string, Record<string, unknown> | null> = {}): WriteActionDeps {
  return {
    db: fakeDb(rows),
    createSavedSearch: vi.fn(async (i) => ({ ok: true as const, data: { search: { id: 'ss-1', name: i.name, alerts_enabled: i.alertsEnabled, alert_frequency: i.alertFrequency ?? 'daily' }, idempotent: false } })),
    updateSavedSearch: vi.fn(async (i) => ({ ok: true as const, data: { search: { id: i.id, name: 'VA construction FL', alerts_enabled: i.alertsEnabled, alert_frequency: i.alertFrequency ?? 'daily' }, noop: false } })),
    createCanonicalPursuit: vi.fn(async () => ({ kind: 'created' as const, pursuit: { id: 'p-1' }, family: null, postWrite: null })),
    removeOwnedPursuit: vi.fn(async () => ({ kind: 'removed' as const, row: { id: 'p-1', title: 'Roofing', stage: 'tracking' } })),
    ...over,
  };
}
const act = (name: string, args: unknown) => {
  const p = parseWriteAction(name, args);
  if (!p.ok) throw new Error(p.error);
  return p.action as WriteAction;
};

describe('parseWriteAction', () => {
  it('accepts the four names (bare or mindy.-prefixed) and refuses anything else', () => {
    expect(parseWriteAction('mindy.save_search', { name: 'x', filters: {} }).ok).toBe(true);
    expect(parseWriteAction('delete_account', {}).ok).toBe(false);
    expect(parseWriteAction('save_search', { name: 'x' }).ok).toBe(false); // no filters
    expect(parseWriteAction('save_search', { name: 'x', filters: {}, alert_frequency: '9am' }).ok).toBe(false);
    expect(parseWriteAction('update_alert', { search_id: 'a' }).ok).toBe(false);
    expect(parseWriteAction('add_to_pursuits', {}).ok).toBe(false);
    expect(parseWriteAction('remove_from_pursuits', {}).ok).toBe(false);
  });
  it('maps alert choices: off/paused/none → off', () => {
    for (const v of ['off', 'paused', 'none']) {
      const p = parseWriteAction('update_alert', { search_id: 'a', alert_frequency: v });
      expect(p.ok && p.action.name === 'update_alert' && p.action.args.alert).toBe('off');
    }
  });
});

describe('save_search / update_alert', () => {
  it('calls createSavedSearch with the alert choice and returns a showable line + Map deep link', async () => {
    const d = deps();
    const r = await executeWriteAction(act('save_search', { name: 'VA construction FL', filters: { agency: 'VA' }, alert_frequency: 'weekly' }), 'a1', CTX, d);
    expect(d.createSavedSearch).toHaveBeenCalledWith(expect.objectContaining({ userEmail: CTX.email, alertsEnabled: true, alertFrequency: 'weekly', mode: 'open' }));
    expect(r).toMatchObject({ ok: true, action_id: 'a1', message: "Saved 'VA construction FL' · weekly alerts", target: { kind: 'saved_search', id: 'ss-1', href: '/opportunity-map?ss=ss-1&src=ask_mindy' } });
  });
  it('off saves with alerts disabled', async () => {
    const d = deps();
    const r = await executeWriteAction(act('save_search', { name: 'n', filters: {}, alert_frequency: 'off' }), 'a', CTX, d);
    expect(d.createSavedSearch).toHaveBeenCalledWith(expect.objectContaining({ alertsEnabled: false, alertFrequency: 'paused' }));
    expect(r.message).toContain('alerts off');
  });
  it('a repeated save is idempotent: already=true, nothing new', async () => {
    const d = deps({ createSavedSearch: vi.fn(async () => ({ ok: true as const, data: { search: { id: 'ss-1', name: 'n', alerts_enabled: true, alert_frequency: 'daily' }, idempotent: true } })) });
    const r = await executeWriteAction(act('save_search', { name: 'n', filters: {} }), 'a', CTX, d);
    expect(r).toMatchObject({ ok: true, already: true });
    expect(r.message).toMatch(/^Already saved/);
  });
  it('a service refusal passes through with its code (no silent success)', async () => {
    const d = deps({ createSavedSearch: vi.fn(async () => ({ ok: false as const, code: 'unsupported_alert_scope', message: 'nope' })) });
    const r = await executeWriteAction(act('save_search', { name: 'n', filters: {} }), 'a', CTX, d);
    expect(r).toMatchObject({ ok: false, error_code: 'unsupported_alert_scope' });
  });
  it('update_alert is owner-scoped through updateSavedSearch; not_found is reported', async () => {
    const d = deps({ updateSavedSearch: vi.fn(async () => ({ ok: false as const, code: 'not_found', message: 'x' })) });
    const r = await executeWriteAction(act('update_alert', { search_id: 'other', alert_frequency: 'daily' }), 'a', CTX, d);
    expect(d.updateSavedSearch).toHaveBeenCalledWith(expect.objectContaining({ userEmail: CTX.email, id: 'other' }));
    expect(r).toMatchObject({ ok: false, error_code: 'not_found' });
  });
});

describe('add_to_pursuits', () => {
  const OPP = { notice_id: 'abc123', title: 'GAOA BRF Roofing Project', department: 'AGRICULTURE', sub_tier: 'FOREST SERVICE', naics_code: '238160', set_aside_description: 'Small Business', response_deadline: '2026-12-05T00:00:00Z', notice_type: 'Combined Synopsis/Solicitation', ui_link: 'https://sam.gov/x' };
  it('opportunity: fields come from sam_opportunities, not args; the writer gets the verified context', async () => {
    const d = deps({}, { sam_opportunities: OPP });
    const r = await executeWriteAction(act('add_to_pursuits', { kind: 'opportunity', notice_id: 'abc123', title: 'MODEL TITLE' }), 'a', CTX, d);
    const [ctx, draft, opts] = (d.createCanonicalPursuit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ctx).toMatchObject({ callerEmail: CTX.email, workspaceId: 'ws-1' });
    expect(draft).toMatchObject({ title: 'GAOA BRF Roofing Project', notice_id: 'abc123', agency: 'FOREST SERVICE', source: 'ask_mindy' });
    expect(opts).toEqual({ clientNoticeType: 'Combined Synopsis/Solicitation' });
    expect(r).toMatchObject({ ok: true, message: "Added 'GAOA BRF Roofing Project' to My Pursuits", target: { kind: 'pursuit', id: 'p-1' } });
  });
  it('a duplicate is ok + already (never a double add)', async () => {
    const d = deps({ createCanonicalPursuit: vi.fn(async () => ({ kind: 'duplicate' as const, existing: { id: 'p-9' } })) }, { sam_opportunities: OPP });
    const r = await executeWriteAction(act('add_to_pursuits', { notice_id: 'abc123' }), 'a', CTX, d);
    expect(r).toMatchObject({ ok: true, already: true, target: { id: 'p-9' } });
  });
  it('an unknown notice writes nothing', async () => {
    const d = deps();
    const r = await executeWriteAction(act('add_to_pursuits', { notice_id: 'nope' }), 'a', CTX, d);
    expect(r).toMatchObject({ ok: false, error_code: 'not_found' });
    expect(d.createCanonicalPursuit).not.toHaveBeenCalled();
  });
  it('recompete: keyed on the cleaned PIID with the Map\'s title and source', async () => {
    const d = deps({}, { recompete_opportunities: { contract_id: 'CONT_AWD_X', piid: 'N0018926F0012 (+3 more)', incumbent_name: 'ACME LLC', awarding_agency: 'DOD', awarding_sub_agency: 'NAVY', naics_code: '541512' } });
    await executeWriteAction(act('add_to_pursuits', { kind: 'recompete', contract_id: 'CONT_AWD_X' }), 'a', CTX, d);
    const draft = (d.createCanonicalPursuit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(draft).toMatchObject({ title: 'Recompete: ACME LLC · N0018926F0012', notice_id: 'N0018926F0012', source: 'recompete_map', agency: 'NAVY' });
  });
  it('a recompete without a PIID is refused (no dedupe key → no write)', async () => {
    const d = deps({}, { recompete_opportunities: { contract_id: 'C', piid: null, incumbent_name: 'A' } });
    const r = await executeWriteAction(act('add_to_pursuits', { contract_id: 'C' }), 'a', CTX, d);
    expect(r).toMatchObject({ ok: false, error_code: 'no_piid' });
    expect(d.createCanonicalPursuit).not.toHaveBeenCalled();
  });
  it('schedules the writer\'s background doc fetch', async () => {
    const post = async () => {};
    const schedule = vi.fn();
    const d = deps({ schedule, createCanonicalPursuit: vi.fn(async () => ({ kind: 'created' as const, pursuit: { id: 'p' }, family: null, postWrite: post })) }, { sam_opportunities: OPP });
    await executeWriteAction(act('add_to_pursuits', { notice_id: 'abc123' }), 'a', CTX, d);
    expect(schedule).toHaveBeenCalledWith(post);
  });
});

describe('remove_from_pursuits', () => {
  it('removes through removeOwnedPursuit with the verified owner and records activity', async () => {
    const recordActivity = vi.fn(async () => {});
    const d = deps({ recordActivity });
    const r = await executeWriteAction(act('remove_from_pursuits', { notice_id: 'abc123' }), 'a', CTX, d);
    expect(d.removeOwnedPursuit).toHaveBeenCalledWith(d.db, { workspaceId: 'ws-1', email: CTX.email }, { id: null, noticeId: 'abc123' });
    expect(recordActivity).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, message: "Removed 'Roofing' from My Pursuits" });
  });
  it('already gone → ok + already (idempotent)', async () => {
    const d = deps({ removeOwnedPursuit: vi.fn(async () => ({ kind: 'not_found' as const })) });
    const r = await executeWriteAction(act('remove_from_pursuits', { pursuit_id: 'p-1' }), 'a', CTX, d);
    expect(r).toMatchObject({ ok: true, already: true });
  });
});
