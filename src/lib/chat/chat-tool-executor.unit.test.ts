import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatToolExecutor, MAX_CALLS_PER_ROUND, type Tier0Like, type ChatToolCall } from './chat-tool-executor';

const runMcpTool = vi.fn();
const logCall = vi.fn(async () => {});
const tier0Execute = vi.fn(async () => ({ ok: true, pursuits: [] }));

const tier0: Tier0Like = {
  defs: [
    { type: 'function', function: { name: 'get_my_pipeline', description: 'x', parameters: { type: 'object' } } },
    { type: 'function', function: { name: 'search_my_vault', description: 'x', parameters: { type: 'object' } } },
  ],
  names: new Set(['get_my_pipeline', 'search_my_vault']),
  execute: tier0Execute,
};

const planner = { provider: 'openai', model: 'gpt-4o' };
const call = (name: string, args: unknown = {}, id?: string): ChatToolCall => ({
  id: id ?? `c_${name}`,
  function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
});

function make() {
  return createChatToolExecutor({
    userEmail: 'u@example.com',
    chatSessionId: '11111111-2222-3333-4444-555555555555',
    tier0,
    deps: { runMcpTool, logCall },
  });
}

beforeEach(() => {
  runMcpTool.mockReset();
  runMcpTool.mockResolvedValue({ result: { ok: true, schedule_id: 'ss_1', _meta: { grounded: true, degraded: false } }, credits: 0 });
  logCall.mockClear();
  tier0Execute.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('offered tool definitions', () => {
  it('never offers blocked tools, and does offer ordinary reads and allowed writes', () => {
    const names = make().offeredToolDefs().map((d) => String(d.function.name));
    for (const blocked of ['add_contacts_to_crm', 'one_click_proposal', 'get_proposal_job', 'search_sbir', 'get_agency_budget_trends', 'delete_market_schedule', 'export_proposal', 'verify_m_scale', 'get_balance']) {
      expect(names, blocked).not.toContain(blocked);
    }
    for (const ok of ['get_expiring_contracts', 'search_past_contracts', 'schedule_market_search', 'update_market_schedule', 'generate_market_report', 'get_my_pipeline', 'search_my_vault']) {
      expect(names, ok).toContain(ok);
    }
    expect(new Set(names).size).toBe(names.length); // no duplicates / shadowing
  });
});

describe('execution is re-checked even for tools never offered', () => {
  it.each(['add_contacts_to_crm', 'one_click_proposal', 'search_sbir', 'get_agency_budget_trends', 'export_proposal'])(
    '%s is refused and tool code never runs',
    async (name) => {
      const [r] = await make().executeRound([call(name, { emails: ['a@b.com'] })], planner);
      expect(runMcpTool).not.toHaveBeenCalled();
      expect(r.record.status).toBe('blocked_policy');
      expect(JSON.parse(r.content)).toMatchObject({ ok: false, state: 'unavailable' });
    },
  );

  it('an invented tool name is refused before dispatch', async () => {
    const [r] = await make().executeRound([call('drop_all_tables')], planner);
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(r.record.error_category).toBe('blocked_chat_exception');
  });

  it('a model-supplied confirm:true does not authorize a destructive delete', async () => {
    const [r] = await make().executeRound([call('delete_market_schedule', { schedule_id: 'ss_1', confirm: true })], planner);
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(r.record.error_category).toBe('confirmation_required');
  });

  it('strips confirm from arguments of an allowed write before dispatch', async () => {
    await make().executeRound([call('update_market_schedule', { schedule_id: 'ss_1', paused: true, confirm: true })], planner);
    expect(runMcpTool).toHaveBeenCalledTimes(1);
    expect(runMcpTool.mock.calls[0][1]).not.toHaveProperty('confirm');
    expect(runMcpTool.mock.calls[0][2]).toEqual({ userEmail: 'u@example.com' });
  });
});

describe('round budgets', () => {
  it('runs at most one write per round', async () => {
    const results = await make().executeRound([
      call('schedule_market_search', { name: 'a', naics: '561320' }, 'w1'),
      call('update_market_schedule', { schedule_id: 'ss_1', name: 'b' }, 'w2'),
    ], planner);
    expect(runMcpTool).toHaveBeenCalledTimes(1);
    expect(results[0].record.status).toBe('success');
    expect(results[1].record.error_category).toBe('write_budget_exceeded');
  });

  it(`runs at most ${MAX_CALLS_PER_ROUND} calls per round and still returns a result for each`, async () => {
    const calls = Array.from({ length: MAX_CALLS_PER_ROUND + 2 }, (_, i) => call('get_expiring_contracts', { naics: '561320' }, `r${i}`));
    const results = await make().executeRound(calls, planner);
    expect(runMcpTool).toHaveBeenCalledTimes(MAX_CALLS_PER_ROUND);
    expect(results).toHaveLength(calls.length);
    expect(results.map((r) => r.tool_call_id)).toEqual(calls.map((c) => c.id));
    expect(results.slice(-2).every((r) => r.record.error_category === 'round_budget_exceeded')).toBe(true);
  });
});

describe('arguments and errors', () => {
  it('refuses unparseable arguments instead of running the tool with {}', async () => {
    const [r] = await make().executeRound([call('get_expiring_contracts', '{"naics":"5613')], planner);
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(r.record.error_category).toBe('invalid_arguments');
  });

  it('a throwing tool yields an unavailable result, not an exception, and later calls still run', async () => {
    runMcpTool.mockRejectedValueOnce(new Error('upstream exploded'));
    const results = await make().executeRound([call('get_expiring_contracts', { naics: '561320' }, 'a'), call('search_past_contracts', { naics: '561320' }, 'b')], planner);
    expect(results[0].record.status).toBe('failed');
    expect(JSON.parse(results[0].content)).toMatchObject({ ok: false, state: 'unavailable', error_category: 'tool_error' });
    expect(results[1].record.status).toBe('success');
  });

  it('applies the same input preflight as MCP', async () => {
    const [r] = await make().executeRound([call('lookup_sam_entity', {})], planner);
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(r.record.status).toBe('rejected_invalid_input');
  });

  it('routes chat-private tools to the tier-0 executor, not the registry', async () => {
    await make().executeRound([call('get_my_pipeline', { stage: 'bidding' })], planner);
    expect(tier0Execute).toHaveBeenCalledWith('get_my_pipeline', { stage: 'bidding' });
    expect(runMcpTool).not.toHaveBeenCalled();
  });
});

describe('execution logging', () => {
  it('logs every call on channel app_chat with redacted args, catalog price, 0 charged, model and resource ids', async () => {
    await make().executeRound([call('schedule_market_search', { name: 'VA staffing', naics: '561320', email: 'x@y.com' })], planner);
    expect(logCall).toHaveBeenCalledTimes(1);
    type LoggedRow = { trace: { executionId: string; creditPrice: unknown; argsRedacted: Record<string, unknown>; errorCategory: string | null } } & Record<string, unknown>;
    const row = logCall.mock.calls[0][0] as unknown as LoggedRow;
    expect(row).toMatchObject({ userEmail: 'u@example.com', toolName: 'schedule_market_search', status: 'success', creditsCharged: 0, channel: 'app_chat' });
    expect(row.trace).toMatchObject({ model: 'gpt-4o', provider: 'openai', chatSessionId: '11111111-2222-3333-4444-555555555555', resourceIds: { saved_search_id: 'ss_1' } });
    expect(row.trace.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof row.trace.creditPrice).toBe('number');
    expect(row.trace.argsRedacted.email).toMatchObject({ redacted: true, type: 'string' });
    expect(row.trace.argsRedacted.name).toMatchObject({ redacted: true });
    expect(row.trace.argsRedacted.naics).toBe('561320');
  });

  it('logs refused calls too, with their error category', async () => {
    await make().executeRound([call('add_contacts_to_crm', {})], planner);
    expect(logCall.mock.calls[0][0]).toMatchObject({ status: 'blocked_policy', channel: 'app_chat', creditsCharged: 0 });
    expect((logCall.mock.calls[0][0] as unknown as { trace: { errorCategory: string } }).trace.errorCategory).toBe('blocked_defect');
  });
});

describe('LOW hardening (independent review 2026-11-14)', () => {
  it('refuses an empty or missing argument string instead of running an unfiltered search', async () => {
    const results = await make().executeRound([
      { id: 'e1', function: { name: 'get_expiring_contracts', arguments: '' } },
      { id: 'e2', function: { name: 'get_expiring_contracts', arguments: '   ' } },
      { id: 'e3', function: { name: 'get_expiring_contracts' } },
    ], planner);
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(results.every((r) => r.record.error_category === 'invalid_arguments')).toBe(true);
  });

  it('still runs a no-argument call sent as "{}"', async () => {
    await make().executeRound([{ id: 'n', function: { name: 'list_market_schedules', arguments: '{}' } }], planner);
    expect(runMcpTool).toHaveBeenCalledTimes(1);
  });

  it('a completed write stays a success when the logger throws afterwards, and is logged once', async () => {
    logCall.mockImplementationOnce(async () => { throw new Error('log down'); });
    const [r] = await make().executeRound([call('schedule_market_search', { name: 'a', naics: '561320' })], planner);
    expect(r.record.status).toBe('success');
    expect(JSON.parse(r.content)).toMatchObject({ schedule_id: 'ss_1' });
    expect(logCall).toHaveBeenCalledTimes(1);
  });

  it('a result that cannot be serialized (BigInt / circular) is still a success, logged once', async () => {
    const circ: Record<string, unknown> = { ok: true, big: BigInt(9), schedule_id: 'ss_9' };
    circ.self = circ;
    runMcpTool.mockResolvedValueOnce({ result: circ, credits: 0 });
    const [r] = await make().executeRound([call('schedule_market_search', { name: 'a', naics: '561320' })], planner);
    expect(r.record.status).toBe('success');
    expect(JSON.parse(r.content)).toMatchObject({ ok: true, big: '9', schedule_id: 'ss_9' });
    expect(logCall).toHaveBeenCalledTimes(1);
    expect((logCall.mock.calls[0][0] as { status: string }).status).toBe('success');
  });

  it('an unexpected error in one call never discards earlier results in the round (incl. a completed write)', async () => {
    const throwingTier0: Tier0Like = { ...tier0, execute: tier0Execute };
    const ex = createChatToolExecutor({ userEmail: 'u@example.com', chatSessionId: null, tier0: throwingTier0, deps: { runMcpTool, logCall, isMcpTool: ((n: string) => { if (n === 'boom_tool') throw new Error('registry exploded'); return n !== 'get_my_pipeline' && n !== 'search_my_vault'; }) as never } });
    const results = await ex.executeRound([call('schedule_market_search', { name: 'a', naics: '561320' }, 'w'), call('boom_tool', {}, 'b')], planner);
    expect(results).toHaveLength(2);
    expect(results[0].record.status).toBe('success');
    expect(results[1].tool_call_id).toBe('b');
    expect(results[1].record.error_category).toBe('internal_error');
  });

  it('a write rejected for invalid input does not consume the round write budget', async () => {
    const ex = createChatToolExecutor({
      userEmail: 'u@example.com', chatSessionId: null, tier0,
      deps: {
        runMcpTool, logCall,
        preflight: (name: string, args: Record<string, unknown>) =>
          name === 'update_market_schedule' && !args.schedule_id ? { code: 'invalid_input' as const, message: 'needs schedule_id' } : null,
      },
    });
    const results = await ex.executeRound([
      call('update_market_schedule', {}, 'w1'),
      call('schedule_market_search', { name: 'a', naics: '561320' }, 'w2'),
    ], planner);
    expect(results[0].record.status).toBe('rejected_invalid_input');
    expect(results[1].record.status).toBe('success');
    expect(runMcpTool).toHaveBeenCalledTimes(1);
  });

  it('logged args keep a valid schema enum value and redact free text', async () => {
    await make().executeRound([call('search_idv_contracts', { search_type: 'task', naics: '561320', query: 'our secret plan' })], planner);
    const row = logCall.mock.calls[0][0] as unknown as { trace: { argsRedacted: Record<string, unknown> } };
    expect(row.trace.argsRedacted.search_type).toBe('task');
    expect(row.trace.argsRedacted.naics).toBe('561320');
    expect(JSON.stringify(row.trace.argsRedacted)).not.toContain('secret plan');
  });
});


describe('narrowing allow-list (Opportunity Map card chat)', () => {
  const makeNarrow = () => createChatToolExecutor({
    userEmail: 'u@example.com',
    chatSessionId: '11111111-2222-3333-4444-555555555555',
    tier0,
    deps: { runMcpTool, logCall },
    allowedToolNames: new Set(['lookup_solicitation', 'search_my_vault', 'add_contacts_to_crm']),
  });
  it('offers only allowed names that the policy also allows (never widens past the policy)', () => {
    const names = makeNarrow().offeredToolDefs().map((d) => String(d.function.name)).sort();
    expect(names).toEqual(['lookup_solicitation', 'search_my_vault']);
  });
  it('refuses at execution a tool outside the list, even if the model names it', async () => {
    const res = await makeNarrow().executeRound([call('search_contractors', { q: 'x' })], planner);
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(JSON.parse(res[0].content)).toMatchObject({ ok: false, error_category: 'not_offered_here' });
  });
  it('without a list, the offered set is unchanged', () => {
    expect(make().offeredToolDefs().length).toBeGreaterThan(makeNarrow().offeredToolDefs().length);
  });
});

describe('A7: timeouts and the round deadline', () => {
  function timed(ms: number) {
    return createChatToolExecutor({
      userEmail: 'u@example.com', chatSessionId: null, tier0, deps: { runMcpTool, logCall }, toolTimeoutMs: () => ms,
    });
  }
  it('a tool that never resolves is reported failed with tool_timeout, never as an empty result', async () => {
    runMcpTool.mockImplementation(() => new Promise(() => {}));
    const [r] = await timed(20).executeRound([call('get_expiring_contracts', { naics: '541512' })], planner);
    expect(r.record).toMatchObject({ status: 'failed', error_category: 'tool_timeout' });
    expect(JSON.parse(r.content)).toMatchObject({ ok: false, state: 'unavailable', error_category: 'tool_timeout' });
  });
  it('a timed-out WRITE is reported as unknown, not as done or not done', async () => {
    runMcpTool.mockImplementation(() => new Promise(() => {}));
    const [r] = await timed(20).executeRound([call('schedule_market_search', { naics: '541512', cadence: 'weekly', name: 'x' })], planner);
    expect(r.record).toMatchObject({ status: 'failed', error_category: 'tool_timeout' });
    expect(JSON.parse(r.content).message).toMatch(/may still complete/);
  });
  it('a cancelled turn refuses every remaining call before it starts', async () => {
    runMcpTool.mockClear();
    let cancelled = false;
    runMcpTool.mockImplementation(async () => { cancelled = true; return { result: { ok: true }, credits: 0 }; });
    const out = await make().executeRound([call('get_expiring_contracts', { naics: '541512' }, 'a'), call('schedule_market_search', { naics: '541512', cadence: 'weekly', name: 'x' }, 'b')], planner, { isCancelled: () => cancelled });
    expect(runMcpTool).toHaveBeenCalledTimes(1);
    expect(out[1].record).toMatchObject({ status: 'blocked_policy', error_category: 'turn_cancelled' });
  });
  it('calls after the round deadline are refused and never started', async () => {
    runMcpTool.mockClear();
    const out = await make().executeRound([call('get_expiring_contracts', { naics: '541512' })], planner, { deadlineAt: Date.now() - 1 });
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(out[0].record).toMatchObject({ status: 'blocked_policy', error_category: 'round_deadline_exceeded' });
  });
  it('without a timeout option, behavior is unchanged (a slow tool still completes)', async () => {
    runMcpTool.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); return { result: { ok: true }, credits: 0 }; });
    const [r] = await make().executeRound([call('get_expiring_contracts', { naics: '541512' })], planner);
    expect(r.record.status).toBe('success');
  });
});

