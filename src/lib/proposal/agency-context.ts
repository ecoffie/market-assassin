/**
 * Agency context layer for Proposal Assist v2.
 *
 * Detects the RFP's contracting agency from the source text, then pulls
 * pain points + priorities + budget trend from the same database
 * Content Reaper uses to ground LinkedIn posts in real agency reality.
 *
 * Why this matters: without agency context, the AI writes generic
 * "federal challenges". With it, the AI writes "addresses NAVWAR's
 * FY2026 NDAA zero-trust compliance mandate." That's what makes
 * Content Reaper's posts feel personalized.
 */

import {
  getPainPointsForAgency,
  getPrioritiesForAgency,
  categorizePainPoints,
} from '@/lib/utils/pain-points';
import { getBudgetForAgency } from '@/lib/utils/budget-authority';
import agencyAliasesData from '@/data/agency-aliases.json';
import type { AgencyContext } from './types';

// ---- Agency name resolver -------------------------------------------
//
// User-supplied or text-extracted agency names rarely match the
// canonical names in agency-pain-points.json verbatim. Examples:
//   "U.S. Army Marketing and Advertising Program" → "Department of the Army"
//   "NAVFAC Atlantic" → "Department of the Navy"
//   "DOJ FBI Cyber Division" → "Department of Justice"
//
// This resolver normalizes raw agency strings to their canonical
// parent name BEFORE pain-points lookup, using the existing
// 450-entry agency-aliases.json file.

interface AgencyAliasesData {
  aliases: Record<string, string>;
}
const ALIASES = (agencyAliasesData as unknown as AgencyAliasesData).aliases || {};

/**
 * Try to resolve any raw agency string to its canonical name in
 * agency-pain-points.json. Returns the original string if no
 * resolution succeeds (so caller can still try direct match).
 *
 * Strategy (in priority order):
 *   1. Exact alias key match (e.g. "DOD" → "Department of Defense")
 *   2. Substring scan: walk alias keys, return the LONGEST match
 *      that appears in the raw string (e.g. "U.S. Army Marketing..."
 *      contains "ARMY" → "Department of the Army")
 *   3. Keyword scan: known component/program prefixes (NAVFAC, USACE,
 *      etc.) map to their parent department
 */
