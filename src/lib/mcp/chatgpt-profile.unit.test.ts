/**
 * The ChatGPT MCP profile (/chatgpt/mcp) — allowlist, copy, annotations, instructions,
 * projection and neutral refusals. Owner decisions: tasks/chatgpt-plugin-path-a.md.
 *
 * Fixtures under __fixtures__/chatgpt-profile/ were CAPTURED from the real tool
 * functions on 2026-10-02 (read-only calls; government contact details redacted), so the
 * projection is tested against real output shapes, not guessed ones.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHATGPT_TOOL_ALLOWLIST,
  CHATGPT_TOOL_COPY,
  CHATGPT_SERVER_INFO,
  CHATGPT_SERVER_INSTRUCTIONS,
  CHATGPT_META_ALLOW,
  CHATGPT_META_DENY_DOCUMENTED,
  CHATGPT_PARAM_COPY,
  chatgptInputSchema,
  chatgptRegistrationList,
  chatgptToolResultFromMeteredError,
  isChatgptTool,
  projectChatgptResult,
} from './chatgpt-profile';
import { buildChatgptRefusal, CHATGPT_REFUSAL_CODES } from './chatgpt-refusals';
import { mcpRegistrationList } from './tool-schemas';
import { listMcpTools } from './tool-registry';
import { isPublicMcpTool } from './public-catalog-config';

const FIX = join(__dirname, '__fixtures__', 'chatgpt-profile');
const load = (name: string) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8')) as Record<string, unknown>;

// Owner-confirmed FINAL Path A 15 (2026-10-03). Removed: search_contractors (replaced by
// find_capable_contractors), search_federal_events, get_award_detail.
const EXPECTED = [
  'find_opportunities', 'lookup_solicitation', 'get_solicitation_documents', 'get_solicitation_incumbent',
  'get_expiring_contracts', 'search_past_contracts', 'search_grants', 'find_capable_contractors',
  'get_contractor_profile', 'lookup_sam_entity', 'assess_market_depth', 'get_agency_intel',
  'get_legislation_status', 'capability_market_match', 'get_keyword_coverage',
];
const DROPPED = ['search_contractors', 'search_federal_events', 'get_award_detail'];
const ALL_TOOL_NAMES = listMcpTools().map((t) => (t as { function: { name: string } }).function.name);
/** Every registered tool name (full registry, 64) outside the 15 that a string mentions. */
const foreignToolsIn = (text: string) =>
  ALL_TOOL_NAMES.filter((n) => !EXPECTED.includes(n) && new RegExp(`\\b${n}\\b`).test(text));

/** Commerce words banned from ChatGPT descriptions and refusal copy. Word-bounded so
 *  legitimate GovCon vocabulary ("buyer", "buying office") is not a false positive. */
const BANNED: RegExp[] = [
  /\$/, /\bprices?\b/i, /\bpricing\b/i, /\bbuy\b/i, /\bpurchas/i, /\btop[ -]?up\b/i, /\bupgrad/i,
  /\bsubscri/i, /\bcheckout\b/i, /\bstripe\b/i, /getmindy\.ai\/mcp/i, /\bcontinue/i,
];
const bannedHits = (text: string) => BANNED.filter((re) => re.test(text)).map(String);

// zod 4 keeps .describe() text on the inner type of an optional()
function descOf(s: unknown): string | undefined {
  const t = s as { unwrap?: () => { description?: string }; description?: string };
  return t.description ?? (typeof t.unwrap === 'function' ? t.unwrap().description : undefined);
}

function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) { out.add(k); allKeys(val, out); }
  }
  return out;
}
function metaObjects(v: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(v)) v.forEach((x) => metaObjects(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      if (k === '_meta' && val && typeof val === 'object') out.push(val as Record<string, unknown>);
      metaObjects(val, out);
    }
  }
  return out;
}

