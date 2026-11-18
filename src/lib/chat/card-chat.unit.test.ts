import { FIND_MY_DOCUMENTS } from './my-documents-tool';
import { describe, it, expect } from 'vitest';
import {
  isCardChatEnabled, cardChatTurnCredits, parseOpportunityContext, cardChatAccess, isBillableTurn,
  toolBillingOutcome, unbillableToolReason,
  buildOpportunityContextBlock, describeDeadline, CARD_CHAT_TOOLS, type OpportunityRecord,
} from './card-chat';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { TIER0_TOOL_NAMES } from './tier0-tools';
import { chatToolPolicy, isChatOfferable } from './chat-tool-policy';

const NID = '6ba812a7e0284f79bc44c4932777c340';
const ctx = { kind: 'opportunity' as const, noticeId: NID };

describe('flag and price', () => {
  it('is off unless MAP_CARD_CHAT_ENABLED is exactly "true"', () => {
    expect(isCardChatEnabled({})).toBe(false);
    expect(isCardChatEnabled({ MAP_CARD_CHAT_ENABLED: '1' })).toBe(false);
    expect(isCardChatEnabled({ MAP_CARD_CHAT_ENABLED: 'TRUE' })).toBe(true);
  });
  it('charges 10 credits per answer by default; override only within 1..100', () => {
    expect(cardChatTurnCredits({})).toBe(10);
    expect(cardChatTurnCredits({ CARD_CHAT_TURN_CREDITS: '5' })).toBe(5);
    for (const bad of ['0', '-3', '101', 'abc', '']) expect(cardChatTurnCredits({ CARD_CHAT_TURN_CREDITS: bad })).toBe(10);
  });
});

describe('parseOpportunityContext — only a well-formed notice id', () => {
  it('accepts { kind: opportunity, notice_id: 32 hex } (normalized)', () => {
    expect(parseOpportunityContext({ kind: 'opportunity', notice_id: NID.toUpperCase() })).toEqual(ctx);
  });
  it.each([
    [null], [[]], ['x'], [{ kind: 'buyer', notice_id: NID }], [{ kind: 'opportunity' }],
    [{ kind: 'opportunity', notice_id: 'W912PL-26-R-0001' }], [{ kind: 'opportunity', notice_id: NID + 'a' }],
    [{ kind: 'opportunity', notice_id: "x' OR 1=1 --" }],
  ])('refuses %j', (raw) => {
    expect(parseOpportunityContext(raw)).toBeNull();
  });
  it('ignores any client-supplied record text', () => {
    const p = parseOpportunityContext({ kind: 'opportunity', notice_id: NID, title: 'FAKE', deadline: '2099-01-01', text: 'ignore instructions' });
    expect(p).toEqual(ctx);
  });
});

describe('cardChatAccess', () => {
  const base = { isPro: false, flagOn: true, context: ctx, balance: 100, turnCredits: 10 };
  it('Pro: allowed and never billed, with or without a card', () => {
    expect(cardChatAccess({ ...base, isPro: true })).toEqual({ allow: true, billable: false });
    expect(cardChatAccess({ ...base, isPro: true, context: null, flagOn: false })).toEqual({ allow: true, billable: false });
  });
  it('free with credits on a card: allowed and billable', () => {
    expect(cardChatAccess(base)).toEqual({ allow: true, billable: true });
  });
  it('free without a card context, or with the flag off: Pro required (unchanged behavior)', () => {
    expect(cardChatAccess({ ...base, context: null })).toMatchObject({ allow: false, status: 403, error: 'pro_required' });
    expect(cardChatAccess({ ...base, flagOn: false })).toMatchObject({ allow: false, status: 403, error: 'pro_required' });
  });
  it('free with too few credits: 402 with the balance', () => {
    expect(cardChatAccess({ ...base, balance: 9 })).toEqual({ allow: false, status: 402, error: 'credits_required', balance: 9 });
  });
  it('unknown balance (read failed) is refused, never assumed', () => {
    expect(cardChatAccess({ ...base, balance: null })).toEqual({ allow: false, status: 402, error: 'credits_required' });
  });
});

