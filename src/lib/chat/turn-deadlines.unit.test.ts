import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chatDeadlines, toolTimeoutMs, withTimeout, ChatTimeoutError, readWithIdleTimeout, incompleteToolNotice,
  DEFAULT_CHAT_DEADLINES, CHAT_ROUTE_MAX_DURATION_S, TOOL_TIMEOUT_OVERRIDES_MS,
} from './turn-deadlines';

describe('chatDeadlines', () => {
  it('uses the defaults when nothing is set, and ignores junk values', () => {
    const d = chatDeadlines({ CHAT_TOOL_TIMEOUT_MS: 'abc', CHAT_PLANNER_TIMEOUT_MS: '0', CHAT_ANSWER_IDLE_TIMEOUT_MS: '-5' });
    expect(d).toMatchObject(DEFAULT_CHAT_DEADLINES);
    expect(d.toolMsFromEnv).toBe(false);
  });
  it('can lower each value from the environment, but never raise the turn deadline past the default', () => {
    const d = chatDeadlines({ CHAT_TOOL_TIMEOUT_MS: '100', CHAT_TURN_DEADLINE_MS: '9999999' });
    expect(d.toolMs).toBe(100);
    expect(d.turnMs).toBe(DEFAULT_CHAT_DEADLINES.turnMs);
  });
  it('the watchdog fires before the route maxDuration, and the route declares that maxDuration', () => {
    expect(DEFAULT_CHAT_DEADLINES.turnMs).toBeLessThan(CHAT_ROUTE_MAX_DURATION_S * 1000);
    const route = readFileSync(join(process.cwd(), 'src/app/api/app/chat/route.ts'), 'utf8');
    expect(route).toMatch(new RegExp(`export const maxDuration = ${CHAT_ROUTE_MAX_DURATION_S};`));
  });
  it('an ordinary turn keeps its 285 s watchdog; a research turn\'s watchdog and deadline also sit below maxDuration', async () => {
    const { RESEARCH_TURN_MS, RESEARCH_DEADLINE_MS } = await import('@/lib/ask-mindy/research-mode');
    expect(DEFAULT_CHAT_DEADLINES.turnMs).toBe(285_000);
    expect(RESEARCH_DEADLINE_MS).toBeLessThan(RESEARCH_TURN_MS);
    expect(RESEARCH_TURN_MS).toBeLessThan(CHAT_ROUTE_MAX_DURATION_S * 1000);
  });
  it('no single tool may outlast the round budget', () => {
    for (const ms of Object.values(TOOL_TIMEOUT_OVERRIDES_MS)) expect(ms).toBeLessThanOrEqual(DEFAULT_CHAT_DEADLINES.toolRoundBudgetMs);
  });
});

describe('toolTimeoutMs', () => {
  it('drafting tools get their longer limit; an env override applies to every tool', () => {
    const d = chatDeadlines({});
    expect(toolTimeoutMs('draft_proposal', d)).toBe(TOOL_TIMEOUT_OVERRIDES_MS.draft_proposal);
    expect(toolTimeoutMs('get_agency_intel', d)).toBe(DEFAULT_CHAT_DEADLINES.toolMs);
    expect(toolTimeoutMs('draft_proposal', chatDeadlines({ CHAT_TOOL_TIMEOUT_MS: '50' }))).toBe(50);
  });
});

describe('withTimeout / readWithIdleTimeout', () => {
  it('rejects with ChatTimeoutError when the promise never settles', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'x')).rejects.toBeInstanceOf(ChatTimeoutError);
  });
  it('passes through a value and a rejection unchanged', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'x')).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
  it('reports an idle stream as timeout, and a real chunk as data', async () => {
    const idle = new ReadableStream<Uint8Array>({ start() {} }).getReader();
    expect(await readWithIdleTimeout(idle, 10)).toBe('timeout');
    const live = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); } }).getReader();
    expect(await readWithIdleTimeout(live, 1000)).toMatchObject({ done: false });
  });
});

describe('incompleteToolNotice (A6)', () => {
  it('is silent only when every call succeeded', () => {
    expect(incompleteToolNotice([{ status: 'success' }, { status: 'success' }])).toBeNull();
    expect(incompleteToolNotice([])).toBeNull();
  });
  it.each(['blocked_policy', 'rejected_invalid_input', 'gated', 'throttled'])('announces %s as incomplete', (status) => {
    expect(incompleteToolNotice([{ status: 'success' }, { status }])?.code).toBe('lookup_incomplete');
  });
  it('a failed or timed-out call keeps the lookup_failed code and wording', () => {
    expect(incompleteToolNotice([{ status: 'blocked_policy' }, { status: 'failed', error_category: 'tool_timeout' }]))
      .toEqual({ code: 'lookup_failed', message: 'One of the data lookups failed, so this answer may be incomplete.' });
  });
});
