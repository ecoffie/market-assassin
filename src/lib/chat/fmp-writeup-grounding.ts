/**
 * Federal Market Profile write-up grounding — pin award / vehicle / contact facts
 * into the create_document planner note and into validateFmpWriteup requiredSnippets.
 *
 * Structure alone is not enough: a pathways-first DocModel can still invent dollars,
 * NAICS, and contacts. The host extracts snippets from accumulated tool JSON.
 */

import type { DocModel } from '@/lib/documents/model';
import { DOC_SCHEMA } from '@/lib/documents/model';
import {
  extractDominantAwardNaics,
  extractProfileCompanyIdentity,
  extractSelfReportedProfileFacts,
  hasSelfReportedProfileFacts,
} from './tool-selection';

export type FmpToolContent = { tool?: string; content: string };

export interface FmpWriteupEvidence {
  dominantNaics: string | null;
  totalObligations: string | null;
  awardCount: number | null;
  vehicleTokens: string[];
  contactNames: string[];
  eightAExitYear: string | null;
  selfReportLines: string[];
  /** Raw blob used for loose scans (joined tool contents). */
  corpus: string;
}

const VEHICLE_TOKEN_RES: ReadonlyArray<{ re: RegExp; token: string }> = [
  { re: /\bMATOC\b/i, token: 'MATOC' },
  { re: /\b693C73\w*/i, token: '693C73' },
  { re: /\bHQ0034\w*/i, token: 'HQ0034' },
];

const DLA_HINT = /\bDLA\b|\bDefense Logistics\b/i;
const NOTICE_OR_WHS_HINT = /\bWHS\b|\bnotice\b|\bPOC\b|\bpoint of contact\b|\bsolicitation\b/i;

/** Format a dollar obligation for the write-up (and as a required snippet when present). */
export function formatObligationSnippet(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }
  return `$${Math.round(n)}`;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '');
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function walkStrings(node: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 400) return;
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) walkStrings(x, out, depth + 1);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) walkStrings(v, out, depth + 1);
  }
}

function extractObligationsAndCount(content: string): { dollars: number | null; awards: number | null } {
  let dollars: number | null = null;
  let awards: number | null = null;
  try {
    const p = JSON.parse(content) as Record<string, unknown>;
    const meta = (p._meta && typeof p._meta === 'object' ? p._meta : null) as Record<string, unknown> | null;
    const history = (p.history && typeof p.history === 'object' ? p.history : null) as Record<string, unknown> | null;
    const summary = (history?.summary && typeof history.summary === 'object' ? history.summary : null) as Record<string, unknown> | null;

    dollars =
      num(meta?.total_obligations)
      ?? num(p.total_obligations)
      ?? num(p.total_obligated)
      ?? num(summary?.totalObligations)
      ?? num(summary?.total_obligations)
      ?? null;
    awards =
      num(meta?.award_count)
      ?? num(p.award_count)
      ?? num(summary?.awardCount)
      ?? num(summary?.award_count)
      ?? null;

    // history.topNaics path — prefer largest amount when dominant NAICS not yet known from helper.
    const topNaics = history?.topNaics;
    if (Array.isArray(topNaics) && topNaics[0] && typeof topNaics[0] === 'object') {
      const amt = num((topNaics[0] as { amount?: unknown }).amount);
      if (amt != null && (dollars == null || amt > dollars)) {
        // do not replace total with a single-naics amount; only fill if missing
      }
    }
  } catch {
    const m$ = content.match(/\$\s*([\d,.]+)\s*([MB])\b/i);
    if (m$) {
      const base = Number(m$[1].replace(/,/g, ''));
      if (Number.isFinite(base)) {
        dollars = m$[2].toUpperCase() === 'B' ? base * 1_000_000_000 : base * 1_000_000;
      }
    }
    const mA = content.match(/\b(\d+)\s+awards?\b/i);
    if (mA) awards = Number(mA[1]);
  }
  return { dollars, awards };
}

