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

/** Podcast-guest content is never shown on the dashboard insight card (Eric, 2026-11-27). */
export function isPodcastSource(source: unknown): boolean {
  return typeof source === 'string' && /podcast/i.test(source);
}

/**
 * The insight card's last-resort line when no briefing or data insight is available. True and non-numeric on
 * purpose: a number shown to a customer needs a source, and this line has none.
 */
export const STATIC_FALLBACK_QUOTE = "Responding early to sources sought and RFIs gets you on the buyer's radar before the solicitation.";

/**
 * General lines for a user with no profile or no matches today, rotated by date. Not the customer's data, and no
 * figures: the old list stated "3,000+ a week", "$183B in FY25" and "40% of FY26" with no source behind them.
 */
export const PROFILE_LESS_QUOTES: ReadonlyArray<{ quote: string; format: string }> = [
  { quote: 'New federal opportunities post every business day. Your matches change daily.', format: 'sentence' },
  { quote: 'Set-asides reserve some contracts for small businesses only. Check each notice for one.', format: 'sentence' },
  { quote: 'Why do most small businesses miss their first federal bid?', format: 'question' },
  { quote: 'The agency wants you. They just don\'t know your name yet.', format: 'contrarian' },
  { quote: 'Sources Sought windows decide who gets shortlisted.', format: 'sentence' },
  { quote: 'Read the evaluation criteria first. They tell you what wins.', format: 'sentence' },
  { quote: 'Your NAICS profile is your federal calling card.', format: 'fragment' },
];