describe('allowlist', () => {
  it('is exactly the 15 owner-approved tools', () => {
    expect([...CHATGPT_TOOL_ALLOWLIST].sort()).toEqual([...EXPECTED].sort());
    expect(CHATGPT_TOOL_ALLOWLIST).toHaveLength(15);
  });

  it('registers exactly those 15, every one present in the registry', () => {
    const reg = chatgptRegistrationList();
    expect(reg.map((r) => r.name)).toEqual([...CHATGPT_TOOL_ALLOWLIST]);
    const registryNames = new Set(listMcpTools().map((t) => (t as { function: { name: string } }).function.name));
    for (const n of EXPECTED) expect(registryNames.has(n)).toBe(true);
  });

  it('every allowlisted tool is in the PUBLIC MCP catalog (#1777), not just the registry', () => {
    const publicNames = new Set(mcpRegistrationList().map((e) => e.name));
    for (const n of EXPECTED) {
      expect(isPublicMcpTool(n), n).toBe(true);
      expect(publicNames.has(n), n).toBe(true);
    }
  });

  it('rejects other names (isChatgptTool), including the three dropped from the final 15', () => {
    for (const n of [...DROPPED, 'get_balance', 'draft_proposal', 'add_contacts_to_crm', 'schedule_market_search', 'get_winning_playbook', 'nope']) {
      expect(isChatgptTool(n)).toBe(false);
    }
  });

  it('reuses the registry input schemas (same params; only description text may differ)', () => {
    const full = new Map(mcpRegistrationList().map((e) => [e.name, e]));
    for (const e of chatgptRegistrationList()) {
      expect(Object.keys(e.inputSchema).sort()).toEqual(Object.keys(full.get(e.name)!.inputSchema).sort());
    }
  });
});

describe('ChatGPT-only parameter descriptions (owner decision 2)', () => {
  const registryParams = (tool: string) =>
    new Set(Object.keys(mcpRegistrationList().find((e) => e.name === tool)!.inputSchema));

  it('every override names an allowlisted tool and a parameter the registry really has', () => {
    for (const [tool, params] of Object.entries(CHATGPT_PARAM_COPY)) {
      expect(isChatgptTool(tool)).toBe(true);
      const known = registryParams(tool);
      for (const p of Object.keys(params ?? {})) expect(known.has(p), `${tool}.${p}`).toBe(true);
    }
  });

  it('drift guard: an override for a nonexistent parameter throws', () => {
    const base = mcpRegistrationList().find((e) => e.name === 'search_grants')!.inputSchema;
    expect(() => chatgptInputSchema('search_grants', base, { not_a_param: 'x' })).toThrow(/search_grants\.not_a_param/);
  });

  it('does not mutate the registry shape it is given', () => {
    const base = mcpRegistrationList().find((e) => e.name === 'find_capable_contractors')!.inputSchema;
    const before = descOf((base as Record<string, unknown>).limit);
    const mine = chatgptInputSchema('find_capable_contractors', base);
    expect(descOf((base as Record<string, unknown>).limit)).toBe(before);
    expect(descOf((mine as Record<string, unknown>).limit)).not.toBe(before);
    expect(before).toMatch(/per-call cost/); // the registry (Claude) text is still the registry text
  });

  it('overridden params keep optionality; the description is the ChatGPT text', () => {
    const full = new Map(mcpRegistrationList().map((e) => [e.name, e]));
    for (const e of chatgptRegistrationList()) {
      const overrides = CHATGPT_PARAM_COPY[e.name as keyof typeof CHATGPT_PARAM_COPY] ?? {};
      for (const [p, text] of Object.entries(overrides)) {
        const mine = (e.inputSchema as Record<string, { isOptional(): boolean; description?: string }>)[p];
        const theirs = (full.get(e.name)!.inputSchema as Record<string, { isOptional(): boolean }>)[p];
        expect(mine.isOptional(), `${e.name}.${p}`).toBe(theirs.isOptional());
        expect(descOf(mine)).toBe(text);
      }
    }
  });
});

