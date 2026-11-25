/**
 * Ask Mindy context contract v1 (audit A2, A5, A8). EXISTING tool results only.
 *
 * Every tool result in a turn becomes a ContextSource: identity, provenance, owner/access, status, and when it
 * was retrieved. From those sources the route builds:
 *   - the tool messages the answer model reads (a rendered tool gets a short stub, not its JSON a second time);
 *   - a citation list (this turn's sources that actually returned data);
 *   - a compact SOURCE LEDGER (ids, labels, record keys; never raw tool JSON) sent to the client with each
 *     answer and re-sent with history. That gives follow-ups ("who's the incumbent on #12?", "the next 20") a
 *     real record id with no server storage and no migration.
 *
 * Documents and websites plug in later as adapters that produce ContextSource (kind 'user_document' /
 * 'website'). Fencing of untrusted text is NOT done here: Agent 3's #2112 adds src/lib/chat/untrusted-text.ts
 * for that. The ledger never carries untrusted prose to the model: keys are charset-limited and labels are
 * reduced to a short, plain identifier-like string before they enter a prompt.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RenderedRecords } from './record-render';
import { collectExpiringRecords, EXPIRING_TOOL } from './record-render';

export type SourceKind = 'federal_record' | 'account_record' | 'user_document' | 'website' | 'conversation' | 'user_instruction';
export type SourceTrust = 'verified_record' | 'user_supplied' | 'third_party_claim' | 'internal';
export type SourceStatus = 'ok' | 'empty' | 'degraded' | 'failed' | 'refused' | 'truncated';

/** A Vault document carried by the ledger: what kind it is, and (for a generated one) its version. */
export type VaultDocKind = 'company' | 'reference' | 'generated';
export interface LedgerDoc { kind: VaultDocKind; version?: number }

/** One numbered (or keyed) record inside a source. `n` is set only when the user SAW that number. */
export interface LedgerItem { n?: number; key: string; label: string; doc?: LedgerDoc }

export interface ContextSource {
  /** Stable for the conversation: "src:<tool>:<call>" for a tool result. */
  id: string;
  kind: SourceKind;
  trust: SourceTrust;
  /** null = public federal data. A private source is bound to the acting scope that produced it. */
  owner: { email: string; scope: string } | null;
  label: string;
  tool?: string;
  ref?: { url?: string; noticeId?: string; documentId?: string; page?: number; section?: string };
  /** The full extracted content (bounded later, when it is put into a prompt). */
  content: string;
  status: SourceStatus;
  shown?: number;
  total?: number;
  retrievedAt: string;
  asOf?: string | null;
  scope: 'turn' | 'conversation';
  /** Records the user can refer to in a follow-up. */
  items?: LedgerItem[];
  /** The redacted arguments of a public lookup, so "the next 20" can repeat the same search. */
  query?: Record<string, unknown> | null;
  /** True when the record list was rendered to the user verbatim (its JSON need not be re-sent). */
  rendered?: boolean;
}

export interface LedgerEntry {
  id: string;
  kind: SourceKind;
  tool?: string;
  label: string;
  status: SourceStatus;
  asOf?: string | null;
  retrievedAt: string;
  shown?: number;
  total?: number;
  /** Private entries carry the scope that produced them; they are dropped in any other scope. */
  private?: true;
  scope?: string;
  query?: Record<string, unknown>;
  items?: LedgerItem[];
}

/**
 * `sig` is an HMAC the server adds when it emits the ledger. A returned ledger is used only if the signature
 * verifies, so nothing the client wrote or edited can come back into a prompt (review MED, Agent 4).
 */
export interface SourceLedger { v: 1; entries: LedgerEntry[]; sig?: string }

/**
 * The ledger signing key: CHAT_LEDGER_SECRET if set, otherwise derived (HMAC with a fixed label) from the
 * service-role key every deployment already has. No key → ledgers are not signed and returned ledgers are
 * ignored (fail closed: follow-ups behave as before P3).
 */
function ledgerKey(): Buffer | null {
  const base = process.env.CHAT_LEDGER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) return null;
  return createHmac('sha256', base).update('ask-mindy-source-ledger:v1').digest();
}

