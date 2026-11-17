/**
 * Ask Mindy Vault RETRIEVAL (Eric, 2026-11-16: "Ask Mindy must retrieve relevant Vault
 * information. It must not send the whole Vault to the model on every question.").
 *
 * The chat's `search_my_vault` tool used to return whatever `loadVaultContext(email,
 * 'exec_summary')` produced: the raw identity row (EIN included) plus up to 10 past
 * performance rows, and NO capabilities or team, because exec_summary never loads them.
 *
 * Now:
 *   - The Vault is loaded once with every section (the loader's `sections` option), but
 *     that load stays server-side. It is the pool, not the payload.
 *   - With a question, the records are ranked by the EXISTING hybrid matcher
 *     (`matchRequirementsToEvidence`: vector + lexical, RRF-fused, no LLM rerank) and only
 *     the top few per section reach the model. If nothing matches, the answer says so;
 *     unrelated records are never padded in.
 *   - With no question, the model gets an overview: a safe identity summary, counts, and
 *     record titles. Never full record bodies.
 *   - Identity is a safe subset. EIN, bonding, revenue and contact details are not
 *     returned to chat.
 *
 * Email is bound by the caller (tier-0 closure). Nothing here takes identity from args.
 */
import type { VaultContext } from '@/lib/proposal/types';
import type { VaultSection } from '@/lib/proposal/loaders';
import { isStubRow } from '@/lib/proposal/loaders';

export type RetrievableSection = Exclude<VaultSection, 'identity'>;
export const RETRIEVABLE_SECTIONS: readonly RetrievableSection[] = ['past_performance', 'capabilities', 'team'];

/** One ranked hit from the matcher. `kind` uses the matcher's vocabulary. */
export interface VaultHit {
  kind: 'past_performance' | 'capability' | 'person';
  id: string;
  label: string;
  detail: string;
  score: number;
}

export interface VaultRetrievalDeps {
  loadVault: (email: string) => Promise<VaultContext>;
  matchEvidence: (email: string, query: string) => Promise<VaultHit[]>;
}

/** Max records per section sent to the model for one question. */
export const RETRIEVAL_CAPS: Record<RetrievableSection, number> = { past_performance: 5, capabilities: 5, team: 4 };
/** Max titles per section in the no-question overview. */
const OVERVIEW_TITLES = 5;
/** Pool size loaded server-side for hydration. Never sent wholesale. */
export const RETRIEVAL_POOL_LIMITS = { past_performance: 50, capabilities: 50, team: 30 } as const;

const HIT_KIND_TO_SECTION: Record<VaultHit['kind'], RetrievableSection> = {
  past_performance: 'past_performance',
  capability: 'capabilities',
  person: 'team',
};

const SAFE_IDENTITY_FIELDS = [
  'legal_name', 'dba', 'uei', 'cage_code', 'year_founded', 'employee_count', 'certifications',
  'primary_naics', 'one_liner', 'hq_city', 'hq_state', 'service_states', 'contract_vehicles', 'website',
] as const;

