/**
 * Weekly Deep Dive opportunities must come from a source record.
 *
 * Calendar sanitizing removed invented dates. It did not validate the ten
 * cached opportunity titles. Those were still LLM names with no source ID,
 * no current status, and no market-match reason. Keyword hits cannot
 * authorize an outside-market contract — same boundary as Open alerts.
 *
 * Generate-time: build the list from USASpending records. Overlay LLM
 * analysis only onto a matching sourceId.
 * Send-time: drop cached rows that lack source ID, actual title, current
 * status, and market-match reason. Stale templates cannot bypass this.
 */

import { naicsInSavedMarket } from '@/lib/alerts/open-contract-d';
import { parseVerifiedDateIso } from './calendar-sanitize';

export type OpportunitySource = {
  sourceId: string;
  title: string;
  agency: string;
  incumbent: string;
  value: number;
  naicsCode: string;
  expirationDate: string;
  status: string;
  marketMatchReason: string;
  window: string;
};

export type WeeklyOpportunityRow = {
  sourceId?: string | null;
  title?: string | null;
  contractName?: string | null;
  status?: string | null;
  marketMatchReason?: string | null;
  agency?: string | null;
  incumbent?: string | null;
  value?: number | null;
  window?: string | null;
  naicsCode?: string | null;
  rank?: number | null;
  displacementAngle?: string | null;
  keyDates?: { label: string; date: string }[] | null;
  competitiveLandscape?: string[] | null;
  recommendedApproach?: string | null;
};

const PLACEHOLDER_TITLE = /^(contract|n\/a|unknown|untitled|none)$/i;

export function currentContractStatus(expirationDate: string | null | undefined, now = Date.now()): string | null {
  const date = parseVerifiedDateIso(expirationDate);
  if (!date) return null;
  const end = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(end)) return null;
  const days = Math.ceil((end - now) / 86_400_000);
  if (days < 0) return `Expired ${date}`;
  if (days === 0) return `Expires today (${date})`;
  if (days <= 180) return `Expiring ${date} (${days} days remaining)`;
  return `Active through ${date}`;
}

export function actualSourceTitle(raw: string | null | undefined): string | null {
  const title = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  if (PLACEHOLDER_TITLE.test(title)) return null;
  if (/^\d{6}\s+contract$/i.test(title)) return null;
  return title;
}

export function marketMatchReason(args: {
  naicsCode?: string | null;
  savedNaics: string[];
  matchFactors?: string[] | null;
}): string | null {
  if (!naicsInSavedMarket(args.naicsCode, args.savedNaics)) return null;
  const naics = String(args.naicsCode || '').replace(/\D/g, '');
  const parts = [`NAICS ${naics} is in this saved market`];
  for (const factor of args.matchFactors || []) {
    if (factor.startsWith('Keyword:')) {
      parts.push(`keyword "${factor.slice('Keyword:'.length)}" in title`);
    } else if (factor.startsWith('KeywordDesc:')) {
      parts.push(`keyword "${factor.slice('KeywordDesc:'.length)}" in description`);
    } else if (factor === 'Agency') {
      parts.push('target agency match');
    } else if (factor === 'PSC') {
      parts.push('PSC mention in description');
    }
  }
  return parts.join('; ');
}

export function opportunitySourceFromContract(
  contract: {
    contractNumber?: string | null;
    contractName?: string | null;
    agency?: string | null;
    incumbent?: string | null;
    value?: number | null;
    naicsCode?: string | null;
    expirationDate?: string | null;
    matchFactors?: string[] | null;
  },
  savedNaics: string[],
): OpportunitySource | null {
  const sourceId = String(contract.contractNumber || '').trim();
  const title = actualSourceTitle(contract.contractName);
  const expirationDate = parseVerifiedDateIso(contract.expirationDate);
  const status = currentContractStatus(expirationDate);
  const reason = marketMatchReason({
    naicsCode: contract.naicsCode,
    savedNaics,
    matchFactors: contract.matchFactors,
  });
  if (!sourceId || !title || !expirationDate || !status || !reason) return null;
  return {
    sourceId,
    title,
    agency: String(contract.agency || '').trim(),
    incumbent: String(contract.incumbent || '').trim(),
    value: Number(contract.value) || 0,
    naicsCode: String(contract.naicsCode || '').replace(/\D/g, ''),
    expirationDate,
    status,
    marketMatchReason: reason,
    window: status,
  };
}