function ledgerSig(entries: LedgerEntry[], key: Buffer): string {
  return createHmac('sha256', key).update(JSON.stringify({ v: 1, entries })).digest('base64url');
}

function verifyLedgerSig(entries: unknown, sig: unknown): boolean {
  const key = ledgerKey();
  if (!key || typeof sig !== 'string' || !Array.isArray(entries)) return false;
  const expected = Buffer.from(ledgerSig(entries as LedgerEntry[], key));
  const got = Buffer.from(sig);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const LEDGER_MAX_ENTRIES = 12;
export const LEDGER_MAX_ITEMS = 50;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-/]{2,63}$/;

/** Tools whose results are the caller's own (or an authorized client's) account data. */
export const PRIVATE_SOURCE_TOOLS: ReadonlySet<string> = new Set(['get_my_pipeline', 'search_my_vault', 'draft_proposal', 'draft_proposal_section', 'find_my_documents', 'create_document']);

const TOOL_LABELS: Record<string, string> = {
  get_expiring_contracts: 'Expiring contracts (USASpending via Mindy recompete data)',
  search_past_contracts: 'Past contract awards (USASpending)',
  get_buying_offices: 'Buying offices (USASpending)',
  get_pricing_intel: 'Labor rates (GSA CALC)',
  derive_company_keywords: 'Company keywords',
  get_vehicle_spend_mix: 'Contract vehicle spend mix (USASpending)',
  get_sblo_contact: 'Company contacts (SAM / USASpending)',
  find_opportunities: 'Opportunities: open, coming back, coming soon',
  search_sam_opportunities: 'Open solicitations (SAM.gov)',
  get_agency_forecasts: 'Agency forecasts',
  get_agency_intel: 'Agency priorities and pain points',
  lookup_solicitation: 'Solicitation record (SAM.gov)',
  get_solicitation_incumbent: 'Likely incumbent (USASpending)',
  get_award_detail: 'Award detail (USASpending)',
  search_federal_contacts: 'Federal contacts (SAM.gov notices)',
  lookup_federal_osbp: 'Agency small business office',
  get_contractor_profile: 'Contractor profile',
  get_contractor_award_history: 'Contractor award history (USASpending)',
  get_my_pipeline: 'Your pursuits',
  search_my_vault: 'Your Vault records',
  find_my_documents: 'Your saved documents (Vault)',
  create_document: 'Document Mindy saved to your Vault',
  search_web: 'Open web (Serper)',
  read_web_page: 'Open web page',
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** A short, plain label: letters, digits, basic punctuation; no markup, no instruction-length prose. */
export function safeLabel(s: unknown, max = 80): string {
  const plain = String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^A-Za-z0-9 .,&'()\-/#:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function statusFor(execStatus: string, parsed: Record<string, unknown> | null, rendered?: RenderedRecords | null): SourceStatus {
  if (execStatus === 'failed') return 'failed';
  if (execStatus !== 'success') return 'refused';
  if (!parsed) return 'ok';
  const meta = (parsed._meta && typeof parsed._meta === 'object' ? parsed._meta : {}) as Record<string, unknown>;
  if (parsed.ok === false || parsed.state === 'unavailable' || meta.degraded === true || meta.result_state === 'unavailable') return 'degraded';
  if (rendered && rendered.shown === 0) return 'empty';
  if (meta.result_state === 'none_found' || meta.grounded === false) return 'empty';
  if (rendered && !rendered.exhaustive) return 'truncated';
  return 'ok';
}

function asOfFrom(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  const meta = (parsed._meta && typeof parsed._meta === 'object' ? parsed._meta : {}) as Record<string, unknown>;
  const win = (meta.window && typeof meta.window === 'object' ? meta.window : {}) as Record<string, unknown>;
  const cand = meta.as_of ?? win.as_of ?? meta.data_as_of ?? parsed.as_of ?? null;
  return typeof cand === 'string' && cand ? cand.slice(0, 32) : null;
}

const KEY_FIELDS = ['piid', 'notice_id', 'solicitation_number', 'award_id', 'uei', 'office_code', 'contract_id', 'id'];

/** Records in an unrendered result that the user could name in a follow-up (no numbering: the model wrote that list). */
function keyedItems(parsed: unknown, limit = LEDGER_MAX_ITEMS): LedgerItem[] {
  const out: LedgerItem[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (out.length >= limit || depth > 4 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    const keyField = KEY_FIELDS.find((f) => typeof o[f] === 'string' && KEY_RE.test(String(o[f])));
    if (keyField) {
      const key = String(o[keyField]);
      if (!seen.has(key)) {
        seen.add(key);
        const name = o.title ?? o.incumbent_name ?? o.recipient_name ?? o.name ?? o.office ?? '';
        out.push({ key, label: safeLabel(name ? titleCase(String(name)) : keyField) });
      }
    }
    for (const [k, x] of Object.entries(o)) if (k !== '_meta' && x && typeof x === 'object') visit(x, depth + 1);
  };
  visit(parsed, 0);
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const docKind = (k: unknown): VaultDocKind => (k === 'generated' ? 'generated' : k === 'reference' ? 'reference' : 'company');

/**
 * Vault documents named by find_my_documents (one document read, or several listed) or saved by
 * create_document (one item for the saved pair: the Word file's id, which create_document resolves to the
 * PDF too). Ids are carried so a later "revise that" has the real document, never an invented one.
 */
function vaultDocItems(tool: string, parsed: Record<string, unknown> | null): LedgerItem[] | null {
  if (!parsed) return null;
  if (tool === 'find_my_documents') {
    const one = parsed.document as Record<string, unknown> | undefined;
    const list = one ? [one] : Array.isArray(parsed.items) ? (parsed.items as Array<Record<string, unknown>>) : [];
    const valid = list.filter((d) => d && typeof d.document_id === 'string' && UUID_RE.test(d.document_id));
    return collapseGeneratedPairs(valid)
      .slice(0, LEDGER_MAX_ITEMS)
      .map((d) => ({ key: String(d.document_id), label: safeLabel(d.file_name), doc: { kind: docKind(d.kind) } }));
  }
  if (tool === 'create_document') {
    if (parsed.ok !== true || !Array.isArray(parsed.files)) return [];
    const files = (parsed.files as Array<Record<string, unknown>>).filter((f) => f && typeof f.document_id === 'string' && UUID_RE.test(f.document_id));
    const main = files.find((f) => f.format === 'docx') ?? files[0];
    if (!main) return [];
    const v = Number(parsed.version ?? main.version);
    return [{ key: String(main.document_id), label: safeLabel(main.file_name ?? parsed.title), doc: { kind: 'generated', ...(Number.isInteger(v) && v > 0 ? { version: v } : {}) } }];
  }
  return null;
}

/** Two files saved this close together with the same name are one generated document's Word + PDF pair. */
const PAIR_WINDOW_MS = 5 * 60_000;
const baseFileName = (f: unknown) => String(f ?? '').replace(/\.(pdf|docx)$/i, '').trim().toLowerCase();

/**
 * create_document saves every generated document as a Word + PDF pair (same name, same version, saved together).
 * find_my_documents lists both files, so "revise that" saw two documents and asked "which one?" (Agent 4 live
 * test, 2026-11-17). A generated pair is ONE document: keep the Word file's id (create_document resolves the PDF
 * from it). Only generated files with the same base name saved within PAIR_WINDOW_MS collapse; different titles,
 * versions saved at different times, and an upload next to a generated file stay separate (ambiguous).
 */
function collapseGeneratedPairs(docs: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const used = new Set<number>();
  docs.forEach((d, i) => {
    if (used.has(i)) return;
    if (d.kind !== 'generated') { out.push(d); return; }
    const t = Date.parse(String(d.saved ?? ''));
    const j = docs.findIndex((e, k) => k !== i && !used.has(k) && e.kind === 'generated'
      && baseFileName(e.file_name) === baseFileName(d.file_name)
      && /\.pdf$/i.test(String(e.file_name)) !== /\.pdf$/i.test(String(d.file_name))
      && Number.isFinite(t) && Number.isFinite(Date.parse(String(e.saved ?? '')))
      && Math.abs(Date.parse(String(e.saved)) - t) <= PAIR_WINDOW_MS);
    if (j < 0) { out.push(d); return; }
    used.add(i); used.add(j);
    out.push(/\.docx$/i.test(String(d.file_name)) ? d : docs[j]);
  });
  return out;
}

/** Records the user saw in a rendered list, numbered exactly as displayed. */
function renderedItems(tool: string, parsed: Record<string, unknown> | null, r: RenderedRecords): LedgerItem[] {
  const labels = new Map<string, string>();
  if (tool === EXPIRING_TOOL && parsed) {
    try {
      for (const rec of collectExpiringRecords(parsed) as Array<Record<string, unknown>>) {
        const key = String(rec.piid ?? '');
        if (key) labels.set(key, safeLabel([rec.incumbent_name, rec.awarding_agency].filter(Boolean).map((x) => titleCase(String(x))).join(' · ')));
      }
    } catch { /* labels are optional */ }
  }
  const start = Math.max(1, r.from || 1);
  return (r.ids || []).slice(0, LEDGER_MAX_ITEMS)
    .filter((id) => KEY_RE.test(String(id)))
    .map((id, i) => ({ n: start + i, key: String(id), label: labels.get(String(id)) ?? '' }));
}

export function sourceFromToolResult(p: {
  tool: string;
  toolCallId: string;
  status: string;
  content: string;
  rendered?: RenderedRecords | null;
  argsRedacted?: Record<string, unknown> | null;
  owner: { email: string; scope: string };
  retrievedAt: string;
}): ContextSource {
  let parsed: Record<string, unknown> | null = null;
  try { const j = JSON.parse(p.content); if (j && typeof j === 'object' && !Array.isArray(j)) parsed = j as Record<string, unknown>; } catch { /* not JSON */ }
  const isPrivate = PRIVATE_SOURCE_TOOLS.has(p.tool);
  const status = statusFor(p.status, parsed, p.rendered);
  const items = status === 'failed' || status === 'refused' || status === 'degraded'
    ? []
    : p.rendered ? renderedItems(p.tool, parsed, p.rendered) : (vaultDocItems(p.tool, parsed) ?? keyedItems(parsed));
  const codeQuery = !isPrivate && p.argsRedacted ? sanitizeQuery(p.argsRedacted) : {};
  const query = Object.keys(codeQuery).length ? codeQuery : null;
  return {
    id: `src:${p.tool}:${p.toolCallId}`.slice(0, 96),
    kind: isPrivate ? 'account_record' : 'federal_record',
    trust: isPrivate ? 'user_supplied' : 'verified_record',
    owner: isPrivate ? p.owner : null,
    label: toolLabel(p.tool),
    tool: p.tool,
    content: p.content,
    status,
    ...(p.rendered ? { shown: p.rendered.shown, total: p.rendered.total, rendered: true } : {}),
    retrievedAt: p.retrievedAt,
    asOf: asOfFrom(parsed),
    scope: 'turn',
    items,
    query,
  };
}

/** The short stub that replaces a rendered tool's JSON in the answer request (A8). */
export function renderedStub(s: ContextSource): string {
  let meta: Record<string, unknown> = {};
  try {
    const j = JSON.parse(s.content) as Record<string, unknown>;
    const m = (j?._meta && typeof j._meta === 'object' ? j._meta : {}) as Record<string, unknown>;
    meta = Object.fromEntries(['result_state', 'ignored_args', 'lag_note'].filter((k) => m[k] !== undefined).map((k) => [k, m[k]]));
  } catch { /* none */ }
  return JSON.stringify({
    ok: true, rendered_as_verified_list: true, source_id: s.id, shown: s.shown, total: s.total,
    note: 'These records are shown to the user in the VERIFIED RECORD LIST; read them there.',
    ...(Object.keys(meta).length ? { _meta: meta } : {}),
  });
}

/** This turn's sources that actually returned data, as chat citations (the existing CitedSource shape). */
export function citationsFromSources(sources: ContextSource[]): Array<{ title: string; url: string | null; doc_type: string; source_path: string; document_id: null }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; url: string | null; doc_type: string; source_path: string; document_id: null }> = [];
  for (const s of sources) {
    if (s.status !== 'ok' && s.status !== 'truncated' && s.status !== 'empty') continue;
    const dedupe = `${s.tool}|${s.label}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      title: s.asOf ? `${s.label} · as of ${s.asOf.slice(0, 10)}` : s.label,
      url: s.ref?.url ?? null,
      doc_type: s.kind === 'account_record' ? 'mindy_account_data' : 'mindy_federal_data',
      source_path: s.id,
      document_id: null,
    });
  }
  return out;
}

export function ledgerFromSources(sources: ContextSource[]): SourceLedger {
  const entries: LedgerEntry[] = sources.slice(0, LEDGER_MAX_ENTRIES).map((s) => ({
      id: s.id, kind: s.kind, ...(s.tool ? { tool: s.tool } : {}), label: s.label, status: s.status,
      asOf: s.asOf ?? null, retrievedAt: s.retrievedAt,
      ...(s.shown != null ? { shown: s.shown, total: s.total } : {}),
      ...(s.owner ? { private: true as const, scope: s.owner.scope } : {}),
      ...(s.query ? { query: s.query } : {}),
      ...(s.items?.length ? { items: s.items.slice(0, LEDGER_MAX_ITEMS) } : {}),
  }));
  return signLedger(entries);
}

/** Wrap entries as a ledger, signed when a key is available. */
export function signLedger(entries: LedgerEntry[]): SourceLedger {
  const key = ledgerKey();
  return key ? { v: 1, entries, sig: ledgerSig(entries, key) } : { v: 1, entries };
}

/**
 * Validate a ledger the CLIENT sent back. It is untrusted: only well-formed entries survive, keys must be
 * identifier-shaped, labels are reduced to plain short text, and a private entry produced in a different
 * acting scope is dropped. Item labels are discarded (only identifier keys survive). The ledger is a set of
 * REFERENCES, never facts.
 */
export function parseLedger(raw: unknown, currentScope: string): SourceLedger | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { v?: unknown; entries?: unknown; sig?: unknown };
  if (r.v !== 1 || !Array.isArray(r.entries)) return null;
  // Only a ledger this server emitted, unchanged, is used. A forged or edited one is ignored entirely.
  if (!verifyLedgerSig(r.entries, r.sig)) return null;
  const entries: LedgerEntry[] = [];
  for (const e of r.entries.slice(0, LEDGER_MAX_ENTRIES)) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    const id = typeof x.id === 'string' && /^src:[A-Za-z0-9_]{1,64}:[A-Za-z0-9_.:-]{1,64}$/.test(x.id) ? x.id : null;
    if (!id) continue;
    const isPrivate = x.private === true || (typeof x.tool === 'string' && PRIVATE_SOURCE_TOOLS.has(x.tool));
    if (isPrivate && x.scope !== currentScope) continue;
    const items: LedgerItem[] = Array.isArray(x.items)
      ? (x.items as unknown[]).slice(0, LEDGER_MAX_ITEMS).flatMap((it) => {
        if (!it || typeof it !== 'object') return [];
        const i = it as Record<string, unknown>;
        if (typeof i.key !== 'string' || !KEY_RE.test(i.key)) return [];
        const n = typeof i.n === 'number' && Number.isInteger(i.n) && i.n > 0 && i.n < 10_000 ? i.n : undefined;
        // The label is prose the server cannot verify, so it is not carried back into a prompt: the key is
        // the reference, and the model looks the record up before saying anything about it.
        const d = i.doc && typeof i.doc === 'object' ? i.doc as Record<string, unknown> : null;
        const doc = d && ['company', 'reference', 'generated'].includes(String(d.kind))
          ? { kind: d.kind as VaultDocKind, ...(typeof d.version === 'number' && Number.isInteger(d.version) && d.version > 0 && d.version < 10_000 ? { version: d.version } : {}) }
          : undefined;
        return [{ ...(n ? { n } : {}), key: i.key, label: '', ...(doc ? { doc } : {}) }];
      })
      : [];
    const status = ['ok', 'empty', 'degraded', 'failed', 'refused', 'truncated'].includes(String(x.status)) ? String(x.status) as SourceStatus : 'ok';
    const tool = typeof x.tool === 'string' && /^[a-z0-9_]{1,64}$/.test(x.tool) ? x.tool : undefined;
    const query = x.query && typeof x.query === 'object' && !Array.isArray(x.query) && JSON.stringify(x.query).length <= 400
      ? sanitizeQuery(x.query as Record<string, unknown>) : undefined;
    entries.push({
      id, kind: isPrivate ? 'account_record' : 'federal_record', ...(tool ? { tool } : {}),
      label: tool ? toolLabel(tool) : safeLabel(x.label, 60), status,
      asOf: typeof x.asOf === 'string' ? safeLabel(x.asOf, 32) : null,
      retrievedAt: typeof x.retrievedAt === 'string' ? safeLabel(x.retrievedAt, 32) : '',
      ...(isPrivate ? { private: true as const, scope: currentScope } : {}),
      ...(query && Object.keys(query).length ? { query } : {}),
      ...(items.length ? { items } : {}),
    });
  }
  return entries.length ? { v: 1, entries } : null;
}

/**
 * Search arguments kept for "the next 20": code-like values only (NAICS/PSC codes, state codes, dates, ids,
 * numbers). Free text (a keyword, an agency name typed by the user) is dropped: the ledger feeds a system
 * note, and user words must never gain system authority there (review MED).
 */
const CODE_VALUE_RE = /^[A-Za-z0-9.:\/-]{1,24}$/;
function codeValue(v: unknown): string | number | boolean | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const parts = v.split(',').map((x) => x.trim()).filter(Boolean);
    return parts.length && parts.length <= 10 && parts.every((x) => CODE_VALUE_RE.test(x) && /\d/.test(x) || /^[A-Z]{2}$/.test(x)) ? parts.join(',') : null;
  }
  return null;
}
function sanitizeQuery(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q).slice(0, 12)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k)) continue;
    if (Array.isArray(v)) {
      const vals = v.slice(0, 10).map(codeValue);
      if (vals.length && vals.every((x) => x !== null)) out[k] = vals;
    } else {
      const c = codeValue(v);
      if (c !== null) out[k] = c;
    }
  }
  return out;
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/** Numbers the user referred to: "#12", "number 12", "record 12", "the 12th one", "the third contract". */
export function referencedNumbers(message: string): number[] {
  const out = new Set<number>();
  const m = String(message || '');
  for (const x of m.matchAll(/#\s?(\d{1,4})\b/g)) out.add(Number(x[1]));
  for (const x of m.matchAll(/\b(?:number|no\.|record|item|row|line|result|contract)\s+(\d{1,4})\b/gi)) out.add(Number(x[1]));
  for (const x of m.matchAll(/\b(\d{1,4})(?:st|nd|rd|th)\s+(?:one|record|contract|item|row|result|award|opportunity|office)\b/gi)) out.add(Number(x[1]));
  for (const x of m.matchAll(/\bthe\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:one|record|contract|item|row|result|award|opportunity|office)\b/gi)) out.add(ORDINALS[x[1].toLowerCase()]);
  return [...out].filter((n) => n > 0);
}

export interface ResolvedReference { n: number; entry: LedgerEntry; item: LedgerItem }

/**
 * Resolve each number the user named against the most recent ledger that SHOWED that number. Newest first.
 * A number no shown list contains is returned as unresolved: never guessed.
 */
export function resolveReferences(message: string, ledgersNewestFirst: SourceLedger[]): { resolved: ResolvedReference[]; unresolved: number[] } {
  const resolved: ResolvedReference[] = [];
  const unresolved: number[] = [];
  for (const n of referencedNumbers(message)) {
    let hit: ResolvedReference | null = null;
    outer: for (const l of ledgersNewestFirst) {
      for (const entry of l.entries) {
        const item = entry.items?.find((it) => it.n === n);
        if (item) { hit = { n, entry, item }; break outer; }
      }
    }
    if (hit) resolved.push(hit); else unresolved.push(n);
  }
  return { resolved, unresolved };
}

/**
 * System notes for the planner and the answer: the resolved references (exact ids), and a compact list of the
 * earlier sources. References only; the model must re-read a record with a tool before stating new facts.
 */
export function ledgerNotes(message: string, ledgersNewestFirst: SourceLedger[]): string[] {
  if (!ledgersNewestFirst.length) return [];
  const notes: string[] = [];
  const { resolved, unresolved } = resolveReferences(message, ledgersNewestFirst);
  if (resolved.length) {
    notes.push('REFERENCE RESOLVED (from the numbered list the user saw earlier in this conversation): '
      + resolved.map((r) => `#${r.n} = ${r.item.key}${r.item.label ? ` (${r.item.label})` : ''}, from "${r.entry.label}" [${r.entry.id}]`).join('; ')
      + '. Use exactly this identifier; never substitute another record. These are references, not facts: look the record up with a tool before stating anything about it beyond its identifier.');
  }
  if (unresolved.length) {
    notes.push(`REFERENCE NOT FOUND: the user referred to ${unresolved.map((n) => `#${n}`).join(', ')}, but no list shown earlier in this conversation has that number. Do not guess a record: say which numbers the earlier list covers, or ask which record they mean.`);
  }
  const lines: string[] = [];
  for (const l of ledgersNewestFirst.slice(0, 3)) {
    for (const e of l.entries) {
      const range = e.items?.some((i) => i.n) ? ` items ${e.items!.filter((i) => i.n).map((i) => i.n).filter((n, i, a) => i === 0 || i === a.length - 1).join('–')}` : '';
      const keys = e.items?.length ? `: ${e.items.slice(0, 20).map((i) => (i.n ? `${i.n}=${i.key}` : i.key)).join(', ')}${e.items.length > 20 ? ', …' : ''}` : '';
      const q = e.query ? ` · search ${JSON.stringify(e.query)}` : '';
      lines.push(`- [${e.id}] ${e.label} (${e.status}${e.asOf ? `, as of ${e.asOf}` : ''})${range}${q}${keys}`);
    }
  }
  if (lines.length) {
    notes.push('EARLIER SOURCES in this conversation (identifiers only, not facts; to continue a list, repeat its search with the next display offset):\n' + lines.slice(0, 24).join('\n'));
  }
  return notes;
}

/**
 * A request to revise / update / make a new version of a document ("revise that capability statement, keep
 * the original"). Deliberately narrow: an editing verb AND a document reference.
 */
export function isReviseIntent(message: string): boolean {
  const m = String(message || '').toLowerCase();
  const verb = /\b(revise|revision|rework|rewrite|redo|update|edit|tighten|improve|polish|refresh|new version|another version|next version)\b/.test(m);
  const doc = /\b(it|that|this|the (?:doc|document|file|statement|report|brief|deliverable|pdf|word file|version)|capability statement|document|doc)\b/.test(m);
  return verb && doc;
}

export interface RevisionTarget { id: string; kind: VaultDocKind; version?: number }

/**
 * The single Vault document a revise request refers to: the documents in the NEWEST ledger that carries any.
 * Exactly one → that document. None, or several (the user must say which) → null, and find_my_documents
 * stays the right call. Never guessed.
 */
export function resolveRevisionTarget(message: string, ledgersNewestFirst: SourceLedger[]): RevisionTarget | null {
  if (!isReviseIntent(message)) return null;
  for (const l of ledgersNewestFirst) {
    const docs = l.entries.flatMap((e) => (e.items ?? []).filter((i) => i.doc && UUID_RE.test(i.key)));
    if (!docs.length) continue;
    const unique = [...new Map(docs.map((d) => [d.key, d])).values()];
    if (unique.length !== 1) return null;
    const d = unique[0];
    return { id: d.key, kind: d.doc!.kind, ...(d.doc!.version ? { version: d.doc!.version } : {}) };
  }
  return null;
}
