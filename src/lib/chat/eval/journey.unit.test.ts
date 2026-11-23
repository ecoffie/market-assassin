/**
 * Journey capture against a FAKE chat server (no network): turn carrying (session id, history, re-sent source
 * ledger), event capture, observed flag state, the AFTER/UNCONFIRMED label, artifacts and the side-by-side index.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runJourney, observeFlags, labelRun, runWarnings, captureFromEvents, type JourneyScenario, type SseEvent } from './journey';
import { writeTurnArtifacts, compareIndexHtml } from './journey-artifacts';

const SID = '11111111-2222-4333-8444-555555555555';
const sse = (events: SseEvent[]) => new Response(new ReadableStream({
  start(c) {
    const enc = new TextEncoder();
    c.enqueue(enc.encode(': keep-alive\n\n'));
    // split a frame across chunks to prove buffering
    const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    c.enqueue(enc.encode(text.slice(0, 7)));
    c.enqueue(enc.encode(text.slice(7)));
    c.close();
  },
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

const SCENARIO: JourneyScenario = { id: 'synthetic', turns: ['Look us up: Ridgeline Test Facilities', 'Where should we compete?', 'Turn this research into a professional report with an executive summary, risks and sources.'] };

function fakeServer(opts: { notices?: string[][]; failTurn?: number } = {}) {
  const requests: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  let turn = 0;
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/app/chat')) {
      turn++;
      requests.push({ url: u, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
      if (opts.failTurn === turn) return new Response('boom', { status: 500 });
      const events: SseEvent[] = [
        { type: 'session', sessionId: SID },
        { type: 'trace', planner: { provider: 'openai', model: 'm' }, tools: [{ tool: turn === 3 ? 'create_document' : 'find_opportunities', status: 'success', args: {}, result_excerpt: 'x', result_chars: 1 }] },
        { type: 'token', content: `Answer ${turn}, ` },
        { type: 'token', content: 'part two.' },
        { type: 'trace_usage', notices: opts.notices?.[turn - 1] ?? [] },
        { type: 'sources', ledger: { v: 1, sig: `sig-${turn}`, sources: [{ id: `s${turn}` }] } },
        { type: 'citations', sources: [{ label: `Source ${turn}` }] },
        ...(turn === 2 ? [{ type: 'market_report', report_id: 'r1', url: '/reports/abc', title: 'Market report', html: '<html>packaged</html>' }] : []),
        ...(turn === 3 ? [{ type: 'deliverables', files: [{ format: 'pdf', document_id: '00000000-0000-4000-8000-000000000001', file_name: 'Report.pdf' }] }] : []),
        { type: 'done' },
      ];
      return sse(events);
    }
    if (u.includes('/api/app/vault/documents/download')) return Response.json({ success: true, url: 'https://storage.example/signed/report.pdf', filename: 'Report.pdf' });
    if (u === 'https://storage.example/signed/report.pdf') return new Response(Buffer.from('%PDF-1.7 fake'), { status: 200 });
    if (u.endsWith('/reports/abc')) return new Response('<html>hosted packaged</html>', { status: 200 });
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, requests };
}

describe('runJourney', () => {
  it('one session: session id carried, full history re-sent with each answer\'s source ledger, token header on every turn', async () => {
    const s = fakeServer();
    const turns = await runJourney({ host: 'https://preview.example/', email: 'test@example.com', token: 'tok', scenario: SCENARIO, fetchImpl: s.f });
    expect(turns.map((t) => t.answer)).toEqual(['Answer 1, part two.', 'Answer 2, part two.', 'Answer 3, part two.']);
    expect(s.requests.map((r) => r.url)).toEqual(Array(3).fill('https://preview.example/api/app/chat'));
    expect(s.requests.every((r) => r.headers['x-mi-auth-token'] === 'tok')).toBe(true);
    expect(s.requests[0].body).toEqual({ email: 'test@example.com', message: SCENARIO.turns[0], history: [] });
    expect(s.requests[2].body.sessionId).toBe(SID);
    expect(s.requests[2].body.history).toEqual([
      { role: 'user', content: SCENARIO.turns[0] },
      { role: 'assistant', content: 'Answer 1, part two.', sources: { v: 1, sig: 'sig-1', sources: [{ id: 's1' }] } },
      { role: 'user', content: SCENARIO.turns[1] },
      { role: 'assistant', content: 'Answer 2, part two.', sources: { v: 1, sig: 'sig-2', sources: [{ id: 's2' }] } },
    ]);
    expect(turns[1].marketReport).toMatchObject({ url: '/reports/abc', html: '<html>packaged</html>' });
    expect(turns[2].deliverables).toEqual([{ format: 'pdf', document_id: '00000000-0000-4000-8000-000000000001', file_name: 'Report.pdf' }]);
    expect(turns[2].tools.map((t) => t.tool)).toEqual(['create_document']);
    expect(turns[0].citations).toEqual([{ label: 'Source 1' }]);
  });

  it('stops at the first failed turn (later turns would answer a broken conversation)', async () => {
    const s = fakeServer({ failTurn: 2 });
    const turns = await runJourney({ host: 'https://preview.example', email: 'e', token: 't', scenario: SCENARIO, fetchImpl: s.f });
    expect(turns).toHaveLength(2);
    expect(turns[1].error).toMatch(/^HTTP 500: boom/);
    expect(runWarnings(turns)).toContain('turn 2: HTTP 500: boom');
  });
});

describe('observed flags and the run label', () => {
  it('AFTER only when every expected flag was observed on', async () => {
    const s = fakeServer({ notices: [['intent:strategy_plan', 'strategy_fit_ranking_note'], ['fit_ranking_note'], ['requested_doc_sections:executive_summary,risks,sources']] });
    const turns = await runJourney({ host: 'https://p', email: 'e', token: 't', scenario: SCENARIO, fetchImpl: s.f });
    const flags = observeFlags(turns);
    expect(Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v.state]))).toEqual({ strategy_plan: 'on', recipes: 'on', vault_generate: 'on' });
    expect(labelRun('after', ['strategy_plan', 'recipes', 'vault_generate'], flags)).toEqual({ label: 'AFTER', reasons: [] });
  });

  it('an expected flag not observed (or observed off) → UNCONFIRMED, never AFTER', () => {
    const t = captureFromEvents(1, 'p', [{ type: 'trace_usage', notices: ['intent:strategy_plan', 'sectioned_report:packaged_with_gap_note:no_document_tool'] }], 1, 200);
    const flags = observeFlags([t]);
    expect(flags.vault_generate.state).toBe('off');
    expect(flags.recipes.state).toBe('unobserved');
    const l = labelRun('after', ['strategy_plan', 'recipes', 'vault_generate'], flags);
    expect(l.label).toBe('UNCONFIRMED');
    expect(l.reasons).toEqual(['recipes expected on, observed unobserved', 'vault_generate expected on, observed off']);
    expect(labelRun('after', [], flags).label).toBe('UNCONFIRMED');
  });

  it('contradictory evidence is unobserved, not on; a BEFORE run with a flag on is UNCONFIRMED', () => {
    const t = captureFromEvents(1, 'p', [{ type: 'trace_usage', notices: ['requested_doc_sections:risks', 'fmp_phase:writeup_skipped_no_create_document'] }], 1, 200);
    expect(observeFlags([t]).vault_generate.state).toBe('unobserved');
    const on = captureFromEvents(1, 'p', [{ type: 'trace_usage', notices: ['fit_ranking_note'] }], 1, 200);
    expect(labelRun('before', [], observeFlags([on]))).toEqual({ label: 'UNCONFIRMED', reasons: ['recipes observed on in a BEFORE run'] });
    expect(labelRun('before', [], observeFlags([captureFromEvents(1, 'p', [], 1, 200)])).label).toBe('BEFORE');
  });

  it('no trace events at all is a warning (the target was not started with trace on)', () => {
    expect(runWarnings([captureFromEvents(1, 'p', [{ type: 'token', content: 'hi' }], 1, 200)])[0]).toMatch(/no trace events/);
  });
});

describe('artifacts', () => {
  it('answer, events, capture, packaged report (inline + hosted) and downloaded documents, each hashed; failures recorded', async () => {
    const s = fakeServer();
    const dir = mkdtempSync(join(tmpdir(), 'journey-test-'));
    const records = [];
    const turns = await runJourney({
      host: 'https://p', email: 'test@example.com', token: 'tok', scenario: SCENARIO, fetchImpl: s.f,
      onTurn: async (c) => { records.push(...await writeTurnArtifacts({ dir, host: 'https://p', email: 'test@example.com', token: 'tok', fetchImpl: s.f }, c)); },
    });
    expect(turns).toHaveLength(3);
    const kinds = records.map((r) => `${r.turn}:${r.kind}`);
    expect(kinds).toEqual(expect.arrayContaining(['1:answer', '1:events', '1:capture', '2:market_report_inline', '2:market_report_hosted', '3:document_pdf']));
    expect(readFileSync(join(dir, 'turn-2.market-report.hosted.html'), 'utf8')).toBe('<html>hosted packaged</html>');
    expect(readFileSync(join(dir, 'turn-3.Report.pdf'), 'utf8')).toBe('%PDF-1.7 fake');
    expect(records.every((r) => !r.file || /^[0-9a-f]{64}$/.test(r.sha256))).toBe(true);
    // the structured capture does not duplicate the report HTML
    expect(readFileSync(join(dir, 'turn-2.json'), 'utf8')).not.toContain('<html>packaged</html>');
    // a download that fails is recorded, never faked
    const bad = await writeTurnArtifacts({ dir, host: 'https://p', email: 'e', token: 't', fetchImpl: (async () => new Response('x', { status: 403 })) as unknown as typeof fetch },
      { ...turns[2], turn: 9 });
    expect(bad.find((r) => r.kind === 'document_pdf')).toMatchObject({ file: '', note: expect.stringContaining('download route HTTP 403') });
    expect(existsSync(join(dir, 'turn-9.Report.pdf'))).toBe(false);
  });

  it('side-by-side index: both runs, labels, flags, escaped answers, artifact links; no scores', () => {
    const mk = (label: string, answer: string) => {
      const dir = mkdtempSync(join(tmpdir(), 'journey-cmp-'));
      writeFileSync(join(dir, 'turn-1.answer.md'), answer);
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ label, target: { host: 'https://p', served_sha: 'abc123' }, flags: { recipes: { state: label === 'AFTER' ? 'on' : 'unobserved' } }, turns: [{ turn: 1, prompt: 'Look us up' }], artifacts: [{ turn: 1, kind: 'answer', file: 'turn-1.answer.md', sha256: 'x', bytes: 1 }] }));
      return dir;
    };
    const html = compareIndexHtml([{ name: 'Before', dir: mk('BEFORE', 'old <b>answer</b>'), relDir: 'before' }, { name: 'After', dir: mk('AFTER', 'new answer'), relDir: 'after' }]);
    expect(html).toContain('BEFORE');
    expect(html).toContain('AFTER');
    expect(html).toContain('recipes=on');
    expect(html).toContain('old &lt;b&gt;answer&lt;/b&gt;');
    expect(html).toContain('href="after/turn-1.answer.md"');
    expect(html).not.toMatch(/score|grade|pass|fail/i);
  });
});