describe('descriptions + titles', () => {
  for (const name of EXPECTED) {
    const copy = CHATGPT_TOOL_COPY[name as keyof typeof CHATGPT_TOOL_COPY];
    it(`${name}: ≤600 chars, no commerce, no internals`, () => {
      expect(copy.description.length).toBeLessThanOrEqual(600);
      expect(bannedHits(copy.description)).toEqual([]);
      expect(copy.description).not.toMatch(/Credits:/);
      expect(copy.description).not.toMatch(/Mindy Pro/i);
      expect(copy.description).not.toMatch(/RESOLVED_SOLICITATION|MATCHED_CANDIDATE|DIRECT_MATCH|grounded=|host_rules|presentation\./);
      expect(copy.description).not.toMatch(/sam_opportunities|recompete_opportunities|agency_forecasts|institute_sources|usaspending\.awards|BigQuery/);
      expect(copy.description).not.toMatch(/Potato|first-value|FIND-first/i);
      expect(bannedHits(copy.title)).toEqual([]);
    });
    it(`${name}: mentions only sibling tools inside the subset`, () => {
      const others = listMcpTools().map((t) => (t as { function: { name: string } }).function.name).filter((n) => !EXPECTED.includes(n));
      for (const o of others) expect(copy.description.includes(o)).toBe(false);
    });
  }

  it('no ChatGPT-facing string names a tool outside the 15 (descriptions, titles, param descriptions, instructions, server info)', () => {
    const hits: string[] = [];
    for (const e of chatgptRegistrationList()) {
      for (const t of foreignToolsIn(`${e.title}\n${e.description}`)) hits.push(`${e.name}: ${t}`);
      for (const [p, schema] of Object.entries(e.inputSchema)) {
        const d = descOf(schema) ?? '';
        for (const t of foreignToolsIn(d)) hits.push(`${e.name}.${p}: ${t}`);
      }
    }
    for (const t of foreignToolsIn(CHATGPT_SERVER_INSTRUCTIONS)) hits.push(`instructions: ${t}`);
    for (const t of foreignToolsIn(String(CHATGPT_SERVER_INFO.description ?? ''))) hits.push(`serverInfo: ${t}`);
    expect(hits).toEqual([]);
    // the guard really sees a foreign name
    expect(foreignToolsIn('then use get_award_detail')).toEqual(['get_award_detail']);
  });

  it('overlapping tools each state a distinct intent', () => {
    const d = (n: keyof typeof CHATGPT_TOOL_COPY) => CHATGPT_TOOL_COPY[n].description;
    // documents vs lookup vs incumbent
    expect(d('get_solicitation_documents')).toMatch(/^Read the full text and attachments of one federal solicitation/);
    expect(d('lookup_solicitation')).toMatch(/get_solicitation_documents/);
    expect(d('get_solicitation_incumbent')).toMatch(/get_solicitation_documents/);
    // capable contractors vs profile vs market depth vs capability match
    expect(d('find_capable_contractors')).toMatch(/^Who could compete for, or team on, work in a market\?/);
    expect(d('find_capable_contractors')).toMatch(/get_contractor_profile/);
    expect(d('get_contractor_profile')).toMatch(/one company/);
    expect(d('get_contractor_profile')).toMatch(/find_capable_contractors/);
    expect(d('assess_market_depth')).toMatch(/Rule of Two/);
    expect(d('assess_market_depth')).toMatch(/find_capable_contractors/);
    expect(d('capability_market_match')).toMatch(/find_capable_contractors or assess_market_depth/);
  });

  it('resolves the lookup vs incumbent routing conflict explicitly', () => {
    expect(CHATGPT_TOOL_COPY.lookup_solicitation.description).toMatch(/identify one specific/i);
    expect(CHATGPT_TOOL_COPY.lookup_solicitation.description).toMatch(/get_solicitation_incumbent/);
    expect(CHATGPT_TOOL_COPY.get_solicitation_incumbent.description).toMatch(/^Who currently holds the contract behind a solicitation/);
  });
});

describe('annotations', () => {
  const ann = JSON.parse(readFileSync(join(process.cwd(), 'docs/chatgpt-plugin/annotations.json'), 'utf8')) as {
    tools: Record<string, Record<string, [boolean, string]>>;
  };

  it('every tool is read-only, non-destructive, idempotent, titled', () => {
    for (const e of chatgptRegistrationList()) {
      expect(e.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
      expect(e.annotations.title).toBe(e.title);
      expect(typeof e.annotations.openWorldHint).toBe('boolean');
    }
  });

  it('openWorldHint follows the implementation (live external call vs stored copy)', () => {
    const ow = Object.fromEntries(chatgptRegistrationList().map((e) => [e.name, e.annotations.openWorldHint]));
    expect(ow.get_legislation_status).toBe(false); // stored Congress record
    expect(ow.get_solicitation_documents).toBe(true); // live SAM.gov download for a cold notice
    expect(ow.find_capable_contractors).toBe(false); // Mindy's BigQuery award warehouse only
    expect(ow.assess_market_depth).toBe(false); // stored SAM entities + BigQuery only
  });

  it('docs/chatgpt-plugin/annotations.json agrees with the module, with a justification per hint', () => {
    expect(Object.keys(ann.tools).sort()).toEqual([...EXPECTED].sort());
    for (const e of chatgptRegistrationList()) {
      const row = ann.tools[e.name];
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
        expect(row[hint][0]).toBe(e.annotations[hint]);
        expect(row[hint][1].length).toBeGreaterThan(10);
      }
    }
  });
});