export function safeIdentity(identity: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!identity) return null;
  const out: Record<string, unknown> = {};
  for (const k of SAFE_IDENTITY_FIELDS) {
    const v = identity[k];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

type Row = Record<string, unknown>;

function shapePastPerformance(r: Row): Row {
  return pick(r, ['contract_title', 'agency', 'sub_agency', 'office', 'contract_number', 'period_start', 'period_end', 'contract_value', 'role', 'scope_description', 'outcomes', 'cpars_rating', 'naics_codes']);
}
function shapeCapability(r: Row): Row {
  return pick(r, ['capability_name', 'description', 'evidence', 'related_naics', 'tools_methods']);
}
function shapePerson(r: Row): Row {
  return pick(r, ['full_name', 'title', 'role_type', 'is_key_personnel', 'security_clearance', 'certifications', 'years_experience', 'bio_short']);
}
const SHAPERS: Record<RetrievableSection, (r: Row) => Row> = {
  past_performance: shapePastPerformance,
  capabilities: shapeCapability,
  team: shapePerson,
};

function pick(r: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const k of keys) {
    const v = r[k];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}

function titleOf(section: RetrievableSection, r: Row): string | null {
  const t = section === 'past_performance'
    ? [r.contract_title, r.agency].filter(Boolean).join(' — ')
    : section === 'capabilities' ? r.capability_name : [r.full_name, r.title].filter(Boolean).join(', ');
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

/** Real (non-template) rows of one section. Team rows have no stub template. */
function realRows(ctx: VaultContext, section: RetrievableSection): Row[] {
  const rows = (ctx[section] || []) as Row[];
  return section === 'team' ? rows : rows.filter((r) => !isStubRow(r));
}

export interface RetrieveArgs {
  query?: string | null;
  sections?: readonly RetrievableSection[] | null;
}

/** Validate the model-supplied args. Unknown fields and values are dropped. */
export function parseRetrieveArgs(args: Record<string, unknown> | null | undefined): RetrieveArgs {
  const q = typeof args?.query === 'string' ? args.query.trim().slice(0, 300) : '';
  const rawSections = Array.isArray(args?.sections) ? args.sections : [];
  const sections = rawSections.filter((s): s is RetrievableSection =>
    typeof s === 'string' && (RETRIEVABLE_SECTIONS as readonly string[]).includes(s));
  return { query: q || null, sections: sections.length ? [...new Set(sections)] : null };
}

export interface RetrieveOptions {
  /** Whose Vault this is, for wording only: a coach in a client workspace reads "this client's Vault". */
  owner?: 'own' | 'client';
}

export async function retrieveVault(
  email: string,
  args: RetrieveArgs,
  deps: VaultRetrievalDeps,
  opts: RetrieveOptions = {},
): Promise<Record<string, unknown>> {
  const whose = opts.owner === 'client' ? "this client's Vault" : 'your Vault';
  const Whose = whose[0].toUpperCase() + whose.slice(1);
  const sections = args.sections ?? RETRIEVABLE_SECTIONS;
  const query = args.query?.trim() || null;

  const [vault, hits] = await Promise.all([
    deps.loadVault(email),
    query ? deps.matchEvidence(email, query).catch(() => [] as VaultHit[]) : Promise.resolve([] as VaultHit[]),
  ]);

  if (!vault.has_any) {
    return { ok: true, has_any: false, note: `${Whose} is empty — no identity, past performance, capabilities or team saved yet.` };
  }

  const counts: Record<RetrievableSection, number> = { past_performance: 0, capabilities: 0, team: 0 };
  const pool: Record<RetrievableSection, Row[]> = { past_performance: [], capabilities: [], team: [] };
  for (const s of RETRIEVABLE_SECTIONS) {
    pool[s] = realRows(vault, s);
    counts[s] = pool[s].length;
  }
  // Identity rides along on a general read. When the model asked for specific
  // record sections only, it is left out.
  const identity = args.sections ? null : safeIdentity(vault.identity);

  if (!query) {
    const overview: Record<string, string[]> = {};
    for (const s of sections) {
      overview[s] = pool[s].map((r) => titleOf(s, r)).filter((t): t is string => !!t).slice(0, OVERVIEW_TITLES);
    }
    return {
      ok: true,
      has_any: true,
      mode: 'overview',
      identity,
      counts,
      titles: overview,
      note: 'Overview only. Call again with `query` (what the user is asking about) to retrieve the matching records.',
    };
  }

  const byId: Record<RetrievableSection, Map<string, Row>> = {
    past_performance: new Map(), capabilities: new Map(), team: new Map(),
  };
  for (const s of RETRIEVABLE_SECTIONS) {
    for (const r of pool[s]) if (r.id != null) byId[s].set(String(r.id), r);
  }

  const out: Record<RetrievableSection, Row[]> = { past_performance: [], capabilities: [], team: [] };
  const seen = new Set<string>();
  for (const h of [...hits].sort((a, b) => b.score - a.score)) {
    const section = HIT_KIND_TO_SECTION[h.kind];
    if (!section || !sections.includes(section)) continue;
    if (out[section].length >= RETRIEVAL_CAPS[section]) continue;
    const key = `${section}:${h.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = byId[section].get(String(h.id));
    // A hit outside the loaded pool (or a template row) is skipped rather than
    // reconstructed from the snippet: the record facts must come from the row.
    if (!row) continue;
    out[section].push(SHAPERS[section](row));
  }

  const matched = sections.reduce((n, s) => n + out[s].length, 0);
  const result: Record<string, unknown> = {
    ok: true,
    has_any: true,
    mode: 'retrieved',
    query,
    identity,
    counts,
    matched,
  };
  for (const s of sections) result[s] = out[s];
  if (matched === 0) {
    result.note = `Nothing in ${whose} matches "${query}". Do not substitute unrelated records; say the Vault has no matching ${sections.join('/').replace(/_/g, ' ')}.`;
  }
  return result;
}
