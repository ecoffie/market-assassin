/**
 * "Already awarded to you" — FLAG (never hide) a forecast that an award already made to the
 * requesting company exactly matches. Company-anchored FIND only (input.uei).
 *
 * WHY (production, 2026-11-23). FIND / generate_market_report for RBA Engineering (UEI
 * C9K6EE9JVDK7) listed FHWA forecast "VA ST FB KNGMN-WLKR GTS" as upcoming demand. RBA already
 * holds it: award 693C7326C000017, $7,180,000, action 2026-08-14, FHWA Eastern Federal Lands,
 * description "PROJECT VA ST FB KNGMN-WLKR GTS ...". Telling a company its own award is a
 * pipeline lead is wrong; hiding the row would be wrong too (the forecast is real, and the
 * match is our claim) — so it is labelled.
 *
 * THE EXACT RULE (no similarity, no scoring). A forecast is "already awarded to you" when ONE
 * of the company's award actions satisfies BOTH:
 *   1. SAME DEPARTMENT — the award's awarding_agency maps to the forecast's source_agency code
 *      through gatewayAgencyCode (the Gateway ingest's own department→code map: "Department of
 *      Transportation" → DOT), or equals the forecast's department text.
 *   2. SAME PROJECT IDENTIFIER — the award description, uppercased with whitespace collapsed,
 *      BEGINS with the literal label `PROJECT ` followed by the ENTIRE forecast title (same
 *      normalisation), and the next character is the end of the text or not a letter/digit.
 *      The title must be the whole identifier: `PROJECT VA ST FB KNGMN-WLKR GTS2` does not match
 *      `VA ST FB KNGMN-WLKR GTS`, and a title merely appearing mid-description never matches.
 *
 * Both sides carry this today: the forecast title (FHWA publishes its project name as the
 * title) and the award description written by the same contracting office. The forecast's
 * listing id (FHWA-2026-167) is NOT on the award, so there is no shared id; the anchored
 * `PROJECT <title>` label is the only exact key and is used only where it is literally present.
 *
 * WHAT IT DOES NOT SAY. Awards checked = the company's most recent dollar-bearing award actions
 * the shared UEI history service serves (warm cache only on FIND's path — no live BigQuery).
 * No flag means "no match among the awards checked", never "not awarded to you".
 */
import { gatewayAgencyCode } from '@/lib/forecasts/gateway-forecast';
import { getContractorHistoryByUei } from '@/lib/contractor/history-by-uei';
import { GENERIC_SINGLE_WORDS } from '@/lib/market/keyword-sanitize';

export interface CompanyAwardAction {
  award_id: string | null;
  piid: string | null;
  description: string | null;
  awarding_agency: string | null;
  awarding_office: string | null;
  action_date: string | null;
  amount: number | null;
}

export interface CompanyAwardsResult {
  status: 'checked' | 'unavailable';
  awards: CompanyAwardAction[];
  /** Plain-English scope of what was checked, or why nothing was. */
  note: string;
}

/** Test seam. Production: the shared UEI history service, warm cache only. */
export type CompanyAwardsLookup = (uei: string) => Promise<CompanyAwardsResult>;

export interface AlreadyAwardedFlag {
  piid: string | null;
  award_id: string | null;
  action_date: string | null;
  awarding_office: string | null;
  amount: number | null;
  /** Ready to show: "already awarded to you (693C7326C000017, 2026-08-14)". */
  label: string;
  rule: typeof ALREADY_AWARDED_RULE;
}

export const ALREADY_AWARDED_RULE =
  'exact: same department AND the award description begins "PROJECT <entire forecast title>"' as const;

const PROJECT_LABEL = 'PROJECT ';

