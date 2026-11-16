/**
 * Ask Mindy Coach Mode binding — chat must resolve the acting workspace exactly as the
 * Vault / pipeline screens do (resolveActiveWorkspace), and private tools must read ONLY
 * that workspace. A failure here means a coach could see another workspace's crown-jewel
 * data, or a client's data could reach someone who is not authorized for it.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveChatActingScope, vaultEmailFor, type ChatActingScope } from './chat-acting-scope';
import { makeTier0Tools, type Tier0Db } from './tier0-tools';
import { createChatToolExecutor } from './chat-tool-executor';

vi.mock('@/lib/app/workspace', () => ({
  resolveActiveWorkspace: vi.fn(),
  clientNotificationEmail: (ws: string) => `${ws}@clients.getmindy.ai`,
}));

const CLIENT_WS = '11111111-2222-3333-4444-555555555555';
const req = (activeWs?: string) => ({ headers: { get: (n: string) => (n === 'x-active-workspace' ? activeWs ?? null : null) } });

describe('resolveChatActingScope', () => {
  it('no header → own scope with NO workspace query (a normal chat turn is unchanged)', async () => {
    const resolve = vi.fn();
    const scope = await resolveChatActingScope('Coach@Firm.com', req(), resolve);
    expect(scope).toEqual({ kind: 'own', email: 'coach@firm.com' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('header + authorized coach → the client workspace and its Vault owner email', async () => {
    const resolve = vi.fn(async () => ({ workspaceId: CLIENT_WS, asClient: true }));
    const scope = await resolveChatActingScope('coach@firm.com', req(CLIENT_WS), resolve);
    expect(resolve).toHaveBeenCalledWith('coach@firm.com', expect.anything());
    expect(scope).toEqual({ kind: 'client', email: 'coach@firm.com', workspaceId: CLIENT_WS, vaultEmail: `${CLIENT_WS}@clients.getmindy.ai` });
    expect(vaultEmailFor(scope)).toBe(`${CLIENT_WS}@clients.getmindy.ai`);
  });

  it('header + NOT authorized → resolver ignores it → own scope (same as every screen)', async () => {
    const resolve = vi.fn(async () => ({ workspaceId: 'own-ws', asClient: false }));
    const scope = await resolveChatActingScope('stranger@x.com', req(CLIENT_WS), resolve);
    expect(scope).toEqual({ kind: 'own', email: 'stranger@x.com' });
    expect(vaultEmailFor(scope)).toBe('stranger@x.com');
  });

  it('header + resolver throws → unavailable (never a guess about whose data to show)', async () => {
    const resolve = vi.fn(async () => { throw new Error('db down'); });
    const scope = await resolveChatActingScope('coach@firm.com', req(CLIENT_WS), resolve);
    expect(scope.kind).toBe('unavailable');
    expect(vaultEmailFor(scope)).toBeNull();
  });
});

function stubDb(captured: { filters: Array<[string, string]> }, rows: unknown[] = [{ title: 'Client pursuit', stage: 'bidding' }]): Tier0Db {
  const chain: Record<string, unknown> = {};
  chain.eq = (col: string, val: string) => { captured.filters.push([col, val]); return chain; };
  chain.order = () => chain;
  chain.limit = async () => ({ data: rows, error: null });
  return { from: () => ({ select: () => chain }) } as unknown as Tier0Db;
}

const clientScope: ChatActingScope = { kind: 'client', email: 'coach@firm.com', workspaceId: CLIENT_WS, vaultEmail: `${CLIENT_WS}@clients.getmindy.ai` };

describe('Tier-0 tools in a client workspace', () => {
  it("get_my_pipeline reads the CLIENT workspace's rows only — never the coach's email", async () => {
    const captured = { filters: [] as Array<[string, string]> };
    const tools = makeTier0Tools(stubDb(captured), clientScope, vi.fn());
    const out = await tools.execute('get_my_pipeline', { email: 'victim@y.com' } as Record<string, unknown>);
    expect(captured.filters).toContainEqual(['workspace_id', CLIENT_WS]);
    expect(captured.filters.some(([c]) => c === 'user_email')).toBe(false);
    expect(out).toMatchObject({ ok: true, workspace: 'client', count: 1 });
  });

  it("search_my_vault loads the CLIENT's Vault (its synthetic owner email), not the coach's", async () => {
    const loadVault = vi.fn(async () => ({ has_any: true, identity: { company_name: 'Client Co' } }));
    const tools = makeTier0Tools(stubDb({ filters: [] }), clientScope, loadVault as never);
    const out = await tools.execute('search_my_vault', {});
    expect(loadVault).toHaveBeenCalledWith(`${CLIENT_WS}@clients.getmindy.ai`, 'exec_summary');
    expect(loadVault).not.toHaveBeenCalledWith('coach@firm.com', expect.anything());
    expect(out).toMatchObject({ ok: true, workspace: 'client', has_any: true });
  });

  it('own scope (plain email) is unchanged: user_email filter, own Vault, no workspace tag', async () => {
    const captured = { filters: [] as Array<[string, string]> };
    const loadVault = vi.fn(async () => ({ has_any: false }));
    const tools = makeTier0Tools(stubDb(captured), 'owner@x.com', loadVault as never);
    const p = await tools.execute('get_my_pipeline', {});
    await tools.execute('search_my_vault', {});
    expect(captured.filters).toEqual([['user_email', 'owner@x.com']]);
    expect(loadVault).toHaveBeenCalledWith('owner@x.com', 'exec_summary');
    expect(p).not.toHaveProperty('workspace');
  });

  it('unavailable scope reads NOTHING and says so', async () => {
    const captured = { filters: [] as Array<[string, string]> };
    const loadVault = vi.fn();
    const tools = makeTier0Tools(stubDb(captured), { kind: 'unavailable', email: 'coach@firm.com' }, loadVault as never);
    expect(await tools.execute('get_my_pipeline', {})).toMatchObject({ ok: false, error: 'workspace_unavailable' });
    expect(await tools.execute('search_my_vault', {})).toMatchObject({ ok: false, error: 'workspace_unavailable' });
    expect(captured.filters).toEqual([]);
    expect(loadVault).not.toHaveBeenCalled();
  });
});

describe('Vault-grounded registry tools in chat', () => {
  const tier0 = { defs: [], names: new Set<string>(), execute: vi.fn() };
  const planner = { provider: 'openai', model: 'gpt-4o' };
  const call = (name: string, args: unknown) => ({ id: `c_${name}`, function: { name, arguments: JSON.stringify(args) } });
  const draftArgs = { rfp_text: 'The contractor shall provide janitorial services for Building 12, five days per week.' };
  const mk = (extra: Record<string, unknown>) => {
    const runMcpTool = vi.fn(async () => ({ result: { ok: true, _meta: { grounded: true, degraded: false } }, credits: 0 }));
    const logCall = vi.fn(async () => {});
    const ex = createChatToolExecutor({ userEmail: 'coach@firm.com', chatSessionId: null, tier0, deps: { runMcpTool, logCall } as never, ...extra });
    return { ex, runMcpTool };
  };

  it("draft_proposal is grounded in the CLIENT's Vault; the caller stays the coach", async () => {
    const { ex, runMcpTool } = mk({ vaultEmail: `${CLIENT_WS}@clients.getmindy.ai` });
    const [r] = await ex.executeRound([call('draft_proposal', draftArgs)], planner);
    expect(r.record.status).toBe('success');
    expect(runMcpTool).toHaveBeenCalledWith('draft_proposal', expect.anything(), { userEmail: 'coach@firm.com', vaultEmail: `${CLIENT_WS}@clients.getmindy.ai` });
  });

  it('a non-Vault tool never receives vaultEmail', async () => {
    const { ex, runMcpTool } = mk({ vaultEmail: `${CLIENT_WS}@clients.getmindy.ai` });
    await ex.executeRound([call('search_contractors', { naics: '541512' })], planner);
    expect(runMcpTool).toHaveBeenCalledWith('search_contractors', expect.anything(), { userEmail: 'coach@firm.com' });
  });

  it("unresolved workspace → draft_proposal refuses instead of using the coach's own Vault", async () => {
    const { ex, runMcpTool } = mk({ privateScopeUnavailable: true });
    const [r] = await ex.executeRound([call('draft_proposal', draftArgs)], planner);
    expect(runMcpTool).not.toHaveBeenCalled();
    expect(r.content).toContain('workspace_unavailable');
  });
});

describe('chat route: the system-prompt profile follows the acting scope (F1)', () => {
  it('loads the profile via vaultEmailFor and uses an empty profile when the scope is unavailable', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${process.cwd()}/src/app/api/app/chat/route.ts`, 'utf8');
    expect(src).toMatch(/const profileEmail = vaultEmailFor\(actingScope\);/);
    expect(src).toMatch(/profileEmail \? await loadBidderProfile\(profileEmail\) : \{\}/);
    expect(src).not.toMatch(/loadBidderProfile\(auth\.email/);
  });
});