export function opportunitiesFromSources(sources: OpportunitySource[], max = 10): WeeklyOpportunityRow[] {
  const seen = new Set<string>();
  const out: WeeklyOpportunityRow[] = [];
  for (const source of sources) {
    if (seen.has(source.sourceId)) continue;
    seen.add(source.sourceId);
    out.push({
      sourceId: source.sourceId,
      title: source.title,
      contractName: source.title,
      status: source.status,
      marketMatchReason: source.marketMatchReason,
      agency: source.agency,
      incumbent: source.incumbent,
      value: source.value,
      window: source.window,
      naicsCode: source.naicsCode,
      rank: out.length + 1,
      displacementAngle: '',
      keyDates: [{ label: 'Period of performance end', date: source.expirationDate }],
      competitiveLandscape: [],
      recommendedApproach: '',
    });
    if (out.length >= max) break;
  }
  return out;
}

export function overlayOpportunityAnalysis(
  grounded: WeeklyOpportunityRow[],
  llm: Array<{
    sourceId?: string | null;
    displacementAngle?: string | null;
    competitiveLandscape?: string[] | null;
    recommendedApproach?: string | null;
  }> | null | undefined,
): WeeklyOpportunityRow[] {
  const rows = Array.isArray(llm) ? llm : [];
  const byId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const id = String(row.sourceId || '').trim();
    if (id && !byId.has(id)) byId.set(id, row);
  }
  return grounded.map((row) => {
    const extra = byId.get(String(row.sourceId || ''));
    if (!extra) return row;
    return {
      ...row,
      displacementAngle: String(extra.displacementAngle || '').trim(),
      competitiveLandscape: Array.isArray(extra.competitiveLandscape)
        ? extra.competitiveLandscape.map((item) => String(item))
        : [],
      recommendedApproach: String(extra.recommendedApproach || '').trim(),
    };
  });
}

function hasRequiredFields(item: WeeklyOpportunityRow): {
  sourceId: string;
  title: string;
  status: string;
  marketMatchReason: string;
} | null {
  const sourceId = String(item.sourceId || '').trim();
  const title = actualSourceTitle(item.title) || actualSourceTitle(item.contractName);
  const status = String(item.status || '').trim();
  const marketMatchReasonText = String(item.marketMatchReason || '').trim();
  if (!sourceId || !title || !status || !marketMatchReasonText) return null;
  return { sourceId, title, status, marketMatchReason: marketMatchReasonText };
}

/**
 * Keep a weekly opportunity only when it cites a source record.
 *
 * Generate-time: pass the source catalog. Title, status, and market-match
 * reason must equal that record — never keep an LLM rename.
 * Send-time (cached templates): omit rows missing any of the four required
 * fields. Old LLM templates without source ids drop entirely.
 */
export function sanitizeWeeklyOpportunities<T extends WeeklyOpportunityRow>(
  items: T[] | null | undefined,
  sources?: OpportunitySource[],
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  const catalog = new Map<string, OpportunitySource>();
  for (const source of sources || []) {
    catalog.set(source.sourceId, source);
  }

  for (const item of items || []) {
    const required = hasRequiredFields(item);
    if (!required) {
      dropped.push(item);
      continue;
    }
    if (sources) {
      const verified = catalog.get(required.sourceId);
      if (
        !verified ||
        verified.title !== required.title ||
        verified.status !== required.status ||
        verified.marketMatchReason !== required.marketMatchReason
      ) {
        dropped.push(item);
        continue;
      }
    }
    kept.push({
      ...item,
      sourceId: required.sourceId,
      title: required.title,
      contractName: required.title,
      status: required.status,
      marketMatchReason: required.marketMatchReason,
    });
  }
  return { kept, dropped };
}

export function weeklyOpportunityGrounding(items: WeeklyOpportunityRow[] | null | undefined): {
  grounded: number;
  ungrounded: number;
} {
  const { kept, dropped } = sanitizeWeeklyOpportunities(items || []);
  return { grounded: kept.length, ungrounded: dropped.length };
}