describe('free-by-design chat tools are logged NON-billable (so they stay free if per-answer billing is enabled)', () => {
  const docTier0: Tier0Like = {
    defs: [
      { type: 'function', function: { name: 'create_document', description: 'x', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'find_my_documents', description: 'x', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'get_my_pipeline', description: 'x', parameters: { type: 'object' } } },
    ],
    names: new Set(['create_document', 'find_my_documents', 'get_my_pipeline']),
    execute: vi.fn(async () => ({ ok: true, saved_to: 'vault', files: [] })),
  };
  const ex = () => createChatToolExecutor({ userEmail: 'u@example.com', chatSessionId: null, tier0: docTier0, deps: { runMcpTool, logCall } });
  const loggedBilling = () => (logCall.mock.calls.at(-1) as unknown as [{ outcome?: { billingOutcome?: string } }])[0].outcome?.billingOutcome;
  it.each(['create_document', 'find_my_documents'])('%s → nonbillable_free_tool', async (name) => {
    logCall.mockClear();
    await ex().executeRound([call(name, { doc_model: { title: 't' } })], planner);
    expect(loggedBilling()).toBe('nonbillable_free_tool');
  });
  it('an ordinary private read keeps its normal classification', async () => {
    logCall.mockClear();
    await ex().executeRound([call('get_my_pipeline', {})], planner);
    expect(loggedBilling()).toBe('billable_success');
  });
});

describe('samCacheOnly (Ask Mindy research mode)', () => {
  it('is passed to every registry tool only when the executor is built with it', async () => {
    const runMcpTool = vi.fn(async () => ({ result: { ok: true }, credits: 0 }));
    const mk = (samCacheOnly?: boolean) => createChatToolExecutor({ userEmail: 'a@b.com', chatSessionId: null, tier0: { defs: [], names: new Set(), execute: async () => ({}) }, deps: { runMcpTool: runMcpTool as never, logCall: (async () => {}) as never }, ...(samCacheOnly ? { samCacheOnly } : {}) });
    const c = { id: 'x', function: { name: 'lookup_sam_entity', arguments: '{"name":"Acme"}' } };
    await mk(true).executeRound([c], { model: 'm', provider: 'p' });
    expect((runMcpTool.mock.calls[0] as unknown[])[2]).toMatchObject({ samCacheOnly: true });
    await mk().executeRound([c], { model: 'm', provider: 'p' });
    expect(((runMcpTool.mock.calls[1] as unknown[])[2] as Record<string, unknown>).samCacheOnly).toBeUndefined();
  });
});
