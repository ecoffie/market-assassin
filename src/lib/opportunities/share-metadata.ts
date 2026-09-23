/**
 * Opportunity share metadata — what a crawler (Facebook, LinkedIn, X, iMessage, Slack) sees when
 * someone shares `/opportunity-map?opp=<notice_id>`.
 *
 * WHY THIS EXISTS: /opportunity-map is a route handler that returns a hand-built HTML template,
 * so no Next layout metadata ever reaches it. Measured on prod 2026-09-23: the share URL returned
 * 200 with ZERO og:/twitter: tags and `<title>Mindy Map</title>` — so Facebook rendered
 * "GETMINDY.AI / Mindy Map" with the apple-touch-icon (the purple Mindy logo) as the image. The
 * shared OBJECT was invisible; the product name was the hero.
 *
 * THE RULE: every field on the card comes from a verified `sam_opportunities` column. Unknown →
 * OMITTED, never filled. No deadline is guessed, no location is inferred from the buying office
 * (that is where the buyer sits, not where the work happens), no value/set-aside is invented.
 */
import { createClient } from '@supabase/supabase-js';
import { US_STATE_NAMES } from '@/lib/utils/us-states';

export const OPP_SHARE_COLS =
  'notice_id, title, department, sub_tier, office, notice_type, solicitation_number, response_deadline, active, pop_city, pop_state, pop_country, raw_data->>responseDeadLine';

export interface OppShareRow {
  notice_id: string;
  title: string | null;
  department?: string | null;
  sub_tier?: string | null;
  office?: string | null;
  notice_type?: string | null;
  solicitation_number?: string | null;
  response_deadline?: string | null;
  /** SAM's original deadline string WITH its issuing offset (e.g. 2026-09-29T09:00:00-04:00). */
  responseDeadLine?: string | null;
  active?: boolean | string | null;
  pop_city?: string | null;
  pop_state?: string | null;
  pop_country?: string | null;
}

export interface OppShareMeta {
  noticeId: string;
  /** og:title / twitter:title / <title> */
  title: string;
  /** og:description — only verified facts joined; never padded. */
  description: string;
  /** Card fields (each null when unknown → omitted from the image). */
  card: {
    title: string;
    buyer: string | null;
    location: string | null;
    deadline: string | null;
    deadlineLabel: 'Responses due' | 'Responses closed' | null;
    solicitation: string | null;
    noticeType: string | null;
    closed: boolean;
  };
}

// Words kept lowercase mid-phrase, and tokens kept uppercase, when title-casing SAM's ALL-CAPS agency names.
const SMALL = new Set(['of', 'the', 'and', 'for', 'on', 'in', 'to', 'at', 'a', 'an', 'or']);
const ACRONYMS = new Set(['US', 'U.S.', 'DOD', 'DHS', 'DOE', 'DOJ', 'DOT', 'VA', 'NASA', 'GSA', 'EPA', 'USDA', 'HHS', 'NIH', 'CDC', 'FAA', 'FBI', 'IRS', 'USACE', 'DLA', 'NAVSUP', 'NAVFAC', 'NOAA', 'SBA', 'SSA', 'NSF', 'NRC', 'USAF', 'II', 'III', 'IV']);