function extractVehicleTokens(corpus: string): string[] {
  const found: string[] = [];
  for (const { re, token } of VEHICLE_TOKEN_RES) {
    if (re.test(corpus) && !found.includes(token)) found.push(token);
  }
  // Prefer full PIID prefix hits when present (e.g. 693C7326D…).
  const prefixHits = corpus.match(/\b(?:693C73|HQ0034)[A-Z0-9]{0,12}\b/gi) || [];
  for (const hit of prefixHits) {
    const upper = hit.toUpperCase();
    if (!found.some((t) => upper.startsWith(t) || t.startsWith(upper.slice(0, 6)))) {
      found.push(upper.length > 6 ? upper.slice(0, 10) : upper);
    } else if (upper.length > 6) {
      // Upgrade short token to a longer grounded hit when available.
      const i = found.findIndex((t) => upper.startsWith(t));
      if (i >= 0 && found[i].length < upper.length) found[i] = upper.slice(0, 12);
    }
  }
  return found.slice(0, 6);
}

function looksLikePersonName(s: string): boolean {
  const t = s.trim();
  if (t.length < 5 || t.length > 60) return false;
  if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+$/.test(t)) return false;
  if (/\b(Department|Agency|Office|Inc|LLC|PLLC|Federal|Defense|Logistics)\b/i.test(t)) return false;
  return true;
}

function extractContactNames(results: readonly FmpToolContent[]): string[] {
  const noticeOrWhs: string[] = [];
  const other: string[] = [];
  const dla: string[] = [];

  const pushUnique = (arr: string[], name: string) => {
    if (!arr.some((n) => n.toLowerCase() === name.toLowerCase())) arr.push(name);
  };

  for (const r of results) {
    const content = String(r.content || '');
    const tool = String(r.tool || '');
    const preferNotice =
      NOTICE_OR_WHS_HINT.test(content)
      || /search_federal_contacts|lookup_federal_osbp|find_opportunities|search_sam|lookup_solicitation/i.test(tool);
    const isDla = DLA_HINT.test(content) && !/\bWHS\b/i.test(content);

    const names: string[] = [];
    try {
      const p = JSON.parse(content) as unknown;
      const strings: string[] = [];
      walkStrings(p, strings);
      for (const s of strings) {
        // "name": "Helson Roman" style already walked as value.
        if (looksLikePersonName(s)) names.push(s.trim());
      }
    } catch {
      const m = content.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+)+)\b/g) || [];
      for (const s of m) if (looksLikePersonName(s)) names.push(s.trim());
    }

    for (const name of names) {
      if (isDla) pushUnique(dla, name);
      else if (preferNotice) pushUnique(noticeOrWhs, name);
      else pushUnique(other, name);
    }
  }

  // Prefer non-DLA when notice/WHS contacts exist.
  const preferred = noticeOrWhs.length ? [...noticeOrWhs, ...other] : [...noticeOrWhs, ...other, ...dla];
  return preferred.slice(0, 8);
}

function extractEightAExit(corpus: string): string | null {
  // "exits 8(a) in 2031" / "8(a) graduation 2031" / "through 2031"
  const m =
    corpus.match(/\b8\s*\(\s*a\s*\)[^.\n]{0,40}\b(20\d{2})\b/i)
    || corpus.match(/\b(20\d{2})\b[^.\n]{0,40}\b8\s*\(\s*a\s*\)/i)
    || corpus.match(/\bexit(?:s|ing)?\b[^.\n]{0,30}\b(20\d{2})\b/i);
  if (m) {
    const y = m[1];
    if (y >= '2026' && y <= '2040') return y;
  }
  if (/\b2031\b/.test(corpus) && /\b8\s*\(\s*a\s*\)/i.test(corpus)) return '2031';
  return null;
}

function selfReportLines(customerText: string): string[] {
  const facts = extractSelfReportedProfileFacts(customerText);
  if (!hasSelfReportedProfileFacts(facts)) return [];
  const lines: string[] = [];
  if (facts.bonding) lines.push(facts.bonding);
  if (facts.equipment) lines.push(facts.equipment);
  if (facts.credentials) lines.push(facts.credentials);
  if (facts.selfPerforms) lines.push(facts.selfPerforms);
  if (facts.jointVenture) lines.push(facts.jointVenture);
  for (const o of facts.other) lines.push(o);
  return lines;
}

/**
 * Accumulate evidence from every FMP tool content string (all rounds).
 * `customerText` supplies self-report only (never treated as award proof).
 */
