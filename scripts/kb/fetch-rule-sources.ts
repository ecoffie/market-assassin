#!/usr/bin/env tsx
/**
 * Fetch the OFFICIAL text behind each rules-KB entry (read-only HTTP; no SAM) and write a reviewable snapshot:
 *   docs/knowledge/how-government-buys-now-2026-11-27.sources.json
 *
 * Why a committed snapshot: the passage Mindy cites must be the rule's own words, and a reviewer must be able to see
 * exactly which words. The ingest (scripts/kb/ingest-rules-kb.ts) reads this file; it never re-fetches.
 *
 * Rules:
 *   - Only official / official_mirror sources are fetched. Secondary sources are recorded as not_fetched_secondary.
 *   - A failed fetch, or an official page where the entry's anchor text is not found, is `fetch_failed` with the
 *     reason. The entry is never dropped.
 *   - Passages are cut around the entry's anchor (a section heading or the rule's own phrase), never paraphrased.
 *
 *   npx tsx scripts/kb/fetch-rule-sources.ts            # fetch + write the snapshot
 *   npx tsx scripts/kb/fetch-rule-sources.ts --check    # fetch, print a table, write nothing
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseRulesKb, RULES_KB_DOC, RULES_KB_CHECKED_ON } from '../../src/lib/knowledge/rules-kb';

const OUT = 'docs/knowledge/how-government-buys-now-2026-11-27.sources.json';
const UA = 'Mozilla/5.0 (compatible; MindyRulesKB/1.0; read-only research)';
const MAX_PASSAGE = 2400;

/** Where in each official document the entry's rule lives. One or more anchors per (claim, url host/path). */
const ANCHORS: Record<string, Array<{ url: RegExp; anchors: RegExp[]; section?: boolean; absent?: string[]; all?: boolean }>> = {
  'KB-1': [
    // A missing order of precedence cannot be quoted; the snapshot records that the phrases are absent from the text.
    { url: /far-overhaul-part-19/, anchors: [/maximum practicable opportunities/i], absent: ['first consider', 'order of precedence'] },
    { url: /DoD_RFO_Deviation_Part-19/, anchors: [/Effective February 1, 2026, contracting officers shall use/i] },
    { url: /deviation-far-part-19/, anchors: [/Applicability\. All VA procurements/i], absent: ['first consider', 'order of precedence'] },
  ],
  'KB-2': [
    { url: /far-overhaul-part-19/, anchors: [/must set the contract aside for small business if there is a reasonable expectation/i] },
    { url: /DoD_RFO_Deviation_Part-19/, anchors: [/219\.104-1 Total small business set-asides/i] },
    { url: /deviation-far-part-19/, anchors: [/required by statute/i, /rule of two/i] },
  ],
  'KB-3': [
    { url: /far-overhaul-part-19/, anchors: [/not a basis for protest/i] },
    { url: /2025-10611/, anchors: [/withdraw/i] },
    { url: /deviation-far-part-19/, anchors: [/discretionary at the order level/i] },
    { url: /2024-24716/, anchors: [/rule of two/i] },
  ],
  'KB-4': [
    { url: /uscode\/text\/38\/8127/, anchors: [/reasonable expectation that two or more/i, /\(d\)\s*Use of restricted competition/i] },
    { url: /deviation-far-part-19/, anchors: [/8127/, /veteran-owned/i, /Veterans First/i] },
  ],
  'KB-5': [
    { url: /far-overhaul-part-19/, anchors: [/must first try conducting the acquisition as a competitive 8\(a\) order/i, /The follow-on will be set aside under the HUBZone, SDVOSB, or WOSB programs/i], all: true },
    { url: /DoD_RFO_Deviation_Part-19/, anchors: [/\$?150[, ]?(?:000,000| million)/i] },
    { url: /deviation-far-part-19/, anchors: [/Competing 8\(a\) orders/i] },
  ],
  'KB-6': [{ url: /2025-16412/, anchors: [/\$350,000/, /micro-purchase threshold/i, /simplified acquisition threshold/i] }],
  'KB-7': [
    { url: /2024-29393/, anchors: [/recertif/i] },
    { url: /2026-19546/, anchors: [/338 industry/i, /size standards/i] },
  ],
  'KB-8': [{ url: /2025-06839/, anchors: [/required by statute or (?:that are )?essential/i, /Revolutionary FAR Overhaul/i, /Federal Acquisition Regulation/i] }],
  'KB-9': [
    { url: /2025-06835/, anchors: [/maximum extent practicable/i, /commercial/i] },
    { url: /publ60/, anchors: [/SEC\. 1822\./], section: true },
  ],
  'KB-10': [
    { url: /2025-05197/, anchors: [/consolidat/i] },
    { url: /m-25-31/, anchors: [/consolidat/i] },
  ],
  'KB-11': [{ url: /publ60/, anchors: [/SEC\. 1802\./], section: true }],
  'KB-12': [
    { url: /uscode\/text\/10\/3458/, anchors: [/\(a\) Authority/] },
    { url: /publ60/, anchors: [/SEC\. 1823\./], section: true },
  ],
  'KB-13': [
    { url: /uscode\/text\/10\/4021/, anchors: [/\(a\) Additional Forms of Transactions Authorized/] },
    { url: /uscode\/text\/10\/4022/, anchors: [/\(f\) Follow-on Production Contracts or Transactions/] },
  ],
  'KB-14': [{ url: /far\/35\.016/, anchors: [/\(a\) General/] }],
  'KB-15': [{ url: /publ60/, anchors: [/SEC\. 1826\./, /SEC\. 1804\./, /SEC\. 824\./, /SEC\. 875\./], section: true }],
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&sect;/g, '§').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|pre)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