/** "DEPT OF THE ARMY" → "Dept. of the Army"; "INTERIOR, DEPARTMENT OF THE" → "Department of the Interior". */
export function formatAgencyName(raw: string | null | undefined): string | null {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s !== s.toUpperCase()) return s; // already mixed case → trust the source's casing
  // SAM inverts some department names: "INTERIOR, DEPARTMENT OF THE" → "DEPARTMENT OF THE INTERIOR".
  const inv = s.match(/^(.+?),\s*(DEPARTMENT OF(?: THE)?)$/);
  if (inv) s = `${inv[2]} ${inv[1]}`;
  return s
    .split(' ')
    .map((w, i) => {
      if (w === 'DEPT') return 'Dept.';
      const bare = w.replace(/[,;:]$/, '');
      if (ACRONYMS.has(bare)) return w;
      const lw = w.toLowerCase();
      if (i > 0 && SMALL.has(lw)) return lw;
      return lw.replace(/(^|[-/(])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
    })
    .join(' ');
}

const COUNTRY: Record<string, string> = {
  JPN: 'Japan', DEU: 'Germany', GBR: 'United Kingdom', ITA: 'Italy', KOR: 'South Korea', COL: 'Colombia',
  GTM: 'Guatemala', ESP: 'Spain', BEL: 'Belgium', BHR: 'Bahrain', KWT: 'Kuwait', QAT: 'Qatar', ARE: 'United Arab Emirates',
  POL: 'Poland', ROU: 'Romania', GRC: 'Greece', TUR: 'Turkey', PHL: 'Philippines', AUS: 'Australia', CAN: 'Canada',
  MEX: 'Mexico', DOM: 'Dominican Republic', HND: 'Honduras', SLV: 'El Salvador', PAN: 'Panama', PER: 'Peru',
  NLD: 'Netherlands', NOR: 'Norway', DNK: 'Denmark', ISL: 'Iceland', PRT: 'Portugal', DJI: 'Djibouti', KEN: 'Kenya',
  ISR: 'Israel', JOR: 'Jordan', EGY: 'Egypt', IND: 'India', THA: 'Thailand', VNM: 'Vietnam', SGP: 'Singapore',
};

function titleWord(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

/** Place of PERFORMANCE only. Never the buying office's address — that is a different fact. */
export function formatPlaceOfPerformance(row: Pick<OppShareRow, 'pop_city' | 'pop_state' | 'pop_country'>): string | null {
  const city = (row.pop_city || '').trim();
  const state = (row.pop_state || '').trim().toUpperCase();
  const country = (row.pop_country || '').trim().toUpperCase();
  const usState = /^[A-Z]{2}$/.test(state) && (!country || country === 'USA') ? state : '';
  const cityT = city ? (city === city.toUpperCase() ? titleWord(city) : city) : '';
  // City present → "Savannah, GA"; state alone → the full name (a bare "WV" on a card seen without
  // post text reads as noise). Unknown code passes through verbatim.
  if (usState) return cityT ? `${cityT}, ${usState}` : ((US_STATE_NAMES as Record<string, string>)[usState] || usState);
  if (country && country !== 'USA') {
    const cname = COUNTRY[country] || country; // unknown code passes through verbatim — never guessed
    return cityT ? `${cityT}, ${cname}` : cname;
  }
  return cityT || null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The deadline DATE as SAM issued it. SAM's raw string carries the issuing offset
 * (2026-09-29T09:00:00-04:00), so its date part is the date the buyer wrote. Converting the
 * normalized UTC column back to a date can shift the day for evening/overseas deadlines, so the
 * raw string wins; the UTC column is the fallback (rendered in UTC, where it is exact).
 */
export function deadlineParts(row: Pick<OppShareRow, 'response_deadline' | 'responseDeadLine'>): { ymd: string; ms: number } | null {
  const raw = (row.responseDeadLine || '').trim();
  const norm = (row.response_deadline || '').trim();
  const src = raw || norm;
  if (!src) return null;
  const ms = Date.parse(src);
  if (!Number.isFinite(ms)) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const ymd = m ? `${m[1]}-${m[2]}-${m[3]}` : new Date(ms).toISOString().slice(0, 10);
  return { ymd, ms };
}

export function formatYmd(ymd: string): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  return `${MONTHS[mo - 1]} ${d}, ${y}`;
}

export function buildOppShareMeta(row: OppShareRow, now: number = Date.now()): OppShareMeta {
  const title = (row.title || '').replace(/\s+/g, ' ').trim() || `Solicitation ${row.solicitation_number || row.notice_id}`;
  const dept = formatAgencyName(row.department);
  const sub = formatAgencyName(row.sub_tier);
  // Most specific verified buyer: sub-tier (Dept. of the Army), with the department when it differs.
  const buyer = sub && dept && sub !== dept ? `${sub} · ${dept}` : sub || dept || null;
  const location = formatPlaceOfPerformance(row);
  const dl = deadlineParts(row);
  const noticeType = (row.notice_type || '').trim() || null;
  const isAward = !!noticeType && /award/i.test(noticeType);
  const pastDue = !!dl && dl.ms < now;
  const archived = row.active === false || row.active === 'false';
  // Not biddable = archived on SAM, the verified deadline has passed, or it is an award notice.
  // The card must never present any of those as an open opportunity.
  const closed = archived || pastDue || isAward;
  const deadline = dl ? formatYmd(dl.ymd) : null;
  const deadlineLabel = dl ? (pastDue ? 'Responses closed' : 'Responses due') : null;
  const sol = (row.solicitation_number || '').trim() || null;

  const parts: string[] = [];
  if (buyer) parts.push(buyer);
  if (location) parts.push(`Place of performance: ${location}`);
  if (deadline) parts.push(`${deadlineLabel} ${deadline}`);
  if (sol) parts.push(`Solicitation ${sol}`);
  if (noticeType) parts.push(noticeType);
  if (archived) parts.push('Archived on SAM.gov');

  return {
    noticeId: row.notice_id,
    title: `${title} — Government Opportunity`,
    description: parts.join(' · ') || 'Federal government opportunity',
    card: { title, buyer, location, deadline, deadlineLabel, solicitation: sol, noticeType, closed },
  };
}

/** notice_ids are 32-hex; anything else (fc-…, gr-…, junk) gets no object metadata. */
export function isNoticeId(id: string | null | undefined): id is string {
  return !!id && /^[a-f0-9]{32}$/i.test(id);
}

/**
 * One-row read. Returns null for "no such notice"; THROWS on a query error (the caller decides to
 * fall back to generic metadata — but a DB error is never silently reported as "not found").
 */
export async function fetchOppShareRow(noticeId: string): Promise<OppShareRow | null> {
  if (!isNoticeId(noticeId)) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb.from('sam_opportunities').select(OPP_SHARE_COLS).eq('notice_id', noticeId.toLowerCase()).maybeSingle();
  if (error) throw new Error(`sam_opportunities share read failed: ${error.message}`);
  return (data as unknown as OppShareRow) || null;
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The server-rendered <head> block: title + canonical + OG + Twitter. */
export function renderOppShareHead(meta: OppShareMeta, origin: string): string {
  const url = `${origin}/opportunity-map?opp=${encodeURIComponent(meta.noticeId)}`;
  const img = `${origin}/opportunity-map/og/${encodeURIComponent(meta.noticeId)}`;
  const alt = [meta.card.title, meta.card.buyer].filter(Boolean).join(' — ');
  const t = escAttr(meta.title);
  const d = escAttr(meta.description.slice(0, 300));
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<link rel="canonical" href="${escAttr(url)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Mindy">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${escAttr(url)}">`,
    `<meta property="og:image" content="${escAttr(img)}">`,
    `<meta property="og:image:secure_url" content="${escAttr(img)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escAttr(alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${escAttr(img)}">`,
    `<meta name="twitter:image:alt" content="${escAttr(alt)}">`,
  ].join('');
}
