/**
 * Federal Market Profile write-up gate (step 8) — Choice B.
 *
 * Host refuses a bad DocModel (or markdown) with structured issues so the planner
 * can rewrite once. Soft: em-dash mechanical replace; open-bid wording warn-only.
 * Hard: pathways-first, who-to-talk-to, buyer pain, DSBS checklist, conditional PAE,
 * Mid CTA phrases, narrow grading phrases.
 *
 * Synonyms/bans live in `RBA_WRITEUP` (single source with tests).
 */

import type { Block, DocModel, DocSection } from '@/lib/documents/model';
import { RBA_WRITEUP } from './__fixtures__/rba-federal-market-profile';

export interface FmpWriteupContext {
  /** When true, a PAE / defense-oversight section is required. */
  defenseBuyersAppear: boolean;
  /**
   * Host-extracted award / vehicle / timing snippets that must appear in the
   * write-up body (from tool JSON). Missing any → hard error.
   * Matching: 6-digit NAICS codes are case-insensitive (digits); other snippets
   * match case-insensitively so "$42.5M" still hits after soft punctuation repair.
   */
  requiredSnippets?: string[];
}

export type FmpWriteupSeverity = 'error' | 'warn';

export interface FmpWriteupIssue {
  code: string;
  severity: FmpWriteupSeverity;
  message: string;
}

export interface FmpWriteupResult {
  ok: boolean;
  /** Model after soft em-dash replace (same reference if unchanged). */
  model?: DocModel;
  /** Markdown after soft em-dash replace. */
  text?: string;
  issues: FmpWriteupIssue[];
}

const EM_DASH_RE = /[—–]/g;

export function fmpDefenseBuyersAppear(text: string): boolean {
  const t = text || '';
  if (RBA_WRITEUP.defenseBuyerSignals.some((re) => re.test(t))) return true;
  // Live SAM buyer strings (name-only Ask) — not in the prompt-oriented fixture list.
  return /\bDEPT(?:ARTMENT)? OF (?:THE )?(?:DEFENSE|ARMY|NAVY|AIR FORCE)\b|\bUSACE\b|\bJBAB\b|\bNAV FAC\b|\bAir Force\b/i.test(t);
}

/** PAE / defense section from pathway + award buyers when the customer text is name-only. */
export function fmpDefenseBuyersAppearFromEvidence(evidence: {
  corpus?: string | null;
  pathways?: ReadonlyArray<{ buyer?: string; title?: string }> | null;
  buyerSpend?: ReadonlyArray<{ agency?: string }> | null;
  awardRows?: ReadonlyArray<{ buyer?: string }> | null;
}): boolean {
  const parts: string[] = [];
  if (evidence.corpus) parts.push(evidence.corpus);
  for (const p of evidence.pathways || []) {
    if (p.buyer) parts.push(p.buyer);
    if (p.title) parts.push(p.title);
  }
  for (const b of evidence.buyerSpend || []) {
    if (b.agency) parts.push(b.agency);
  }
  for (const a of evidence.awardRows || []) {
    if (a.buyer) parts.push(a.buyer);
  }
  return fmpDefenseBuyersAppear(parts.join('\n'));
}

/** Soft repair: em/en dash → hyphen. Does not spend the rewrite round. */
export function replaceEmDashes(text: string): string {
  return text.replace(EM_DASH_RE, '-');
}