async function pdfToText(buf: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const r = await parser.getText();
    return r.text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  } finally {
    await parser.destroy?.();
  }
}

/**
 * federalregister.gov answers plain HTTP clients with an "unblock" interstitial, including its full-text URLs. The
 * same Federal Register document is published by GPO on govinfo.gov at a path built from the publication date and
 * document number. The citation keeps the original URL; only the fetch goes to govinfo.
 */
export function resolveFetchUrl(url: string): string {
  const m = url.match(/federalregister\.gov\/documents\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{4}-\d{4,6})/);
  return m ? `https://www.govinfo.gov/content/pkg/FR-${m[1]}-${m[2]}-${m[3]}/html/${m[4]}.htm` : url;
}

/** Cut a passage at the first anchor that matches. section=true cuts from "SEC. n." to the next "SEC. " heading. */
export function cutPassage(text: string, anchors: RegExp[], section = false, all = false): string[] {
  const out: string[] = [];
  for (const a of anchors) {
    const m = a.exec(text);
    if (!m) continue;
    let start = m.index;
    let end: number;
    if (section) {
      const rest = text.slice(start + m[0].length);
      const next = rest.search(/\bSEC\. \d+\./);
      end = start + m[0].length + (next < 0 ? MAX_PASSAGE : Math.min(next, MAX_PASSAGE));
    } else {
      // Start at the beginning of the sentence holding the anchor (at most 250 chars back), never mid-navigation.
      const back = text.slice(Math.max(0, m.index - 250), m.index);
      const cut = Math.max(back.lastIndexOf('. '), back.lastIndexOf('\n'));
      start = cut >= 0 ? m.index - back.length + cut + 1 : m.index;
      end = Math.min(text.length, start + MAX_PASSAGE);
    }
    out.push(text.slice(start, end).replace(/\s+/g, ' ').trim());
    if (!section && !all) break; // first matching phrase is enough; sections (and `all`) collect each anchor
  }
  return out;
}

interface FetchedDoc { fetched_from?: string; http_status: number | null; content_type: string | null; sha256: string | null; text: string | null; error: string | null }