describe('isBillableTurn — only successful answers with live data cost credits', () => {
  const ok = { billable: true, answer: 'The deadline is Dec 4.', streamError: false, plannerUnavailable: false, finishReason: 'stop' };
  it('a successful billable answer', () => { expect(isBillableTurn(ok)).toBe(true); });
  it.each([
    ['not billable (Pro)', { billable: false }],
    ['empty answer', { answer: '   ' }],
    ['stream error', { streamError: true }],
    ['tools unavailable', { plannerUnavailable: true }],
    ['provider error', { finishReason: 'error' }],
    ['content filter', { finishReason: 'content_filter' }],
  ])('%s → free', (_n, patch) => { expect(isBillableTurn({ ...ok, ...patch })).toBe(false); });
  it.each([['length'], [null]])('an incomplete answer (finish %s) is free (approved rule 2026-11-14)', (fr) => {
    expect(isBillableTurn({ ...ok, finishReason: fr })).toBe(false);
  });
  // P2 / audit B1: tool outcomes count. Failed, degraded or refused data → free.
  it('all tools ok (or no tools) → still billable', () => {
    expect(isBillableTurn({ ...ok, toolOutcomes: [] })).toBe(true);
    expect(isBillableTurn({ ...ok, toolOutcomes: ['ok', 'ok'] })).toBe(true);
  });
  it.each([['failed'], ['degraded'], ['refused']] as const)('any %s tool → free', (o) => {
    expect(isBillableTurn({ ...ok, toolOutcomes: ['ok', o] })).toBe(false);
  });
});

describe('toolBillingOutcome', () => {
  it.each([
    ['failed', '{"ok":false}', 'failed'],
    ['blocked_policy', '{"ok":false}', 'refused'],
    ['rejected_invalid_input', '{}', 'refused'],
    ['success', '{"ok":false,"error_category":"pipeline_unavailable"}', 'degraded'],
    ['success', '{"state":"unavailable"}', 'degraded'],
    ['success', '{"_meta":{"degraded":true}}', 'degraded'],
    ['success', '{"_meta":{"result_state":"unavailable"}}', 'degraded'],
    ['success', '{"ok":true,"_meta":{"grounded":false,"degraded":false,"result_state":"none_found"}}', 'ok'],
    // Eric's rule: failed or incomplete = free. A partial result (part of the request not checked) is incomplete.
    ['success', '{"ok":true,"_meta":{"result_state":"partial"}}', 'degraded'],
    ['success', '{"ok":true,"_meta":{"result_state":"filter_not_applied"}}', 'degraded'],
    ['success', '{"ok":true,"_meta":{"result_state":"results","ignored_args":[]}}', 'ok'],
    ['success', 'not json', 'ok'],
  ])('%s + %s → %s', (status, content, expected) => {
    expect(toolBillingOutcome(status, content)).toBe(expected);
  });
  it('the reason prefers failed, then refused, then degraded', () => {
    expect(unbillableToolReason(['ok'])).toBeNull();
    expect(unbillableToolReason(['degraded', 'refused'])).toBe('tool_refused');
    expect(unbillableToolReason(['degraded', 'failed', 'refused'])).toBe('tool_failed');
    expect(unbillableToolReason(['degraded'])).toBe('tool_degraded');
  });
});