function replaceEmDashesInModel(model: DocModel): DocModel {
  const mapBlock = (b: Block): Block => {
    if (b.type === 'paragraph' || b.type === 'callout') {
      return { ...b, text: replaceEmDashes(b.text) } as Block;
    }
    if (b.type === 'bullets') {
      return {
        ...b,
        items: b.items.map((it) => ({
          ...it,
          text: replaceEmDashes(it.text),
          ...(it.origin ? { origin: replaceEmDashes(it.origin) } : {}),
        })),
      };
    }
    if (b.type === 'table') {
      return {
        ...b,
        ...(b.caption ? { caption: replaceEmDashes(b.caption) } : {}),
        columns: b.columns.map((c) => ({ ...c, label: replaceEmDashes(c.label) })),
        rows: b.rows.map((row) => {
          const next: Record<string, string | number | null> = {};
          for (const [k, v] of Object.entries(row)) {
            next[k] = typeof v === 'string' ? replaceEmDashes(v) : v;
          }
          return next;
        }),
      };
    }
    if (b.type === 'chart') {
      return {
        ...b,
        ...(b.caption ? { caption: replaceEmDashes(b.caption) } : {}),
        ...(b.xLabel ? { xLabel: replaceEmDashes(b.xLabel) } : {}),
        ...(b.yLabel ? { yLabel: replaceEmDashes(b.yLabel) } : {}),
        series: b.series.map((s) => ({
          ...s,
          name: replaceEmDashes(s.name),
          points: s.points.map((p) => ({ ...p, x: replaceEmDashes(String(p.x)) })),
        })),
      };
    }
    return b;
  };
  return {
    ...model,
    title: replaceEmDashes(model.title),
    ...(model.subtitle ? { subtitle: replaceEmDashes(model.subtitle) } : {}),
    ...(model.preparedFor ? { preparedFor: replaceEmDashes(model.preparedFor) } : {}),
    sections: model.sections.map((s) => ({
      ...s,
      heading: replaceEmDashes(s.heading),
      blocks: s.blocks.map(mapBlock),
    })),
  };
}

function flattenModelText(model: DocModel): string {
  const parts: string[] = [model.title, model.subtitle ?? '', model.preparedFor ?? ''];
  for (const s of model.sections) {
    parts.push(s.heading);
    for (const b of s.blocks) {
      if (b.type === 'paragraph' || b.type === 'callout') parts.push(b.text);
      else if (b.type === 'bullets') for (const it of b.items) parts.push(it.text);
      else if (b.type === 'table') {
        if (b.caption) parts.push(b.caption);
        for (const c of b.columns) parts.push(c.label);
        for (const row of b.rows) for (const v of Object.values(row)) if (typeof v === 'string') parts.push(v);
      } else if (b.type === 'chart') {
        if (b.caption) parts.push(b.caption);
        for (const sers of b.series) parts.push(sers.name);
      }
    }
  }
  return parts.filter(Boolean).join('\n');
}

function sectionBodyText(s: DocSection): string {
  const parts: string[] = [s.heading];
  for (const b of s.blocks) {
    if (b.type === 'paragraph' || b.type === 'callout') parts.push(b.text);
    else if (b.type === 'bullets') for (const it of b.items) parts.push(it.text);
    else if (b.type === 'table') {
      for (const c of b.columns) parts.push(c.label);
      for (const row of b.rows) for (const v of Object.values(row)) if (typeof v === 'string') parts.push(v);
    }
  }
  return parts.join('\n');
}

function isSkippedHeading(heading: string): boolean {
  return RBA_WRITEUP.skipHeadingsForPathwaysFirst.some((re) => re.test(heading));
}

function firstSubstantiveSection(sections: readonly DocSection[]): DocSection | null {
  for (const s of sections) {
    if (s.role === 'about') continue;
    if (isSkippedHeading(s.heading)) continue;
    return s;
  }
  return null;
}

function headingMatches(heading: string, synonyms: readonly RegExp[]): boolean {
  return synonyms.some((re) => re.test(heading));
}

function findSection(sections: readonly DocSection[], synonyms: readonly RegExp[]): DocSection | null {
  for (const s of sections) {
    if (headingMatches(s.heading, synonyms)) return s;
  }
  return null;
}