export async function fetchDoc(url: string): Promise<FetchedDoc> {
  try {
    const target = resolveFetchUrl(url);
    const res = await fetch(target, { headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    const ct = res.headers.get('content-type');
    if (!res.ok) return { http_status: res.status, content_type: ct, sha256: null, text: null, error: `HTTP ${res.status}` };
    if (/unblock\.federalregister\.gov/.test(res.url)) return { http_status: res.status, content_type: ct, sha256: null, text: null, error: 'Federal Register access interstitial (not the document)' };
    const buf = Buffer.from(await res.arrayBuffer());
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const isPdf = (ct || '').includes('pdf') || url.toLowerCase().endsWith('.pdf');
    const isTxt = (ct || '').includes('text/plain') || target.endsWith('.txt');
    const text = isPdf ? await pdfToText(buf) : isTxt ? buf.toString('utf8').replace(/[ \t]+/g, ' ') : htmlToText(buf.toString('utf8'));
    return { fetched_from: target, http_status: res.status, content_type: ct, sha256, text, error: null };
  } catch (e) {
    return { http_status: null, content_type: null, sha256: null, text: null, error: (e as Error).message };
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const entries = parseRulesKb(readFileSync(RULES_KB_DOC, 'utf8'));
  const fetchedAt = new Date().toISOString();
  const docs = new Map<string, FetchedDoc>();
  const officialUrls = [...new Set(entries.flatMap((e) => e.sources.filter((s) => s.kind !== 'secondary').map((s) => s.url)))];
  for (const url of officialUrls) {
    docs.set(url, await fetchDoc(url));
    const d = docs.get(url)!;
    console.log(`${d.error ? 'FAIL' : ' ok '} ${String(d.http_status ?? '---')} ${(d.text?.length ?? 0).toString().padStart(8)} chars  ${url}${d.error ? `  (${d.error})` : ''}`);
  }

  const passages: Record<string, Record<string, { fetch_status: string; passage: string | null; fetch_error: string | null; absent_phrases?: Record<string, number> }>> = {};
  for (const e of entries) {
    passages[e.claim_id] = {};
    for (const s of e.sources) {
      if (s.kind === 'secondary') {
        passages[e.claim_id][s.url] = { fetch_status: 'not_fetched_secondary', passage: null, fetch_error: null };
        continue;
      }
      const d = docs.get(s.url)!;
      if (d.error || !d.text) {
        passages[e.claim_id][s.url] = { fetch_status: 'fetch_failed', passage: null, fetch_error: d.error ?? 'empty document' };
        continue;
      }
      const rule = (ANCHORS[e.claim_id] || []).find((r) => r.url.test(s.url));
      const cut = rule ? cutPassage(d.text, rule.anchors, rule.section, rule.all) : [];
      // Measured absence: how many times each phrase occurs in the fetched document (0 = absent).
      const absent = rule?.absent
        ? Object.fromEntries(rule.absent.map((ph) => [ph, d.text!.toLowerCase().split(ph.toLowerCase()).length - 1]))
        : undefined;
      passages[e.claim_id][s.url] = cut.length
        ? { fetch_status: 'ok', passage: cut.join('\n…\n'), fetch_error: null, ...(absent ? { absent_phrases: absent } : {}) }
        : { fetch_status: 'fetch_failed', passage: null, fetch_error: rule ? 'fetched, but the entry\'s anchor text was not found in the document' : 'no anchor defined for this source' };
    }
  }

  console.log('\nclaim   source status');
  for (const [id, m] of Object.entries(passages)) {
    for (const [url, p] of Object.entries(m)) console.log(`${id.padEnd(6)}  ${p.fetch_status.padEnd(22)} ${new URL(url).hostname}${p.fetch_error ? `  — ${p.fetch_error}` : ''}`);
  }
  if (check) return;
  const sources = Object.fromEntries([...docs].map(([url, d]) => [url, { fetched_from: d.fetched_from ?? url, http_status: d.http_status, content_type: d.content_type, sha256: d.sha256, error: d.error }]));
  writeFileSync(OUT, `${JSON.stringify({ doc: RULES_KB_DOC, checked_on: RULES_KB_CHECKED_ON, fetched_at: fetchedAt, sources, passages }, null, 2)}\n`);
  console.log(`\nwrote ${OUT}`);
}

if (process.argv[1]?.endsWith('fetch-rule-sources.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