export function resolveAgencyName(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();

  // 1. Exact alias hit (case-insensitive)
  const upper = trimmed.toUpperCase();
  if (ALIASES[upper]) return ALIASES[upper];
  if (ALIASES[trimmed]) return ALIASES[trimmed];

  // 2. Longest substring match across alias keys.
  //    Aliases come in many forms — abbreviations (DOD, NAVFAC),
  //    keywords (ARMY, NAVY), full names. We want the longest hit
  //    so "DEPARTMENT OF DEFENSE" beats "ARMY" if both appear.
  let bestMatch: { key: string; canonical: string; length: number } | null = null;
  for (const [aliasKey, canonical] of Object.entries(ALIASES)) {
    // Skip very short aliases (2-char) to avoid noisy substring hits
    if (aliasKey.length < 3) continue;
    // Word-boundary check so "VA" doesn't match "AdVAntage"
    const re = new RegExp(`\\b${aliasKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(trimmed)) {
      if (!bestMatch || aliasKey.length > bestMatch.length) {
        bestMatch = { key: aliasKey, canonical, length: aliasKey.length };
      }
    }
  }
  if (bestMatch) return bestMatch.canonical;

  // 3. Hard-coded fallbacks for known program/component patterns
  //    not covered by aliases (these are common in RFPs but their
  //    full names don't appear in the aliases file).
  const fallbacks: Array<[RegExp, string]> = [
    [/\bArmy\b/i, 'Department of the Army'],
    [/\bNavy\b|\bNAVFAC\b|\bNAVSEA\b|\bNAVAIR\b|\bNAVWAR\b|\bSPAWAR\b/i, 'Department of the Navy'],
    [/\bAir Force\b|\bUSAF\b|\bAFLCMC\b/i, 'Department of the Air Force'],
    [/\bMarine Corps\b/i, 'Department of the Navy'],
    [/\bCoast Guard\b/i, 'Department of Homeland Security'],
    [/\bUSACE\b|\bArmy Corps of Engineers\b/i, 'Department of the Army'],
  ];
  for (const [pattern, canonical] of fallbacks) {
    if (pattern.test(trimmed)) return canonical;
  }

  return trimmed;
}

// ---- Agency detection from RFP text ---------------------------------
//
// Most RFPs name the contracting agency in the first 2000 chars
// (header, "Issued by" block, "Department of X" mentions). We use a
// rank-based regex pass — name list is borrowed from agency-pain-points
// keys to maximize match rate.

const AGENCY_PATTERNS: Array<{ name: string; patterns: RegExp[] }> = [
  // DoD components — high priority because they buy a lot
  { name: 'Department of the Navy', patterns: [/\bDepartment of the Navy\b/i, /\bDON\b/, /\bNAVFAC\b/, /\bNAVWAR\b/, /\bNAVSEA\b/, /\bNAVAIR\b/, /\bSPAWAR\b/] },
  { name: 'Department of the Army', patterns: [/\bDepartment of the Army\b/i, /\bU\.?S\.? Army\b/i, /\bUSACE\b/, /\bArmy Corps of Engineers\b/i] },
  { name: 'Department of the Air Force', patterns: [/\bDepartment of the Air Force\b/i, /\bU\.?S\.? Air Force\b/i, /\bUSAF\b/, /\bAFLCMC\b/] },
  { name: 'Department of Defense', patterns: [/\bDepartment of Defense\b/i, /\bDoD\b/, /\bOSD\b/, /\bDefense Health Agency\b/i, /\bDHA\b/] },
  { name: 'Defense Logistics Agency', patterns: [/\bDefense Logistics Agency\b/i, /\bDLA\b/] },
  // Civilian agencies
  { name: 'Department of Veterans Affairs', patterns: [/\bDepartment of Veterans Affairs\b/i, /\bVeterans Affairs\b/i, /\bVA\b(?!\s*\d)/i] },
  { name: 'Department of Homeland Security', patterns: [/\bDepartment of Homeland Security\b/i, /\bDHS\b/, /\bCBP\b/, /\bICE\b/, /\bFEMA\b/, /\bTSA\b/, /\bUSCIS\b/, /\bCISA\b/] },
  { name: 'General Services Administration', patterns: [/\bGeneral Services Administration\b/i, /\bGSA\b/] },
  { name: 'Department of Health and Human Services', patterns: [/\bDepartment of Health and Human Services\b/i, /\bHHS\b/, /\bCMS\b/, /\bNIH\b/, /\bCDC\b/, /\bFDA\b/] },
  { name: 'Department of Energy', patterns: [/\bDepartment of Energy\b/i, /\bDOE\b/] },
  { name: 'Department of the Interior', patterns: [/\bDepartment of the Interior\b/i, /\bDOI\b/, /\bNational Park Service\b/i, /\bNPS\b/, /\bBLM\b/] },
  { name: 'Department of Justice', patterns: [/\bDepartment of Justice\b/i, /\bDOJ\b/, /\bFBI\b/, /\bDEA\b/, /\bATF\b/, /\bU\.?S\.? Marshals\b/i] },
  { name: 'Department of Transportation', patterns: [/\bDepartment of Transportation\b/i, /\bDOT\b/, /\bFAA\b/, /\bFHWA\b/] },
  { name: 'Department of State', patterns: [/\bDepartment of State\b/i, /\bU\.?S\.? Department of State\b/i] },
  { name: 'Department of Treasury', patterns: [/\bDepartment of (?:the )?Treasury\b/i, /\bIRS\b/] },
  { name: 'Department of Agriculture', patterns: [/\bDepartment of Agriculture\b/i, /\bUSDA\b/] },
  { name: 'Department of Commerce', patterns: [/\bDepartment of Commerce\b/i, /\bDOC\b/, /\bNOAA\b/, /\bNIST\b/, /\bCensus Bureau\b/i] },
  { name: 'Department of Education', patterns: [/\bDepartment of Education\b/i, /\bED\b/] },
  { name: 'Department of Labor', patterns: [/\bDepartment of Labor\b/i, /\bDOL\b/] },
  { name: 'Department of Housing and Urban Development', patterns: [/\bDepartment of Housing and Urban Development\b/i, /\bHUD\b/] },
  { name: 'Environmental Protection Agency', patterns: [/\bEnvironmental Protection Agency\b/i, /\bEPA\b/] },
  { name: 'Social Security Administration', patterns: [/\bSocial Security Administration\b/i, /\bSSA\b/] },
  { name: 'National Aeronautics and Space Administration', patterns: [/\bNational Aeronautics and Space Administration\b/i, /\bNASA\b/] },
  { name: 'Small Business Administration', patterns: [/\bSmall Business Administration\b/i, /\bSBA\b/] },
  { name: 'United States Postal Service', patterns: [/\bUnited States Postal Service\b/i, /\bUSPS\b/] },
];

/**
 * Detect the contracting agency from RFP text.
 *
 * Strategy: count hits per agency in the first 5000 chars of the doc.
 * Highest hit count wins. Returns null if no agency clearly named.
 *
 * Caller can override with an explicit rfpAgency parameter (e.g. when
 * the agency is already known from the pursuit row).
 */
export function detectRfpAgency(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const head = text.slice(0, 5000);

  // Tally hits per agency. We weigh first-1000-chars hits 2x because
  // those are usually the explicit "Issued by" / header sections.
  const scores: Record<string, number> = {};
  for (const { name, patterns } of AGENCY_PATTERNS) {
    let score = 0;
    for (const pattern of patterns) {
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      const hits = head.match(global) || [];
      const firstThousandHits = (head.slice(0, 1000).match(global) || []).length;
      score += hits.length + firstThousandHits; // first-1k bonus = +1 per hit there
    }
    if (score > 0) scores[name] = score;
  }

  if (Object.keys(scores).length === 0) return null;
  // Pick the highest scorer
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

/**
 * Build the full agency-context block for an RFP. Combines:
 *  - Detected (or provided) agency name
 *  - Top 6 pain points from the static database (most recent / most relevant)
 *  - Top priorities
 *  - Current budget trend (FY25 → FY26)
 *
 * Returns empty arrays / null when agency is unknown so v2 can still
 * draft without the context layer (degrades gracefully).
 */
export function buildAgencyContext(rfpText: string, explicitAgency?: string | null): AgencyContext {
  const rawAgency = explicitAgency || detectRfpAgency(rfpText);

  if (!rawAgency) {
    return {
      agency: null,
      painPoints: [],
      priorities: [],
      budgetTrend: null,
    };
  }

  // Normalize the user-supplied or detected agency name to its canonical
  // form in agency-pain-points.json (e.g. "U.S. Army Marketing and
  // Advertising Program" → "Department of the Army"). Surface BOTH the
  // resolved canonical name (used for the data lookup) and keep the
  // original-looking name for prompt display when we have it.
  const canonical = resolveAgencyName(rawAgency);

  // Try canonical first; fall back to raw if canonical found nothing
  // (in case the raw name was already a direct database key).
  let allPainPoints = getPainPointsForAgency(canonical);
  let allPriorities = getPrioritiesForAgency(canonical);
  if (allPainPoints.length === 0 && canonical !== rawAgency) {
    allPainPoints = getPainPointsForAgency(rawAgency);
  }
  if (allPriorities.length === 0 && canonical !== rawAgency) {
    allPriorities = getPrioritiesForAgency(rawAgency);
  }
  const budget = getBudgetForAgency(canonical) || getBudgetForAgency(rawAgency);

  // For display, prefer the more specific raw name if it contains
  // detail beyond the canonical (e.g. "U.S. Army Marketing and Advertising
  // Program" is more useful in the prompt than "Department of the Army")
  const agency = rawAgency.length > canonical.length && rawAgency.toLowerCase().includes(canonical.split(' ').slice(-1)[0].toLowerCase())
    ? rawAgency
    : canonical;

  // Cap pain points at 6 to keep prompt tight. Categorize lets us
  // prefer mixed coverage (one infrastructure + one cyber + one
  // workforce) over six of the same kind, but for v1 just take first 6.
  void categorizePainPoints; // reserved for future weighted selection

  const painPoints = allPainPoints.slice(0, 6);
  const priorities = allPriorities.slice(0, 4);

  let budgetTrend: string | null = null;
  if (budget) {
    const pctChange = ((budget.change.percent - 1) * 100).toFixed(1);
    const fy25 = (budget.fy2025.budgetAuthority / 1e9).toFixed(1);
    const fy26 = (budget.fy2026.budgetAuthority / 1e9).toFixed(1);
    budgetTrend = `${agency}: FY25 $${fy25}B → FY26 $${fy26}B (${budget.change.percent >= 1 ? '+' : ''}${pctChange}%, ${budget.change.trend})`;
  }

  return { agency, painPoints, priorities, budgetTrend };
}

/**
 * Format the agency context for inclusion in the AI prompt. Returns
 * empty string when no agency was detected (skip the block entirely).
 */
export function formatAgencyContextForPrompt(ctx: AgencyContext): string {
  if (!ctx.agency) return '';

  const parts: string[] = [];
  parts.push(`### Agency context: ${ctx.agency}`);
  parts.push('(Use these to ground the draft in what THIS agency actually struggles with — not generic federal-speak)');

  if (ctx.painPoints.length > 0) {
    parts.push('\n**Current pain points the agency is solving for:**');
    for (const pp of ctx.painPoints) {
      parts.push(`- ${pp}`);
    }
  }

  if (ctx.priorities.length > 0) {
    parts.push('\n**Stated strategic priorities:**');
    for (const p of ctx.priorities) {
      parts.push(`- ${p}`);
    }
  }

  if (ctx.budgetTrend) {
    parts.push(`\n**Budget trend:** ${ctx.budgetTrend}`);
  }

  return parts.join('\n');
}