function hasWhoToTalkTable(sections: readonly DocSection[]): boolean {
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.type !== 'table') continue;
      const labels = b.columns.map((c) => c.label);
      const hits = labels.filter((lab) =>
        RBA_WRITEUP.whoToTalkTableColumnHints.some((re) => re.test(lab)),
      ).length;
      // Need contact-ish + question-ish signal (at least 2 hint hits across columns).
      if (hits >= 2) return true;
    }
  }
  return false;
}

const PAE_GLOSS_BAN = /\bPerformance\s+Assessment\s+Evaluation\b/i;

function collectBanIssues(flat: string): FmpWriteupIssue[] {
  const issues: FmpWriteupIssue[] = [];
  for (const re of RBA_WRITEUP.gradingBanPhrases) {
    if (re.test(flat)) {
      issues.push({
        code: 'grading_ban',
        severity: 'error',
        message: 'Do not grade or score the company. Remove grading / letter-grade rating language.',
      });
      break;
    }
  }
  for (const re of RBA_WRITEUP.midCtaBanPhrases) {
    if (re.test(flat)) {
      issues.push({
        code: 'mid_cta_ban',
        severity: 'error',
        message: 'Omit Mid plan / pricing CTAs from this profile (accidental in the Claude benchmark). Keep market dollar figures.',
      });
      break;
    }
  }
  if (PAE_GLOSS_BAN.test(flat)) {
    issues.push({
      code: 'pae_gloss_ban',
      severity: 'error',
      message: 'Do not expand PAE as "Performance Assessment Evaluation". Use defense construction oversight / Navy PAE.',
    });
  }
  for (const re of RBA_WRITEUP.openBidSoftWarn) {
    if (re.test(flat)) {
      issues.push({
        code: 'open_bid_frame',
        severity: 'warn',
        message: 'Prefer vehicles / sources sought / direct awards - avoid framing as a list of single open bids.',
      });
      break;
    }
  }
  return issues;
}

function structureIssues(sections: readonly DocSection[], ctx: FmpWriteupContext): FmpWriteupIssue[] {
  const issues: FmpWriteupIssue[] = [];
  const first = firstSubstantiveSection(sections);
  if (!first || !headingMatches(first.heading, RBA_WRITEUP.pathwayHeadingSynonyms)) {
    issues.push({
      code: 'pathways_first',
      severity: 'error',
      message: 'Lead with pathways in priority order (vehicles / sources sought / direct awards). Put that section before market size, awards proof, or contacts.',
    });
  }

  const whoHeading = findSection(sections, RBA_WRITEUP.whoToTalkHeadingSynonyms);
  if (!whoHeading && !hasWhoToTalkTable(sections)) {
    issues.push({
      code: 'who_to_talk',
      severity: 'error',
      message: 'Include a "Who to talk to and what to say" section or a table with contact + question columns.',
    });
  }

  if (!findSection(sections, RBA_WRITEUP.buyerPainHeadingSynonyms)) {
    issues.push({
      code: 'buyer_pain',
      severity: 'error',
      message: 'Include a buyer pain points section (what these buyers are under pressure to fix).',
    });
  }

  const checklist = findSection(sections, RBA_WRITEUP.checklistHeadingSynonyms);
  const whole = sections.map(sectionBodyText).join('\n');
  const checklistText = checklist ? sectionBodyText(checklist) : '';
  const hasDsbs = /\bDSBS\b/i.test(checklistText) || (checklist != null && /\bDSBS\b/i.test(whole));
  if (!checklist) {
    issues.push({
      code: 'checklist',
      severity: 'error',
      message: 'Include a readiness checklist section.',
    });
  } else if (!hasDsbs) {
    issues.push({
      code: 'dsbs',
      severity: 'error',
      message: 'Readiness checklist must include DSBS keywords (the token DSBS).',
    });
  }

  if (ctx.defenseBuyersAppear && !findSection(sections, RBA_WRITEUP.paeHeadingSynonyms)) {
    issues.push({
      code: 'pae',
      severity: 'error',
      message: 'Defense buyers appear — include a PAE / defense construction oversight section.',
    });
  }

  return issues;
}