const canon = (v: unknown): string => String(v ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * A false "already awarded to you" tells a customer they won work they did not — worse than missing the flag
 * (Agent 4 review 2026-11-23). So the rule applies only to a SPECIFIC forecast title: at least 3 tokens AND at
 * least one token that is not a generic federal word. Generic = the shared GENERIC_SINGLE_WORDS stoplist plus
 * the construction/vehicle words it lacks. "Road Maintenance" or "Construction Services" never qualify, even
 * when an award reads "PROJECT ROAD MAINTENANCE …"; "VA ST FB KNGMN-WLKR GTS" does.
 */
const EXTRA_GENERIC = new Set([
  'road', 'roads', 'roadway', 'roadways', 'highway', 'highways', 'street', 'streets', 'bridge', 'bridges',
  'pavement', 'paving', 'idiq', 'idc', 'matoc', 'satoc', 'macc', 'bpa', 'contract', 'contracts', 'task', 'order',
  'and', 'of', 'the', 'for', 'at', 'in', 'on', 'to', 'a', 'an', 'various', 'misc', 'miscellaneous', 'phase', 'base',
]);
export function isSpecificForecastTitle(forecastTitle: unknown): boolean {
  const tokens = String(forecastTitle ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length < 3) return false;
  return tokens.some((t) => !GENERIC_SINGLE_WORDS.has(t) && !EXTRA_GENERIC.has(t));
}

/** Rule 2: the award description's leading project identifier IS the (specific) forecast title. */
export function awardNamesForecastProject(forecastTitle: unknown, awardDescription: unknown): boolean {
  if (!isSpecificForecastTitle(forecastTitle)) return false;
  const title = canon(forecastTitle);
  if (!title) return false;
  const desc = canon(awardDescription);
  const head = PROJECT_LABEL + title;
  if (!desc.startsWith(head)) return false;
  const next = desc.charAt(head.length);
  return next === '' || !/[A-Z0-9]/.test(next);
}

/** Rule 1: the award was made by the forecast's department. */
export function sameDepartment(
  forecast: { source_agency?: string | null; department?: string | null },
  awardingAgency: unknown,
): boolean {
  const agency = String(awardingAgency ?? '').trim();
  if (!agency) return false;
  const code = String(forecast.source_agency ?? '').trim().toUpperCase();
  if (code && gatewayAgencyCode(agency).toUpperCase() === code) return true;
  const dept = canon(forecast.department);
  return Boolean(dept) && dept === canon(agency);
}

/**
 * The company's award that exactly matches this forecast, or null. Among several actions of the
 * matching award(s), the EARLIEST action date is reported (closest to the award itself).
 */
export function alreadyAwardedFlag(
  forecast: { title?: string | null; source_agency?: string | null; department?: string | null },
  awards: CompanyAwardAction[],
): AlreadyAwardedFlag | null {
  const hits = awards.filter(
    (a) => sameDepartment(forecast, a.awarding_agency) && awardNamesForecastProject(forecast.title, a.description),
  );
  if (!hits.length) return null;
  const first = [...hits].sort((x, y) => String(x.action_date ?? '9999').localeCompare(String(y.action_date ?? '9999')))[0];
  const ref = first.piid || first.award_id || 'award id not published';
  return {
    piid: first.piid,
    award_id: first.award_id,
    action_date: first.action_date,
    awarding_office: first.awarding_office,
    amount: first.amount,
    label: `already awarded to you (${ref}${first.action_date ? `, ${first.action_date}` : ''})`,
    rule: ALREADY_AWARDED_RULE,
  };
}

/** Production lookup: warm UEI history only (coldPolicy 'never' — FIND adds no BigQuery spend). */
export const warmCompanyAwardsLookup: CompanyAwardsLookup = async (uei) => {
  try {
    const r = await getContractorHistoryByUei({ uei, coldPolicy: 'never' });
    const recent = r.history?.recentAwards ?? [];
    if (r.resolution === 'registered_zero') {
      return { status: 'checked', awards: [], note: 'The award warehouse holds no awards for this UEI.' };
    }
    if (r.resolution !== 'found' || !r.history) {
      return { status: 'unavailable', awards: [], note: `Award history not available from cache (${r.resolution}). Not checked — not "no awards".` };
    }
    if (r.history.enrichment_status === 'budget_limited' && !recent.length) {
      return { status: 'unavailable', awards: [], note: 'Recent award detail not cached for this UEI. Not checked — not "no awards".' };
    }
    return {
      status: 'checked',
      awards: recent.map((a) => ({
        award_id: a.id ?? null,
        piid: a.piid ?? null,
        description: a.title ?? null,
        awarding_agency: a.agency && a.agency !== '—' ? a.agency : null,
        awarding_office: a.subAgency ?? null,
        action_date: a.actionDate ?? null,
        amount: Number.isFinite(a.amount) ? a.amount : null,
      })),
      note: `Checked the company's ${recent.length} most recent dollar-bearing award actions in the award warehouse. No flag means no match among these — not "never awarded".`,
    };
  } catch (e) {
    return { status: 'unavailable', awards: [], note: `Award history lookup failed (${(e as Error).message}). Not checked.` };
  }
};