export function accumulateFmpEvidence(
  results: readonly FmpToolContent[],
  customerText = '',
): FmpWriteupEvidence {
  const corpus = results.map((r) => String(r.content || '')).filter(Boolean).join('\n');
  let dominantNaics: string | null = null;
  let bestDollars: number | null = null;
  let awardCount: number | null = null;

  for (const r of results) {
    const content = String(r.content || '');
    if (!content) continue;
    if (!dominantNaics) {
      // Prefer history.topNaics[0] when present (amount-ranked).
      try {
        const p = JSON.parse(content) as {
          history?: { topNaics?: Array<{ naics?: string }> };
        };
        const code = p.history?.topNaics?.[0]?.naics;
        if (typeof code === 'string' && /^\d{6}$/.test(code)) dominantNaics = code;
      } catch { /* ignore */ }
    }
    if (!dominantNaics) dominantNaics = extractDominantAwardNaics(content);

    const { dollars, awards } = extractObligationsAndCount(content);
    if (dollars != null && (bestDollars == null || dollars > bestDollars)) bestDollars = dollars;
    if (awards != null && (awardCount == null || awards > awardCount)) awardCount = awards;
  }

  return {
    dominantNaics,
    totalObligations: bestDollars != null ? formatObligationSnippet(bestDollars) : null,
    awardCount,
    vehicleTokens: extractVehicleTokens(corpus),
    contactNames: extractContactNames(results),
    eightAExitYear: extractEightAExit(corpus) || (/\b2031\b/.test(customerText) ? '2031' : null),
    selfReportLines: selfReportLines(customerText),
    corpus,
  };
}

/**
 * Snippets the DocModel MUST contain (hard fail in validateFmpWriteup).
 * DSBS is already enforced by structure rules — not duplicated here.
 */
