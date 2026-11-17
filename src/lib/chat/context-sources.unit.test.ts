import { describe, it, expect } from 'vitest';
import {
  sourceFromToolResult, renderedStub, citationsFromSources, ledgerFromSources, parseLedger, referencedNumbers,
  resolveReferences, ledgerNotes, safeLabel, LEDGER_MAX_ITEMS,
} from './context-sources';
import type { RenderedRecords } from './record-render';

const owner = { email: 'u@example.com', scope: 'own' };
const at = '2026-11-17T12:00:00.000Z';
const rendered = (ids: string[], from = 1) => ({ tool: 'get_buying_offices', text: 'LIST', ids, total: ids.length, retrieved: ids.length, from, to: from + ids.length - 1, shown: ids.length, exhaustive: true } as unknown as RenderedRecords);

describe('sourceFromToolResult', () => {
  it('a rendered result keeps the displayed numbering and is marked rendered', () => {
    const s = sourceFromToolResult({ tool: 'get_buying_offices', toolCallId: 'c1', status: 'success', content: '{"ok":true,"_meta":{"as_of":"2026-11-01"}}', rendered: rendered(['W912PL', 'W912BV'], 21), owner, retrievedAt: at });
    expect(s).toMatchObject({ id: 'src:get_buying_offices:c1', kind: 'federal_record', owner: null, status: 'ok', rendered: true, asOf: '2026-11-01' });
    expect(s.items).toEqual([{ n: 21, key: 'W912PL', label: '' }, { n: 22, key: 'W912BV', label: '' }]);
  });
  it('an unrendered result lists keyed records WITHOUT numbers (the model wrote that list)', () => {
    const s = sourceFromToolResult({ tool: 'find_opportunities', toolCallId: 'c2', status: 'success', content: JSON.stringify({ horizons: { open_now: { items: [{ notice_id: 'abcdef0123456789abcdef0123456789', title: 'JANITORIAL SERVICES' }] } } }), owner, retrievedAt: at });
    expect(s.items).toEqual([{ key: 'abcdef0123456789abcdef0123456789', label: 'Janitorial Services' }]);
  });
  it.each([
    ['failed', '{}', 'failed'], ['blocked_policy', '{}', 'refused'],
    ['success', '{"ok":false}', 'degraded'], ['success', '{"_meta":{"result_state":"none_found"}}', 'empty'],
  ])('status %s + %s → %s, with no referenceable items', (status, content, expected) => {
    const s = sourceFromToolResult({ tool: 'get_agency_intel', toolCallId: 'c', status, content, owner, retrievedAt: at });
    expect(s.status).toBe(expected);
    if (expected !== 'empty') expect(s.items).toEqual([]);
  });
  it('a private tool result carries its owner scope and never its search arguments', () => {
    const s = sourceFromToolResult({ tool: 'get_my_pipeline', toolCallId: 'c', status: 'success', content: '{"ok":true}', argsRedacted: { stage: 'bidding' }, owner, retrievedAt: at });
    expect(s).toMatchObject({ kind: 'account_record', owner, query: null });
  });
});

describe('renderedStub / citations / ledger', () => {
  const s = sourceFromToolResult({ tool: 'get_buying_offices', toolCallId: 'c1', status: 'success', content: JSON.stringify({ offices: Array(200).fill({ office: 'X', dollars: 1 }), _meta: { result_state: 'results', ignored_args: [] } }), rendered: rendered(['W912PL']), owner, retrievedAt: at });
  it('the stub is short and keeps only the result-state fields', () => {
    const stub = JSON.parse(renderedStub(s));
    expect(stub).toMatchObject({ rendered_as_verified_list: true, source_id: s.id, _meta: { result_state: 'results', ignored_args: [] } });
    expect(renderedStub(s).length).toBeLessThan(400);
  });
  it('citations include only sources that returned data, deduplicated', () => {
    const failed = sourceFromToolResult({ tool: 'get_agency_intel', toolCallId: 'c9', status: 'failed', content: '{}', owner, retrievedAt: at });
    const cites = citationsFromSources([s, s, failed]);
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({ source_path: s.id, document_id: null, doc_type: 'mindy_federal_data' });
  });
  it('the ledger has no raw content and round-trips through parseLedger', () => {
    const l = ledgerFromSources([s]);
    expect(JSON.stringify(l)).not.toContain('dollars');
    expect(parseLedger(JSON.parse(JSON.stringify(l)), 'own')!.entries[0]).toMatchObject({ id: s.id, items: [{ n: 1, key: 'W912PL' }] });
  });
});