describe('server instructions + identity', () => {
  it('key guidance sits in the first 512 chars and is commerce-free', () => {
    const head = CHATGPT_SERVER_INSTRUCTIONS.slice(0, 512);
    expect(head).toMatch(/find_opportunities/);
    expect(head).toMatch(/lookup_solicitation/);
    expect(head).toMatch(/get_solicitation_incumbent/);
    expect(head).toMatch(/get_legislation_status/);
    expect(head).toMatch(/not zero/i);
    expect(bannedHits(CHATGPT_SERVER_INSTRUCTIONS)).toEqual([]);
    expect(CHATGPT_SERVER_INSTRUCTIONS).not.toMatch(/credit|Potato|first value|journey/i);
  });

  it('references only subset tools and keeps the no-fabrication rules', () => {
    const tools = listMcpTools().map((t) => (t as { function: { name: string } }).function.name);
    for (const t of tools) {
      if (CHATGPT_SERVER_INSTRUCTIONS.includes(t)) expect(EXPECTED).toContain(t);
    }
    expect(CHATGPT_SERVER_INSTRUCTIONS).toMatch(/not bill text/i);
    expect(CHATGPT_SERVER_INSTRUCTIONS).toMatch(/never invent/i);
  });

  it('websiteUrl is the product site, not the MCP console', () => {
    expect(CHATGPT_SERVER_INFO.websiteUrl).toBe('https://getmindy.ai');
  });
});

