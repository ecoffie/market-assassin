export type BriefingOpportunity = {
  contractName?: string;
  agency?: string;
  value?: unknown;
  window?: string;
};

export function selectInsightOpportunities(
  opportunities: BriefingOpportunity[],
  today: string,
  rotateSeed = 0,
  count = 5
): BriefingOpportunity[] {
  const clean = opportunities.filter((opp) => opp?.contractName || opp?.agency);
  if (clean.length <= 1) return clean.slice(0, count);

  const start = (dateSeed(today) + rotateSeed * 3) % clean.length;
  const rotated = clean.slice(start).concat(clean.slice(0, start));
  return rotated.slice(0, Math.min(count, rotated.length));
}

export function dateSeed(yyyyMmDd: string): number {
  const date = new Date(`${yyyyMmDd}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000);
}

export function isSimilarToRecent(quote: string, recentQuotes: string[]): boolean {
  const normalized = normalizeQuote(quote);
  if (!normalized) return false;
  return recentQuotes.some((recent) => {
    const other = normalizeQuote(recent);
    if (!other) return false;
    if (normalized === other) return true;
    return normalized.includes(other) || other.includes(normalized);
  });
}

function normalizeQuote(quote: string): string {
  return quote
    .toLowerCase()
    .replace(/\$?\d+(?:\.\d+)?\s*[bmk]?\b/g, '#')
    .replace(/[^a-z0-9#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