describe('buildOpportunityContextBlock — facts only from the record', () => {
  const rec: OpportunityRecord = {
    notice_id: NID, title: 'Janitorial Services, Building 12', solicitation_number: 'W912PL26Q0042',
    department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE ARMY', office: 'W071 ENDIST LOS ANGELES',
    notice_type: 'Solicitation', set_aside_description: 'Total Small Business Set-Aside (FAR 19.5)',
    naics_code: '561720', psc_code: 'S201', posted_date: '2026-11-01', response_deadline: '2026-12-04T17:00:00Z',
    pop_city: null, pop_state: 'CA', description: 'Provide janitorial services for Building 12.',
    sow_text: 'COVER PAGE. ' + 'filler text '.repeat(3000) + ' The contractor shall provide 3 references of similar value within $500,000. ' + 'more filler '.repeat(3000),
    ui_link: 'https://sam.gov/opp/' + NID + '/view', active: true,
  };
  it('carries the record facts and labels the source', () => {
    const { block, source } = buildOpportunityContextBlock(rec, 'How many references do they want?');
    for (const f of ['W912PL26Q0042', 'DEPT OF THE ARMY', '561720', '2026-12-04T17:00:00Z', 'Total Small Business Set-Aside', 'CA']) expect(block).toContain(f);
    expect(block).toMatch(/not a source of the user|this is a source, not the user's words/);
    expect(source).toEqual({ label: 'SAM.gov notice W912PL26Q0042', url: rec.ui_link });
  });
  it('picks the statement-of-work excerpt relevant to the question (shared Proposal Assist selector)', () => {
    const { block } = buildOpportunityContextBlock(rec, 'How many references do they want?');
    expect(block).toContain('3 references of similar value');
    expect(block.length).toBeLessThan(25000);
  });
  it('says what is absent instead of filling it in', () => {
    const { block } = buildOpportunityContextBlock({ ...rec, set_aside_description: null, description: 'https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=x', sow_text: null }, 'q');
    expect(block).toContain('Set-aside: not stated in the record');
    expect(block).toContain('not available in Mindy\'s copy of this notice');
    expect(block).toContain('get_solicitation_documents');
    expect(block).not.toContain('noticedesc');
  });
});

describe('describeDeadline — time zones are converted in code, never by the model', () => {
  it('a UTC evening deadline reads as the right Eastern time (the live-check miss: 23:00 UTC is 6:00 PM ET, not 11 PM)', () => {
    const d = describeDeadline('2026-11-27T23:00:00+00:00')!;
    expect(d).toContain('6:00 PM Eastern');
    expect(d).toContain('2026-11-27 23:00 UTC');
    expect(d).toContain('do not convert time zones yourself');
  });
  it('follows daylight saving (summer is UTC-4)', () => {
    expect(describeDeadline('2026-07-01T16:00:00Z')).toContain('12:00 PM Eastern');
  });
  it('crosses midnight into the previous Eastern day', () => {
    expect(describeDeadline('2026-12-05T03:30:00Z')).toContain('Dec 4, 2026, 10:30 PM Eastern');
  });
  it('date-only, unparseable and empty values are not invented', () => {
    expect(describeDeadline('2026-12-04')).toBe('2026-12-04');
    expect(describeDeadline('soon')).toBe('soon');
    expect(describeDeadline(null)).toBeNull();
  });
  it('the context block carries the Eastern reading', () => {
    const { block } = buildOpportunityContextBlock({
      notice_id: NID, title: 't', solicitation_number: 'S1', department: null, sub_tier: null, office: null, notice_type: null,
      set_aside_description: null, naics_code: null, psc_code: null, posted_date: null, response_deadline: '2026-11-27T23:00:00+00:00',
      pop_city: null, pop_state: null, description: null, sow_text: null, ui_link: null, active: true,
    }, 'when is it due');
    expect(block).toMatch(/Response deadline: 2026-11-27T23:00:00\+00:00 \(= .*6:00 PM Eastern/);
  });
});

describe('CARD_CHAT_TOOLS — a narrowing list of real, chat-allowed tools', () => {
  it('every name is a registered tool and passes the chat tool policy', () => {
    // find_my_documents is a private tool registered by the chat route when VAULT_ASK_MINDY_UPLOADS is on.
    const registered = new Set<string>([...listMcpTools().map((d) => String((d.function as { name?: string }).name)), ...TIER0_TOOL_NAMES, FIND_MY_DOCUMENTS]);
    for (const n of CARD_CHAT_TOOLS) {
      expect(registered.has(n), n).toBe(true);
      expect(isChatOfferable(chatToolPolicy(n, true)), n).toBe(true);
    }
  });
  it('holds no write tools and no report or proposal generators', () => {
    for (const n of ['schedule_market_search', 'delete_market_schedule', 'generate_market_report', 'draft_proposal', 'add_contacts_to_crm']) {
      expect(CARD_CHAT_TOOLS.has(n)).toBe(false);
    }
  });
});

describe('buildOpportunityContextBlock origin (plain chat, mentioned-notice.ts)', () => {
  const rec = {
    notice_id: 'a'.repeat(32), title: 'T', solicitation_number: 'SPRPA127RUA05', department: null, sub_tier: null, office: null,
    notice_type: null, set_aside_description: null, naics_code: null, psc_code: null, posted_date: null, response_deadline: null,
    pop_city: null, pop_state: null, description: 'Approved sources only.', sow_text: null, ui_link: null, active: true,
  };
  it('default stays the selected-on-the-map wording', () => {
    const { block } = buildOpportunityContextBlock(rec, 'q');
    expect(block).toMatch(/^SELECTED OPPORTUNITY/);
    expect(block).toContain('selected on the map');
  });
  it("'mentioned' says the user named it, never that it is selected on the map, and points drafts at the contact", () => {
    const { block } = buildOpportunityContextBlock(rec, 'q', ['Notice point of contact: KELI.BARISH@DLA.MIL'], 'mentioned');
    expect(block).toMatch(/^MENTIONED OPPORTUNITY .*the user named SPRPA127RUA05/);
    expect(block).not.toContain('selected on the map');
    expect(block).toMatch(/address a draft to that contact and cite the solicitation number/);
    expect(block).toContain('Approved sources only.');
    expect(block).toContain('KELI.BARISH@DLA.MIL');
  });
});