describe('projection — real captured outputs', () => {
  it('find_opportunities: drops internals, keeps grounding + presentation + identifiers', () => {
    const raw = load('find_opportunities');
    const p = projectChatgptResult('find_opportunities', raw);
    const keys = allKeys(p);

    // _meta: allowlist only
    const meta = p._meta as Record<string, unknown>;
    expect(meta.grounded).toBe(true);
    expect(meta.degraded).toBe(false);
    expect(meta.watch_coverage).toBeDefined();
    expect(meta.find_shape).toBeDefined();
    for (const k of ['composition', 'discovery', 'credits', 'billing_outcome']) expect(meta).not.toHaveProperty(k);

    // ranking internals gone
    expect((p.query_summary as Record<string, unknown>).interpreted_as).toBeUndefined();
    const mi = p.market_interpretation as Record<string, Record<string, unknown>>;
    expect(mi.retrieval_plan).toBeUndefined();
    expect(mi.truth.records).toBeUndefined();
    expect(mi.buyer?.needles).toBeUndefined();
    expect(mi.truth.what_was_requested).toBeDefined();
    expect(mi.truth.what_was_consumed).toBeDefined();
    expect(mi.truth.what_remains_unsupported).toBeDefined();
    expect(keys.has('allowed_handoffs')).toBe(false);
    for (const h of Object.values(p.horizons as Record<string, Record<string, unknown>>)) {
      for (const tag of (h.filters_consumed as string[]) ?? []) {
        expect(tag).not.toMatch(/canonical_discovery|^rank→|_via=|^eligibility:/);
      }
      expect(h.filters_unsupported).toBeDefined();
    }
    // presentation kept; host rules no longer steer to tools this surface lacks
    expect(p.presentation_note).toBe(raw.presentation_note);
    const pres = p.presentation as { host_rules: string[]; sections: unknown };
    expect(pres.sections).toBeDefined();
    for (const rule of pres.host_rules) {
      expect(rule).not.toMatch(/understand_customer|get_current_acquisition_intelligence|schedule_market_search|_next/);
    }
    // _next: offers for absent tools dropped, no credits anywhere
    for (const n of (p._next as Record<string, unknown>[]) ?? []) {
      expect(n).not.toHaveProperty('credits');
      if (n.tool) expect(EXPECTED).toContain(n.tool);
    }
    // public-record identifiers survive
    const open = (p.horizons as Record<string, { items: Record<string, unknown>[] }>).open_now.items;
    expect(open.length).toBeGreaterThan(0);
    expect(open[0].notice_id).toBeTruthy();
    expect(String(open[0].sam_url)).toMatch(/sam\.gov/);
  });

  it('lookup_solicitation: drops diagnostics, keeps candidate_count + items', () => {
    const raw = load('lookup_solicitation');
    const p = projectChatgptResult('lookup_solicitation', raw);
    const meta = p._meta as Record<string, unknown>;
    expect(meta.grounded).toBe(true);
    expect(meta.candidate_count).toBe((raw._meta as Record<string, unknown>).candidate_count);
    for (const k of ['collapsed_count', 'history_matches', 'corpus_matches', 'rows_before_collapse', 'db_ms', 'sow_text_used', 'external_api']) {
      expect(meta).not.toHaveProperty(k);
    }
    expect((p.items as unknown[]).length).toBe((raw.items as unknown[]).length);
    expect((p.items as Record<string, unknown>[])[0].notice_id).toBeTruthy();
  });

  it('get_legislation_status: keeps every grounding key it emits', () => {
    const raw = load('get_legislation_status');
    const p = projectChatgptResult('get_legislation_status', raw);
    expect(p._meta).toEqual(raw._meta); // grounded, degraded, source_count, as_of, resolution_kind
    expect(p.documents).toEqual(raw.documents);
    expect(p.limitations).toEqual(raw.limitations);
  });

  it('does not mutate the tool result', () => {
    const raw = load('find_opportunities');
    const before = JSON.stringify(raw);
    projectChatgptResult('find_opportunities', raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe('projection — shape fixtures for the other tools', () => {
  it('capability_market_match: keeps sections/anchor/evidence, drops elapsed_ms + competitor_derivation', () => {
    const raw = {
      subject: 'Acme', keywords: ['drones'], market: null, buyer_vocabulary: [], competitors: [], upcoming_forecasts: [], recompete_opportunities: [],
      _meta: {
        grounded: true, degraded: false, sections_omitted: ['competitors'], anchor_verified: true, anchor_confidence: 'high', lead_keyword: 'drones',
        lead_naics: '336411', tam_verified: true, competitor_derivation: { method: 'psc_pin' }, evidence: { identity: 'none', sources: [] },
        sections: { keywords: { shown: 1, available: 1 } }, elapsed_ms: 31234, note: 'Core market returned within budget',
      },
    };
    const p = projectChatgptResult('capability_market_match', raw);
    const meta = p._meta as Record<string, unknown>;
    expect(meta).toMatchObject({ grounded: true, degraded: false, sections_omitted: ['competitors'], anchor_verified: true, tam_verified: true });
    expect(meta).not.toHaveProperty('elapsed_ms');
    expect(meta).not.toHaveProperty('competitor_derivation');
  });

  it('get_solicitation_incumbent: drops match-scoring internals, keeps confidence + links', () => {
    const award = { awardId: 'W91', recipientName: 'X Corp', ceiling: 1e6, usaSpendingUrl: 'https://www.usaspending.gov/award/CONT_AWD_X', matchConfidence: 'medium', matchScore: 71, distinctiveHits: ['a'], workHits: 2, locationHits: 1, noticeSector: 'x', awardSector: 'y', incumbent_certainty: 'likely' };
    const raw = {
      queried: {}, notice: { notice_id: 'n1', ui_link: 'https://sam.gov/opp/n1/view', source: 'cache' }, incumbent: award, prior_awards: [award], summary: 'X',
      _meta: { grounded_notice: true, grounded_incumbent: true, degraded: false, notice_source: 'cache', incumbent_certainty: 'likely', status: 'active' },
      _ai_hint: { summary: 'at what price' },
    };
    const p = projectChatgptResult('get_solicitation_incumbent', raw);
    const inc = p.incumbent as Record<string, unknown>;
    expect(inc.matchConfidence).toBe('medium');
    expect(inc.usaSpendingUrl).toMatch(/usaspending\.gov/);
    for (const k of ['matchScore', 'distinctiveHits', 'workHits', 'locationHits']) expect(inc).not.toHaveProperty(k);
    expect((p.prior_awards as Record<string, unknown>[])[0]).not.toHaveProperty('matchScore');
    expect(p._meta).toEqual({ grounded_notice: true, grounded_incumbent: true, degraded: false, incumbent_certainty: 'likely', status: 'active' });
    expect(p).not.toHaveProperty('_ai_hint');
  });

  it('search_past_contracts: drops requests_fired, keeps field_status + state_scope', () => {
    const raw = { awards: [{ awardId: 'A', usaSpendingUrl: 'https://www.usaspending.gov/award/A' }], _meta: { grounded: true, degraded: false, count: 1, total: 1, state_scope: 'pop', requests_fired: 2, field_status: { naics: 'ok' } } };
    const p = projectChatgptResult('search_past_contracts', raw);
    expect(p._meta).toEqual({ grounded: true, degraded: false, count: 1, total: 1, state_scope: 'pop', field_status: { naics: 'ok' } });
  });

  it('get_solicitation_documents (real capture): keeps the paging contract + completeness, drops the cache-path label', () => {
    const raw = load('get_solicitation_documents');
    const p = projectChatgptResult('get_solicitation_documents', raw);
    const rawMeta = raw._meta as Record<string, unknown>;
    expect(rawMeta.source).toBe('cache');
    const { source: _s, ...expected } = rawMeta;
    void _s;
    expect(p._meta).toEqual(expected);
    expect(p._meta).not.toHaveProperty('source');
    expect(p._meta).toMatchObject({ grounded: true, coverage_complete: false, signed_url_ttl_seconds: 3600, retrieval_limitation: null });
    // the paging continuation survives verbatim — ChatGPT must be able to read the rest
    expect(p.next_page).toEqual(raw.next_page);
    expect((p.next_page as { document_ids: string[] }).document_ids.length).toBeGreaterThan(0);
    expect(p.coverage).toEqual(raw.coverage);
    expect(p.documents).toEqual(raw.documents);
    for (const d of p.documents as Record<string, unknown>[]) expect(String(d.download_url)).toMatch(/^https:\/\/sam\.gov\//);
  });

  it('find_capable_contractors (real capture, no tool _meta): grounding derived from ok/count only', () => {
    const raw = load('find_capable_contractors');
    const p = projectChatgptResult('find_capable_contractors', raw);
    expect(p._meta).toEqual({ grounded: true, degraded: false });
    expect(p.items).toEqual(raw.items);
    expect(p.total).toBe(raw.total);
    expect(projectChatgptResult('find_capable_contractors', { ok: true, count: 0, items: [], note: 'No contractors found for NAICS 999999.' })._meta)
      .toEqual({ grounded: false, degraded: false });
    expect(projectChatgptResult('find_capable_contractors', { ok: false, error: 'rate_limited', note: 'x', count: 0, items: [] })._meta)
      .toEqual({ grounded: false, degraded: true });
    expect(projectChatgptResult('find_capable_contractors', { ok: false, error: 'naics_or_psc_required', count: 0, items: [] })._meta)
      .toEqual({ grounded: false, degraded: false, validation_error: 'naics_or_psc_required' });
  });

  it('assess_market_depth: keeps every grounding/coverage key it emits', () => {
    // Shape from src/mcp/tools/market-depth.ts (a live call writes the KV result cache, so
    // this is built from the code, not captured). Firm details are placeholders.
    const meta = { grounded: true, degraded: false, market_depth: 41, capable_depth: 12, rule_of_two_met: true, businesses_returned: 15, businesses_available: 200 };
    const raw = {
      queried: { naics: '238220', state: 'AZ' }, market_depth: 41, capable_depth: 12, eligible_population: 310, matching_uei_count: 120,
      sample_size: 200, sample_coverage: 0.65, rule_of_two_determination: 'met', rule_of_two_conclusive: true, rule_of_two_met: true,
      counts: { active_performer: 7, capable: 5, emerging: 29 }, registered_only_count: 159,
      businesses: [{ uei: 'UEI000000001', legalBusinessName: 'Example HVAC LLC', pocName: '[redacted]', tier: 'active_performer' }],
      data_as_of: '2026-10-01', caveats: ['Set-aside eligibility uses SAM certifications.'], _meta: meta,
    };
    const p = projectChatgptResult('assess_market_depth', raw);
    expect(p._meta).toEqual(meta);
    expect(p.rule_of_two_determination).toBe('met');
    expect(p.sample_coverage).toBe(0.65);
  });

  it('get_contractor_profile (no tool _meta): grounding derived from its own resolution fields only', () => {
    expect(projectChatgptResult('get_contractor_profile', { ok: true, found: true, resolution: 'unique' })._meta).toEqual({ grounded: true, degraded: false });
    expect(projectChatgptResult('get_contractor_profile', { ok: true, found: false, resolution: 'ambiguous' })._meta).toEqual({ grounded: false, degraded: false });
    expect(projectChatgptResult('get_contractor_profile', { ok: false, found: false, resolution: 'lookup_failed' })._meta).toEqual({ grounded: false, degraded: true });
  });

  it('strips commerce keys at any depth and allowlists nested _meta', () => {
    const p = projectChatgptResult('search_grants', {
      grants: [{ url: 'https://www.grants.gov/x', _meta: { grounded: true, from_cache: true } }],
      continue_url: 'https://getmindy.ai/mcp/continue?attempt=1',
      nested: { attempt_id: 'a1', continuation_available: true, ok: 1 },
      _meta: { grounded: true, degraded: false, credits: { charged: 5, remaining: 10 }, elapsed_ms: 4 },
    });
    expect(p).not.toHaveProperty('continue_url');
    expect(p.nested).toEqual({ ok: 1 });
    expect((p.grants as Record<string, unknown>[])[0]._meta).toEqual({ grounded: true });
    expect(p._meta).toEqual({ grounded: true, degraded: false });
  });

  it('every documented-denied key is outside the allowlist', () => {
    for (const k of CHATGPT_META_DENY_DOCUMENTED) expect(CHATGPT_META_ALLOW.has(k)).toBe(false);
  });

  it('no projected fixture carries a denied _meta key anywhere', () => {
    for (const f of ['find_opportunities', 'lookup_solicitation', 'get_legislation_status', 'get_solicitation_documents', 'find_capable_contractors']) {
      const p = projectChatgptResult(f, load(f));
      for (const m of metaObjects(p)) for (const k of Object.keys(m)) expect(CHATGPT_META_ALLOW.has(k)).toBe(true);
      expect(JSON.stringify(p)).not.toMatch(/getmindy\.ai\/mcp|continue_url|"credits"/);
    }
  });
});

describe('neutral refusals', () => {
  const cases: { code: string; required?: number; available?: number }[] = [
    { code: 'insufficient_credits', required: 50, available: 45 },
    { code: 'team_pool_insufficient_credits', required: 10, available: 3 },
    { code: 'requires_pro' },
    { code: 'requires_paid_credits' },
    { code: 'rate_limited' },
    { code: 'billing_account_unresolved' },
  ];
  for (const c of cases) {
    it(`${c.code}: neutral copy, non-error, no commerce fields`, () => {
      const r = chatgptToolResultFromMeteredError('capability_market_match', { code: c.code, message: 'Top up → getmindy.ai/mcp ($49)' }, {
        requiredCredits: c.required ?? null,
        availableCredits: c.available ?? null,
      });
      expect(r.isError).toBe(false);
      const all = r.content.map((b) => b.text).join('\n') + JSON.stringify(r.structuredContent);
      expect(bannedHits(all)).toEqual([]);
      expect(all).not.toMatch(/ask your (team )?owner|adding credits/i);
      expect(r.structuredContent).not.toHaveProperty('continue_url');
      expect(r.structuredContent).not.toHaveProperty('continuation_available');
      expect(r.structuredContent).toMatchObject({ retryable: false, tool_name: 'capability_market_match' });
      expect(String((r.structuredContent as Record<string, unknown>).message)).toMatch(/Nothing was charged/);
    });
  }

  it('insufficient credits states exactly N needed and M held', () => {
    const r = buildChatgptRefusal({ code: 'insufficient_credits', toolName: 't', requiredCredits: 50, availableCredits: 45 });
    expect(r.message).toBe('This request needs 50 credits and the account has 45. Nothing was charged. Account credits are managed outside this chat.');
    expect(r.credits_needed).toBe(5);
  });

  it('prefers the metering layer\'s structured numbers over the fallback', () => {
    const r = chatgptToolResultFromMeteredError('t', { code: 'insufficient_credits', message: 'x', commercial: { required_credits: 50, available_credits: 12 } }, { requiredCredits: 5, availableCredits: 0 });
    expect(r.structuredContent).toMatchObject({ required_credits: 50, available_credits: 12 });
  });

  it('a genuine tool failure stays an error, without commerce', () => {
    const r = chatgptToolResultFromMeteredError('t', { code: 'tool_error', message: 'upstream timeout' }, { requiredCredits: 5, availableCredits: 10 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('tool_error: upstream timeout');
  });

  it('covers every refusal code the metering layer can return', () => {
    expect([...CHATGPT_REFUSAL_CODES].sort()).toEqual(cases.map((c) => c.code).sort());
  });
});