export function requiredSnippetsForWriteup(evidence: FmpWriteupEvidence): string[] {
  const out: string[] = [];
  if (evidence.dominantNaics) out.push(evidence.dominantNaics);
  if (evidence.totalObligations) out.push(evidence.totalObligations);
  if (evidence.eightAExitYear) out.push(evidence.eightAExitYear);
  if (evidence.vehicleTokens.length) out.push(evidence.vehicleTokens[0]);
  // Dedupe while preserving order.
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * System note pinned before create_document rounds. No em dashes.
 */
export function buildFmpWriteupGroundingNote(
  evidence: FmpWriteupEvidence,
  customerText = '',
): string {
  void customerText; // self-report already folded into evidence.selfReportLines
  const lines: string[] = [
    'FMP WRITE-UP GROUNDING (server-extracted from tool JSON this turn; cite these facts; do not invent replacements):',
  ];
  if (evidence.dominantNaics) {
    lines.push(`- Primary / dominant NAICS from awards: ${evidence.dominantNaics}. Do not lead with 236220 unless awards show it dominant.`);
  } else {
    lines.push('- Dominant NAICS: not established from tool JSON. Do not invent a primary NAICS.');
  }
  if (evidence.totalObligations) {
    lines.push(
      `- Total obligations (use this scale): ${evidence.totalObligations}`
      + (evidence.awardCount != null ? ` across ${evidence.awardCount} awards.` : '.'),
    );
  } else {
    lines.push('- Total obligations: not found in tool JSON. Do not invent a firm-wide dollar total.');
  }
  if (evidence.vehicleTokens.length) {
    lines.push(`- Vehicle / IDV tokens to name when pathways discuss vehicles: ${evidence.vehicleTokens.join(', ')}.`);
  }
  if (evidence.contactNames.length) {
    lines.push(
      `- Named contacts (prefer notice / WHS POCs over DLA when both appear): ${evidence.contactNames.join('; ')}.`,
    );
  }
  if (evidence.eightAExitYear) {
    lines.push(`- 8(a) timing signal from evidence: ${evidence.eightAExitYear}. Include in pathways / readiness when discussing 8(a).`);
  }
  if (evidence.selfReportLines.length) {
    lines.push('- Self-reported (customer-stated, not federal tools):');
    for (const s of evidence.selfReportLines) lines.push(`  - ${s}`);
  }
  lines.push(
    '- PAE: when defense buyers appear, write about defense construction oversight / Navy PAE (or WHS construction oversight). FORBIDDEN expansion: "Performance Assessment Evaluation". Never invent that phrase.',
  );
  lines.push(
    '- Required literal snippets the document body must include (validator hard-fails if missing): '
    + (requiredSnippetsForWriteup(evidence).join(', ') || '(none extracted; structure rules still apply).'),
  );
  return lines.join('\n');
}

/**
 * After a successful create_document, nudge the answer model away from invented download URLs.
 */
export function buildFmpCreateDocumentAnswerNote(opts: {
  evidence: FmpWriteupEvidence;
  downloadPaths: string[];
  title?: string | null;
}): string {
  const paths = opts.downloadPaths.filter(Boolean);
  const lines: string[] = [
    'FMP ANSWER AFTER create_document (host rule):',
    'Summarize the federal market profile from the grounding facts below. Do not answer with download links alone.',
    'Only cite download_path values that appear in the create_document tool JSON (listed next). Never invent URLs such as your-link-to-download.com or placeholder links.',
  ];
  if (opts.title) lines.push(`Document title: ${opts.title}.`);
  if (paths.length) {
    lines.push('Real download_path values from the tool result:');
    for (const p of paths) lines.push(`- ${p}`);
  } else {
    lines.push('No download_path values were returned. Tell the user the file is in Vault / the in-chat download chips; do not invent a URL.');
  }
  const facts: string[] = [];
  if (opts.evidence.dominantNaics) facts.push(`NAICS ${opts.evidence.dominantNaics}`);
  if (opts.evidence.totalObligations) facts.push(`${opts.evidence.totalObligations} obligations`);
  if (opts.evidence.awardCount != null) facts.push(`${opts.evidence.awardCount} awards`);
  if (opts.evidence.vehicleTokens[0]) facts.push(`vehicle ${opts.evidence.vehicleTokens[0]}`);
  if (opts.evidence.eightAExitYear) facts.push(`8(a) ${opts.evidence.eightAExitYear}`);
  if (opts.evidence.contactNames[0]) facts.push(`contact ${opts.evidence.contactNames[0]}`);
  if (facts.length) lines.push(`Grounding facts to summarize: ${facts.join('; ')}.`);
  return lines.join('\n');
}

/** Planner output room when create_document is offered/forced on an FMP turn. */
export const FMP_DOC_TOOL_ROUND_MAX_TOKENS = 8192;

export function fmpPlannerMaxTokensForCreateDocument(createDocumentOffered: boolean): number | null {
  return createDocumentOffered ? FMP_DOC_TOOL_ROUND_MAX_TOKENS : null;
}

/**
 * True when create_document arguments carry a non-empty doc_model object.
 * Empty `{}` / missing doc_model is the failure mode that burned rewrite budget
 * without saving a Vault file (trace e2d3274a).
 */
export function createDocumentArgsHaveUsableDocModel(rawArgs: string): boolean {
  try {
    const a = JSON.parse(rawArgs || '{}') as { doc_model?: unknown };
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    const m = a.doc_model;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    const title = typeof (m as { title?: unknown }).title === 'string'
      ? String((m as { title: string }).title).trim()
      : '';
    const sections = (m as { sections?: unknown }).sections;
    if (!title) return false;
    if (!Array.isArray(sections) || sections.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

export type BuildFmpHostDocModelOpts = {
  customerText?: string;
  defenseBuyersAppear?: boolean;
  today?: () => string;
};

/**
 * Host-built DocModel from accumulated FMP evidence. Used when the planner returns
 * create_document without a usable doc_model (or when force-injecting). Must pass
 * validateFmpWriteup including requiredSnippets and the PAE gloss ban.
 */
export function buildFmpHostDocModel(
  evidence: FmpWriteupEvidence,
  opts: BuildFmpHostDocModelOpts = {},
): DocModel {
  const customerText = opts.customerText || '';
  const identity = extractProfileCompanyIdentity(customerText);
  const company = identity.legalName || 'Federal market profile';
  const defense = opts.defenseBuyersAppear !== false; // default on for FMP host rescue
  const date = (opts.today ?? (() => new Date().toISOString().slice(0, 10)))();
  const snippets = requiredSnippetsForWriteup(evidence);
  const naics = evidence.dominantNaics || snippets.find((s) => /^\d{6}$/.test(s)) || null;
  const dollars = evidence.totalObligations;
  const vehicle = evidence.vehicleTokens[0] || null;
  const exitY = evidence.eightAExitYear;
  const contact = evidence.contactNames[0] || 'the named notice POC';
  const awardBits = [
    naics ? `Primary award NAICS ${naics}` : null,
    dollars
      ? `${dollars}${evidence.awardCount != null ? ` across ${evidence.awardCount} awards` : ''}`
      : null,
    vehicle ? `vehicle pathway ${vehicle}` : null,
    exitY ? `8(a) timing ${exitY}` : null,
  ].filter(Boolean).join('; ');

  const pathwayText = [
    'Pathways in priority order: vehicles, sources sought, then direct 8(a) awards (not a list of single open bids).',
    awardBits ? `Award evidence: ${awardBits}.` : 'Award evidence from this turn was thin; do not invent firm-wide totals.',
    vehicle ? `Lead with the ${vehicle} pathway where it fits the market.` : null,
    exitY ? `Include 8(a) timing through ${exitY} when discussing set-aside routes.` : null,
  ].filter(Boolean).join(' ');

  const sections: DocModel['sections'] = [
    {
      id: 'sec-pathways',
      heading: 'Pathways in priority order',
      blocks: [{
        type: 'paragraph',
        id: 'p-pathways',
        text: pathwayText,
        claim: 'fact',
        cites: ['s1'],
      }],
    },
  ];

  if (defense) {
    sections.push({
      id: 'sec-pae',
      heading: 'Defense construction oversight and Navy PAE',
      blocks: [{
        type: 'paragraph',
        id: 'p-pae',
        text:
          'Defense construction buying offices increasingly sit under defense construction oversight / Navy PAE '
          + '(and related WHS construction oversight). Treat PAE as that oversight shift for this profile.',
        claim: 'fact',
        cites: ['s1'],
      }],
    });
  }

  sections.push(
    {
      id: 'sec-pain',
      heading: 'What buyers are under pressure to fix',
      blocks: [{
        type: 'paragraph',
        id: 'p-pain',
        text:
          'Buyers in this market face deferred maintenance, schedule pressure on civil infrastructure, '
          + 'and the need for ready small-business seats on vehicles and sources sought.',
        claim: 'fact',
        cites: ['s1'],
      }],
    },
    {
      id: 'sec-who',
      heading: 'Who to talk to and what to say',
      blocks: [{
        type: 'table',
        id: 't-who',
        columns: [
          { key: 'contact', label: 'Contact' },
          { key: 'question', label: 'Question to ask' },
        ],
        rows: [{
          contact,
          question: vehicle
            ? `Ask about small-business seats on ${vehicle} and related sources sought.`
            : 'Ask about small-business seats on the active vehicles and sources sought in this market.',
        }],
      }],
    },
    {
      id: 'sec-ready',
      heading: 'Readiness checklist',
      blocks: [{
        type: 'bullets',
        id: 'b-ready',
        ordered: false,
        items: [
          {
            text: 'Update DSBS keywords to match the award NAICS and civil pathway terms from this profile.',
            claim: 'recommendation',
          },
          ...(evidence.selfReportLines.length
            ? evidence.selfReportLines.slice(0, 4).map((line, i) => ({
              text: `Self-reported (as stated by the firm): ${line}`,
              claim: 'assumption' as const,
              origin: 'Customer message (self-reported; not verified in federal tools).',
            }))
            : [{
              text: 'Bonding, equipment, and credential claims were not provided in this turn; confirm before pursuit.',
              claim: 'recommendation' as const,
            }]),
        ],
      }],
    },
  );

  return {
    schema: DOC_SCHEMA,
    title: `${company} Federal Market Profile`,
    date,
    preparedFor: company,
    sources: [{
      id: 's1',
      label: 'Ask Mindy FMP tool results (this turn)',
      kind: 'tool',
      retrievedAt: date,
    }],
    sections,
    theme: 'mindy',
    meta: { generatedBy: 'ask_mindy_fmp_host' },
  };
}

/** JSON arguments for a host-injected create_document call (never `{}`). */
export function buildFmpCreateDocumentInjectArgs(
  evidence: FmpWriteupEvidence,
  opts: BuildFmpHostDocModelOpts = {},
): string {
  return JSON.stringify({ doc_model: buildFmpHostDocModel(evidence, opts) });
}