function requiredSnippetIssues(flat: string, snippets: readonly string[] | undefined): FmpWriteupIssue[] {
  if (!snippets?.length) return [];
  const issues: FmpWriteupIssue[] = [];
  const hay = flat;
  const hayLower = flat.toLowerCase();
  for (const raw of snippets) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const ok = /^\d{6}$/.test(s)
      ? hay.includes(s) // NAICS digits — exact
      : hayLower.includes(s.toLowerCase());
    if (!ok) {
      issues.push({
        code: 'required_snippet',
        severity: 'error',
        message: `Write-up must include grounded evidence snippet "${s}" from this turn's tool results.`,
      });
    }
  }
  return issues;
}

/** Validate a DocModel for FMP write-up. Soft-replaces em dashes first. */
export function validateFmpWriteup(doc: DocModel, ctx: FmpWriteupContext): FmpWriteupResult {
  const model = replaceEmDashesInModel(doc);
  const flat = flattenModelText(model);
  const issues = [
    ...structureIssues(model.sections ?? [], ctx),
    ...collectBanIssues(flat),
    ...requiredSnippetIssues(flat, ctx.requiredSnippets),
  ];
  // Em dashes should be gone after soft replace; if any remain, hard fail (safety).
  if (EM_DASH_RE.test(flat)) {
    issues.push({
      code: 'em_dash',
      severity: 'error',
      message: 'Remove em dashes (use commas, periods, or hyphens).',
    });
  }
  const hard = issues.filter((i) => i.severity === 'error');
  return { ok: hard.length === 0, model, issues };
}

/**
 * Vault-off fallback: validate final assistant markdown with the same hard rules
 * that do not require DocModel structure (bans + DSBS + pathway/pain/who/PAE heading cues).
 */
export function validateFmpWriteupMarkdown(text: string, ctx: FmpWriteupContext): FmpWriteupResult {
  const cleaned = replaceEmDashes(text || '');
  const issues: FmpWriteupIssue[] = [...collectBanIssues(cleaned)];
  if (EM_DASH_RE.test(cleaned)) {
    issues.push({
      code: 'em_dash',
      severity: 'error',
      message: 'Remove em dashes (use commas, periods, or hyphens).',
    });
  }
  if (!RBA_WRITEUP.pathwayHeadingSynonyms.some((re) => re.test(cleaned))) {
    issues.push({
      code: 'pathways_first',
      severity: 'error',
      message: 'Lead with pathways in priority order (vehicles / sources sought / direct awards).',
    });
  }
  if (
    !RBA_WRITEUP.whoToTalkHeadingSynonyms.some((re) => re.test(cleaned))
    && !/\bquestion to ask\b/i.test(cleaned)
  ) {
    issues.push({
      code: 'who_to_talk',
      severity: 'error',
      message: 'Include who to talk to and what to say (named contact + question).',
    });
  }
  if (!RBA_WRITEUP.buyerPainHeadingSynonyms.some((re) => re.test(cleaned))) {
    issues.push({
      code: 'buyer_pain',
      severity: 'error',
      message: 'Include buyer pain points.',
    });
  }
  if (!/\bDSBS\b/i.test(cleaned)) {
    issues.push({
      code: 'dsbs',
      severity: 'error',
      message: 'Include DSBS keywords in the readiness checklist.',
    });
  }
  if (ctx.defenseBuyersAppear && !RBA_WRITEUP.paeHeadingSynonyms.some((re) => re.test(cleaned))) {
    issues.push({
      code: 'pae',
      severity: 'error',
      message: 'Defense buyers appear — include a PAE / defense oversight section.',
    });
  }
  issues.push(...requiredSnippetIssues(cleaned, ctx.requiredSnippets));
  const hard = issues.filter((i) => i.severity === 'error');
  return { ok: hard.length === 0, text: cleaned, issues };
}
