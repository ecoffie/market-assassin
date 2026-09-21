/**
 * Requirement → evidence matcher (Phase 3 of the Vault semantic weave).
 *
 * Given an RFP's requirements and a bidder's Vault, find — for EACH requirement —
 * the few pieces of the bidder's real experience (past performance, capabilities,
 * key personnel) that actually satisfy it, with a cited reason. This is what turns
 * semantic retrieval into proposal text: the drafter no longer gets a blind dump
 * of the vault's first 10 rows, it gets "for requirement X, cite contracts A, B".
 *
 * The retrieval is HYBRID — the pattern a top SaaS uses because neither channel
 * alone is enough:
 *   1. VECTOR recall  — match_vault_evidence RPC (pgvector cosine). Catches MEANING:
 *      "asbestos abatement" ↔ "hazardous material remediation" with no shared words.
 *   2. LEXICAL recall — exact term / code / acronym overlap. Catches what embeddings
 *      miss: a specific NAICS, a PSC, "8(a)", "SCIF", a part number — high-signal
 *      tokens whose exact presence matters more than their fuzzy meaning.
 * The two ranked lists are fused with RRF (Reciprocal Rank Fusion) — rank-based, so
 * it needs no score calibration between the (cosine ~0.2-0.6) and (token-overlap)
 * scales. An optional LLM rerank makes the final cut and writes the one-line "why".
 *
 * Grounding (#1): every returned item is a REAL vault row (id + label + snippet).
 * The matcher never invents evidence; when nothing clears the floor it returns an
 * empty match for that requirement (an honest gap the drafter brackets).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/market/embeddings';
import { toPgVector, type VaultKind } from '@/lib/vault/embed-evidence';
import { callLLM } from '@/lib/llm/call-llm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: SupabaseClient<any> | null = null;
function getSupabase(): SupabaseClient {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

// ---- Tunables (env-overridable so rollout can tune without a deploy) ----------
// Cosine floor: below this a vector hit is noise. Domain scores top ~0.6 (see
// embeddings.ts telemetry), so 0.30 is permissive on purpose — the RRF + rerank
// do the real discrimination; this only drops obvious junk.
export const EVIDENCE_MIN_SCORE = parseFloat(process.env.EVIDENCE_MIN_SCORE || '0.30');
// How many candidates each channel pulls before fusion.
const VECTOR_POOL = parseInt(process.env.EVIDENCE_VECTOR_POOL || '8', 10);
const LEXICAL_POOL = parseInt(process.env.EVIDENCE_LEXICAL_POOL || '8', 10);
// RRF constant — 60 is the canonical default (Cormack et al.); larger = flatter.
const RRF_K = parseInt(process.env.EVIDENCE_RRF_K || '60', 10);
// Final evidence items kept per requirement.
const TOP_PER_REQUIREMENT = parseInt(process.env.EVIDENCE_TOP_N || '4', 10);

// ---- Public shapes -----------------------------------------------------------

/** One evidence item mapped to a requirement (a real Vault row). */
export interface EvidenceItem {
  kind: VaultKind;
  id: string;
  label: string;        // contract title / capability name / person name
  detail: string;       // scope / description / bio snippet
  score: number;        // fused relevance (0..1-ish, monotonic within a requirement)
  /** Filled only when the LLM rerank runs — a one-line "why this fits". */
  why?: string;
}

/** A requirement paired with its best supporting evidence. */
export interface RequirementEvidence {
  requirementId: string;
  requirement: string;
  evidence: EvidenceItem[];
  /** True when NO vault evidence cleared the floor — an honest gap to bracket. */
  gap: boolean;
}

/** Minimal requirement input — compatible with ComplianceRequirement. */
export interface RequirementInput {
  id: string;
  requirement: string;
  section?: string;
  source_quote?: string;
}

// ---- Lexical channel ---------------------------------------------------------
// Pull the owner's rows once, score by term overlap in JS. At Vault scale (tens to
// low-hundreds of rows per user) a full scan is cheaper + simpler than N ilike
// round-trips, and lets us weight code/acronym tokens without SQL gymnastics.

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'shall',
  'must', 'will', 'be', 'is', 'are', 'that', 'this', 'as', 'at', 'by', 'from',
  'contractor', 'offeror', 'government', 'provide', 'provides', 'including', 'per',
  'all', 'any', 'each', 'such', 'which', 'other', 'required', 'requirement',
]);

