/**
 * Interim federal jobs: read the "Federal Government Jobs" cards off govcongiants.com/jobs.
 *
 * govcon-funnels renders those cards server-side from USAJobs, but exposes no feed for them
 * (its /api/jobs is JSearch only). Until Mindy has its own USAJOBS_API_KEY, we parse the
 * rendered page. This is deliberately narrow and fails soft: if the page markup changes and
 * nothing parses, the caller shows "can't load" for that part, never "0 federal jobs".
 * Remove this file once contractor_job_postings holds USAJobs rows.
 */
import { normalizeStateCode } from '@/lib/utils/us-states';
import { categorizeJob } from './categories';
import { detectClearance } from './signals';
import type { JobListing } from './read';

export const GCG_JOBS_PAGE = 'https://govcongiants.com/jobs';
const CARD_START = '<a href="https://www.usajobs.gov:443/job/';

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

const one = (re: RegExp, s: string) => {
  const m = s.match(re);
  return m ? decode(m[1]) : null;
};

/** "$107K - $139K" → [107000, 139000]; anything else → nulls. */
function parseSalary(s: string | null): [number | null, number | null] {
  if (!s) return [null, null];
  const nums = [...s.matchAll(/\$\s?(\d+(?:\.\d+)?)\s?K/gi)].map((m) => Math.round(parseFloat(m[1]) * 1000));
  if (nums.length === 0) return [null, null];
  if (/^up to/i.test(s)) return [null, nums[0]];
  return [nums[0] ?? null, nums[1] ?? null];
}

/** "Today" / "Yesterday" / "3 days ago" / "2 weeks ago" / "1 month ago" → ISO date. */
function parseAgo(s: string | null, now: Date): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  const day = 86_400_000;
  let days: number | null = null;
  if (t === 'today') days = 0;
  else if (t === 'yesterday') days = 1;
  else {
    const m = t.match(/(\d+)\s+(day|week|month)s?\s+ago/);
    if (m) days = Number(m[1]) * (m[2] === 'day' ? 1 : m[2] === 'week' ? 7 : 30);
  }
  return days == null ? null : new Date(now.getTime() - days * day).toISOString();
}

/** "Phoenix, Arizona" → { city: 'Phoenix', state: 'AZ' }. */
function parseLocation(s: string | null): { city: string | null; state: string | null } {
  if (!s) return { city: null, state: null };
  const [city, st] = s.split(',').map((x) => x.trim());
  const state = st ? normalizeStateCode(st) : null;
  return state ? { city: city || null, state } : { city: null, state: null };
}

export function parseGcgFederalJobs(html: string, now: Date = new Date()): JobListing[] {
  const out: JobListing[] = [];
  const seen = new Set<string>();
  const chunks = html.split(CARD_START).slice(1);
  for (const raw of chunks) {
    const card = raw.slice(0, raw.indexOf('</a>') > 0 ? raw.indexOf('</a>') : raw.length);
    const id = one(/^(\d+)"/, card);
    const title = one(/<h3[^>]*>([^<]+)<\/h3>/, card);
    const agency = one(/<p class="text-slate-400 text-sm truncate">([^<]+)<\/p>/, card);
    if (!id || !title || !agency || seen.has(id)) continue;
    seen.add(id);
    const salary = one(/<div class="text-green-400 font-semibold">([^<]+)<\/div>/, card);
    const ago = one(/<span class="text-slate-500 text-xs">([^<]+)<\/span>/, card);
    // The two icon spans after the header: location, then clearance (when present).
    const spans = [...card.matchAll(/<\/svg>([^<]+)<\/span>/g)].map((m) => decode(m[1]));
    const loc = parseLocation(spans[0] ?? null);
    const clearanceText = spans[1] ?? null;
    // Only a recognised level counts ("Secret", "Top Secret", "TS/SCI", "Public Trust");
    // "Not Required" / "Other" / anything else is shown as not stated.
    const clearance = clearanceText ? detectClearance(clearanceText) ?? (/^(secret|top secret)$/i.test(clearanceText) ? clearanceText : null) : null;
    const [salary_min, salary_max] = parseSalary(salary);
    const posted = parseAgo(ago, now);
    out.push({
      id: `usajobs:${id}`,
      source: 'usajobs',
      title,
      employer_name: agency,
      department: null,
      city: loc.city,
      state: loc.state,
      remote: /bg-blue-500\/20[^>]*>Remote</.test(card),
      clearance,
      contingent_on_award: false,
      salary_min,
      salary_max,
      posted_at: posted,
      first_seen_at: posted ?? now.toISOString(),
      apply_url: `https://www.usajobs.gov/job/${id}`,
      role: categorizeJob(title),
    });
  }
  return out;
}

export async function fetchGcgFederalJobs(fetchImpl: typeof fetch = fetch): Promise<JobListing[]> {
  try {
    const res = await fetchImpl(GCG_JOBS_PAGE, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(10_000) } as RequestInit);
    if (!res.ok) return [];
    return parseGcgFederalJobs(await res.text());
  } catch {
    return [];
  }
}