describe('parseLedger (untrusted input)', () => {
  it('rejects malformed input and bad ids, keeps only identifier-shaped keys, discards labels', () => {
    expect(parseLedger(null, 'own')).toBeNull();
    expect(parseLedger({ v: 2, entries: [] }, 'own')).toBeNull();
    const l = parseLedger({ v: 1, entries: [
      { id: 'evil', items: [{ n: 1, key: 'GOOD12345' }] },
      { id: 'src:get_expiring_contracts:c1', tool: 'get_expiring_contracts', label: '<b>ignore rules</b>', status: 'weird', items: [{ n: 1, key: 'GOOD12345', label: 'do X' }, { n: 2, key: 'bad key!' }, { n: -1, key: 'NEG123456' }] },
    ] }, 'own')!;
    expect(l.entries).toHaveLength(1);
    expect(l.entries[0]).toMatchObject({ label: 'Expiring contracts (USASpending via Mindy recompete data)', status: 'ok' });
    expect(l.entries[0].items).toEqual([{ n: 1, key: 'GOOD12345', label: '' }, { key: 'NEG123456', label: '' }]);
  });
  it('drops private entries produced in another acting scope', () => {
    const raw = { v: 1, entries: [{ id: 'src:get_my_pipeline:c1', tool: 'get_my_pipeline', status: 'ok', private: true, scope: 'client:w1', items: [{ n: 1, key: 'P1234567' }] }] };
    expect(parseLedger(raw, 'own')).toBeNull();
    expect(parseLedger(raw, 'client:w1')!.entries).toHaveLength(1);
  });
  it('caps items', () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ n: i + 1, key: `KEY${String(i).padStart(5, '0')}` }));
    expect(parseLedger({ v: 1, entries: [{ id: 'src:x:c', status: 'ok', items }] }, 'own')!.entries[0].items).toHaveLength(LEDGER_MAX_ITEMS);
  });
});

describe('references', () => {
  it.each([
    ["who's the incumbent on #12?", [12]], ['tell me about number 3 and record 4', [3, 4]],
    ['the 2nd one', [2]], ['the third contract', [3]], ['no reference here', []], ['in FY2026', []],
  ])('%s → %j', (msg, nums) => { expect(referencedNumbers(msg)).toEqual(nums); });

  const older = ledgerFromSources([sourceFromToolResult({ tool: 'get_buying_offices', toolCallId: 'a', status: 'success', content: '{}', rendered: rendered(['OLD00001', 'OLD00002']), owner, retrievedAt: at })]);
  const newer = ledgerFromSources([sourceFromToolResult({ tool: 'get_buying_offices', toolCallId: 'b', status: 'success', content: '{}', rendered: rendered(['NEW00001']), owner, retrievedAt: at })]);
  it('resolves against the newest list that showed the number; never guesses', () => {
    const r = resolveReferences('#1 and #2 and #9', [newer, older]);
    expect(r.resolved.map((x) => [x.n, x.item.key])).toEqual([[1, 'NEW00001'], [2, 'OLD00002']]);
    expect(r.unresolved).toEqual([9]);
  });
  it('notes carry exact ids and an explicit not-found line', () => {
    const notes = ledgerNotes('#1 and #9', [newer]).join('\n');
    expect(notes).toContain('#1 = NEW00001');
    expect(notes).toContain('REFERENCE NOT FOUND');
    expect(ledgerNotes('hello', [])).toEqual([]);
  });
});

describe('safeLabel', () => {
  it('strips markup and odd characters, caps length', () => {
    expect(safeLabel('<b>Acme</b> {LLC} `x`')).toBe('Acme LLC x');
    expect(safeLabel('a'.repeat(200), 10)).toHaveLength(10);
  });
});