/** Significant terms from a requirement: words ≥3 chars + codes/acronyms kept whole. */
function terms(text: string): string[] {
  const out = new Set<string>();
  for (const raw of (text || '').toLowerCase().split(/[^a-z0-9()]+/)) {
    const w = raw.trim();
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w);
  }
  return [...out];
}

/** Is this token a high-signal code/acronym (exact presence matters most)? */
function isCodeToken(t: string): boolean {
  return /\d/.test(t) || (t === t.toUpperCase() && t.length <= 6 && /[a-z]/i.test(t));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowText(kind: VaultKind, row: any): string {
  if (kind === 'past_performance') {
    return [row.contract_title, row.agency, row.sub_agency, row.role, row.scope_description,
      row.outcomes, arr(row.relevance_keywords), arr(row.naics_codes)].filter(Boolean).join(' ');
  }
  if (kind === 'capability') {
    return [row.capability_name, row.description, row.evidence, arr(row.keywords),
      arr(row.related_naics), arr(row.tools_methods)].filter(Boolean).join(' ');
  }
  return [row.full_name, row.title, row.role_type, row.security_clearance,
    arr(row.certifications), row.bio_short, row.bio_full].filter(Boolean).join(' ');
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function arr(v: any): string { return Array.isArray(v) ? v.join(' ') : ''; }

interface RawRow {
  kind: VaultKind;
  id: string;
  label: string;
  detail: string;
  haystack: string;   // lowercased searchable text
}

/** Load the owner's vault rows once (reused across every requirement in a doc). */
async function loadVaultRows(email: string): Promise<RawRow[]> {
  const sb = getSupabase();
  const [pp, caps, team] = await Promise.all([
    sb.from('user_past_performance')
      .select('id, contract_title, agency, sub_agency, role, scope_description, outcomes, relevance_keywords, naics_codes')
      .eq('user_email', email).is('archived_at', null),
    sb.from('user_capabilities_library')
      .select('id, capability_name, description, evidence, keywords, related_naics, tools_methods')
      .eq('user_email', email).is('archived_at', null),
    sb.from('user_team_members')
      .select('id, full_name, title, role_type, security_clearance, certifications, bio_short, bio_full')
      .eq('user_email', email).is('archived_at', null),
  ]);
  const rows: RawRow[] = [];
  for (const r of pp.data || []) rows.push({ kind: 'past_performance', id: r.id, label: r.contract_title || '(untitled)', detail: r.scope_description || r.outcomes || '', haystack: rowText('past_performance', r).toLowerCase() });
  for (const r of caps.data || []) rows.push({ kind: 'capability', id: r.id, label: r.capability_name || '(unnamed)', detail: r.description || '', haystack: rowText('capability', r).toLowerCase() });
  for (const r of team.data || []) rows.push({ kind: 'person', id: r.id, label: r.full_name || '(unnamed)', detail: r.bio_short || r.title || '', haystack: rowText('person', r).toLowerCase() });
  return rows;
}

/** Rank vault rows for one requirement by weighted term overlap. */
function lexicalRank(reqText: string, rows: RawRow[], limit: number): { id: string; kind: VaultKind; label: string; detail: string; score: number }[] {
  const ts = terms(reqText);
  if (!ts.length) return [];
  const scored = rows.map((r) => {
    let score = 0;
    for (const t of ts) {
      if (r.haystack.includes(t)) score += isCodeToken(t) ? 3 : 1;
    }
    return { id: r.id, kind: r.kind, label: r.label, detail: r.detail, score };
  }).filter((r) => r.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// ---- Vector channel ----------------------------------------------------------

interface VectorHit { kind: VaultKind; id: string; label: string; detail: string; score: number }

async function vectorRank(email: string, reqText: string, limit: number): Promise<VectorHit[]> {
  try {
    const vec = await embedText(reqText);
    const { data, error } = await getSupabase().rpc('match_vault_evidence', {
      p_email: email,
      p_query: toPgVector(vec),
      p_match_count: limit,
      p_min_score: EVIDENCE_MIN_SCORE,
    });
    if (error || !Array.isArray(data)) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((d) => ({ kind: d.kind as VaultKind, id: String(d.id), label: d.label || '', detail: d.detail || '', score: Number(d.score) || 0 }));
  } catch {
    return [];
  }
}

// ---- RRF fusion --------------------------------------------------------------
// Reciprocal Rank Fusion: an item's fused score = Σ 1/(k + rank) across channels.
// Rank-based → no need to reconcile cosine vs token-overlap scales. Items strong in
// EITHER channel surface; items strong in BOTH rise to the top.

function fuse(
  vector: VectorHit[],
  lexical: { id: string; kind: VaultKind; label: string; detail: string; score: number }[],
): EvidenceItem[] {
  const byId = new Map<string, { item: Omit<EvidenceItem, 'score'>; rrf: number; cosine: number }>();
  const add = (list: { id: string; kind: VaultKind; label: string; detail: string; score: number }[], isVector: boolean) => {
    list.forEach((hit, rank) => {
      const cur = byId.get(hit.id);
      const rrf = 1 / (RRF_K + rank + 1);
      if (cur) {
        cur.rrf += rrf;
        if (isVector) cur.cosine = hit.score;
      } else {
        byId.set(hit.id, {
          item: { kind: hit.kind, id: hit.id, label: hit.label, detail: hit.detail },
          rrf,
          cosine: isVector ? hit.score : 0,
        });
      }
    });
  };
  add(vector, true);
  add(lexical, false);
  return [...byId.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .map((v) => ({ ...v.item, score: v.rrf }));
}

// ---- Optional LLM rerank -----------------------------------------------------
// The fused list is good recall; the rerank is precision + the citable "why". It
// judges each candidate strictly against THE requirement and drops the ones that
// only share surface tokens. Kept OFF the hot path unless asked (it's a per-doc
// batch call). Grounded: it may only reference the evidence we pass it.

interface RerankOut { picks: { id: number | string; why: string }[] }

async function rerank(requirement: string, candidates: EvidenceItem[], keep: number): Promise<EvidenceItem[]> {
  if (candidates.length <= 1) {
    return candidates.map((c) => ({ ...c, why: c.why }));
  }
  const list = candidates
    .map((c, i) => `[${i}] (${c.kind}) ${c.label}: ${(c.detail || '').slice(0, 300)}`)
    .join('\n');
  const system = 'You match a bidder\'s real past work to ONE federal requirement. You may ONLY reference the numbered evidence given — never invent. Pick the items that genuinely help satisfy the requirement; drop items that merely share a word. If none fit, return an empty list.';
  const user = `REQUIREMENT:\n${requirement}\n\nCANDIDATE EVIDENCE (bidder's real vault):\n${list}\n\nReturn JSON {"picks":[{"id":<number>,"why":"<=15 words on how this evidence satisfies the requirement"}]}. At most ${keep}, best first. Omit any that don't genuinely fit.`;
  try {
    // dataClass 'sensitive' — the prompt embeds the bidder's real vault evidence
    // (PII), so restrict to the vetted no-training providers (Data Trust 3.1).
    const { text } = await callLLM({ system, user, json: true, job: 'reasoning', temperature: 0, maxTokens: 500, dataClass: 'sensitive', tool: 'proposal_evidence_match', userEmail: null });
    const parsed = JSON.parse(text) as RerankOut;
    if (!parsed?.picks?.length) return [];
    const out: EvidenceItem[] = [];
    for (const p of parsed.picks) {
      const idx = Number(p.id);
      const c = Number.isInteger(idx) ? candidates[idx] : undefined;
      if (c && !out.find((o) => o.id === c.id)) out.push({ ...c, why: (p.why || '').trim() || undefined });
      if (out.length >= keep) break;
    }
    return out;
  } catch {
    // Rerank failed → fall back to the fused top-N (recall over silence).
    return candidates.slice(0, keep);
  }
}

// ---- Orchestration -----------------------------------------------------------

export interface MatchOptions {
  /** Run the LLM rerank (precision + "why"). Default true. */
  useRerank?: boolean;
  /** Evidence items kept per requirement. Default TOP_PER_REQUIREMENT. */
  topN?: number;
  /** Cap requirements processed (protects the LLM budget on huge matrices). */
  maxRequirements?: number;
  /** Concurrency for per-requirement work. Default 4. */
  concurrency?: number;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Render a requirement→evidence map as a prompt block the drafter can cite from.
 * This is the point of Phase 4: instead of dumping the vault's first 10 rows, the
 * model is told, per requirement, WHICH real contract/capability to cite — and
 * where the vault has NOTHING, to bracket the gap rather than bluff.
 *
 * Returns '' when there is no useful mapping (empty vault / all gaps handled
 * elsewhere), so the caller can skip the block cleanly.
 */
export function formatEvidenceMapForPrompt(map: RequirementEvidence[]): string {
  const withEvidence = map.filter((m) => m.evidence.length > 0);
  const gaps = map.filter((m) => m.gap);
  if (!withEvidence.length && !gaps.length) return '';

  const lines: string[] = [];
  for (const m of withEvidence) {
    lines.push(`- **${m.requirement}**`);
    for (const e of m.evidence) {
      const why = e.why ? ` — ${e.why}` : '';
      lines.push(`    → cite [${e.kind}] "${e.label}"${why}`);
    }
  }

  let block = '';
  if (withEvidence.length) {
    block += `### Requirement → your real evidence (CITE THESE, one-to-one)\nFor each requirement below, the matcher found the bidder's ACTUAL past work that supports it. When you address that requirement, cite the named contract/capability specifically — do NOT substitute a generic "proven track record" claim, and do NOT cite a different requirement's evidence here.\n${lines.join('\n')}`;
  }
  if (gaps.length) {
    const gapLines = gaps.slice(0, 12).map((g) => `- ${g.requirement}`).join('\n');
    block += `${block ? '\n\n' : ''}### Requirements with NO matching evidence in the vault — BRACKET, do not bluff\nThe vault has no past performance or capability that supports these. Address them honestly: state any directly transferable strength plainly, then bracket the specifics the bidder must supply (e.g. "[relevant contract — title, agency, value]"). Never claim experience the vault can't back.\n${gapLines}`;
  }
  return block;
}

/**
 * Match a batch of requirements to the bidder's vault evidence.
 * Loads the vault ONCE, then runs hybrid retrieve → fuse → (rerank) per requirement.
 */
export async function matchRequirementsToEvidence(
  email: string,
  requirements: RequirementInput[],
  opts: MatchOptions = {},
): Promise<RequirementEvidence[]> {
  const useRerank = opts.useRerank !== false;
  const topN = opts.topN ?? TOP_PER_REQUIREMENT;
  const concurrency = opts.concurrency ?? 4;
  const reqs = opts.maxRequirements ? requirements.slice(0, opts.maxRequirements) : requirements;
  if (!reqs.length) return [];

  // Vault loaded once; lexical channel reuses it for every requirement.
  const vaultRows = await loadVaultRows(email);
  if (!vaultRows.length) {
    // Empty vault → every requirement is an honest gap.
    return reqs.map((r) => ({ requirementId: r.id, requirement: r.requirement, evidence: [], gap: true }));
  }

  return mapPool(reqs, concurrency, async (r) => {
    // The query text blends the crisp requirement with its verbatim quote — the
    // quote often carries the domain nouns that make the vector match land.
    const queryText = [r.requirement, r.source_quote].filter(Boolean).join('. ');
    const [vector, lexical] = await Promise.all([
      vectorRank(email, queryText, VECTOR_POOL),
      Promise.resolve(lexicalRank(queryText, vaultRows, LEXICAL_POOL)),
    ]);
    const fused = fuse(vector, lexical);
    if (!fused.length) {
      return { requirementId: r.id, requirement: r.requirement, evidence: [], gap: true };
    }
    // Rerank the fused pool (cap the pool we send the LLM to control tokens).
    const pool = fused.slice(0, Math.max(topN * 2, 6));
    const evidence = useRerank ? await rerank(r.requirement, pool, topN) : pool.slice(0, topN);
    return {
      requirementId: r.id,
      requirement: r.requirement,
      evidence,
      gap: evidence.length === 0,
    };
  });
}
