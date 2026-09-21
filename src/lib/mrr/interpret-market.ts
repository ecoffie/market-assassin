/**
 * Plain-language market intake → a confirmable MarketScope.
 *
 * The operator types one question. Offices and buyers are resolved from existing
 * Mindy directories. Keyword coverage MEASURES a NAICS/PSC distribution; it does
 * not establish market identity. Load-bearing uncertainty asks ONE clarification.
 * Nothing is guessed.
 */
import { createClient } from '@supabase/supabase-js';
import { DLA_DODAAC_LOCATIONS } from '@/data/dla-dodaac-locations';
import {
  dodaacCodesForOfficeName,
  loadDodaacDirectory,
} from '@/lib/gov-contacts/dodaac-directory';
import { resolveCommand } from '@/lib/gov-contacts/commands';
import { resolveOperationalCustomer } from '@/lib/gov-identity/operational-customer';
import { queryKeywordCoverage, type KeywordCoverage } from '@/lib/market/keyword-coverage';
import { geographyDisplayName, normalizeStateCode } from '@/lib/utils/us-states';
export { geographyDisplayName };
import { extractDodaac } from './market-scope';
import type { Requirement } from './types';

export type ClarificationDimension = 'office' | 'buyer' | 'requirement' | 'geography';

export interface OfficeCandidate {
  dodaac: string;
  officeName: string;
  subAgency: string | null;
  city?: string | null;
  state?: string | null;
  noticeCount?: number;
  source: 'dodaac_directory' | 'sam_office_address' | 'dla_office_locations';
}

export interface CoverageSnapshot {
  keyword: string;
  /** Measured dollar-lead / name-matched candidate. Display only — not confirmation identity. */
  leadNaics?: { code: string; name: string };
  /** Measured top PSC. Display only — not confirmation identity. */
  topPsc?: { code: string; name: string };
}

export interface InterpretLookups {
  searchOfficesByName(query: string): Promise<OfficeCandidate[]>;
  searchOfficesAtInstallation(place: string): Promise<OfficeCandidate[]>;
  coverageFor(keyword: string): Promise<CoverageSnapshot | null>;
}

export interface MarketConfirmation {
  buyerDepartment?: string;
  service?: string;
  installation?: string;
  contractingOffice?: string;
  contractingOfficeCode?: string;
  requirementLabel: string;
  geography?: string;
  naics?: string;
  psc?: string;
  keyword: string;
}

export interface InterpretClarification {
  dimension: ClarificationDimension;
  prompt: string;
  options?: Array<{ id: string; label: string }>;
}

export interface InterpretMarketResult {
  status: 'ready' | 'needs_clarification';
  question: string;
  confirmation?: MarketConfirmation;
  intake?: Requirement;
  clarification?: InterpretClarification;
  unresolved: string[];
}

export interface InterpretMarketInput {
  question: string;
  clarification?: { dimension: ClarificationDimension; value: string };
}

const FILLER =
  /\b(i want to|i'd like to|i need to|please|understand|research|the small-business market|small business market|small-business|small business|market for|awarded by|performance)\b/gi;

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractGeography(question: string): string | undefined {
  const named = question.match(
    /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia|Puerto Rico|Guam)\b/i,
  );
  if (named) return normalizeStateCode(named[1]) ?? undefined;
  const forState = question.match(/\bfor\s+([A-Z]{2})\s+performance\b/i);
  if (forState) return normalizeStateCode(forState[1]) ?? undefined;
  const inState = question.match(/\bin\s+([A-Z]{2})\b/);
  if (inState) return normalizeStateCode(inState[1]) ?? undefined;
  return undefined;
}

function extractPlace(question: string): string | undefined {
  const at = question.match(/\bat\s+(.+?)(?:[.?!]|$)/i);
  if (!at) return undefined;
  let place = at[1];
  place = place.replace(/\b(awarded by|for)\b.+$/i, '');
  place = place.replace(/\bperformance\b.*$/i, '');
  place = clean(place);
  return place || undefined;
}

function extractBuyerPhrase(question: string): string | undefined {
  const awarded = question.match(/\bawarded by\s+(.+?)(?:[.?!]|$)/i);
  if (awarded) {
    return clean(awarded[1].replace(/\bfor\b.+$/i, ''));
  }
  const cmd = resolveCommand(question);
  if (cmd) {
    const hq = /\b(hq|headquarters)\b/i.test(question) ? ' HQ' : '';
    const extra = question.match(/\b(aviation|land|troop support|energy|maritime)\b/i);
    if (extra) return clean(`${cmd.name} ${extra[1]}`);
    return clean(`${cmd.key}${hq}`);
  }
  return undefined;
}

function extractKeyword(question: string): string | undefined {
  if (/\bSABER\b/i.test(question)) return 'SABER';
  const forClause = question.match(
    /\bfor\s+(.+?)\s+(?:at|awarded by|in|for [A-Z]{2} performance)\b/i,
  );
  if (forClause) {
    const phrase = clean(forClause[1].replace(FILLER, ' '));
    return phrase || undefined;
  }
  const stripped = clean(
    question
      .replace(FILLER, ' ')
      .replace(/\bat\s+.+$/i, '')
      .replace(/\bawarded by\s+.+$/i, '')
      .replace(/[?.!]/g, ''),
  );
  return stripped.length >= 3 ? stripped : undefined;
}

function wantsHeadquarters(question: string): boolean {
  return /\b(hq|headquarters)\b/i.test(question);
}

function isConstructionPhrase(keyword: string): boolean {
  return /\b(saber|construction|facilities|repair|renovation|building)\b/i.test(keyword);
}

function departmentFromSubAgency(sub: string | null | undefined): string | undefined {
  if (!sub) return undefined;
  const u = sub.toUpperCase();
  if (/AIR FORCE|SPACE FORCE/.test(u)) return 'Department of the Air Force';
  if (/\bNAVY\b|NAVAL/.test(u)) return 'Department of the Navy';
  if (/\bARMY\b/.test(u)) return 'Department of the Army';
  if (/DEFENSE LOGISTICS|\bDLA\b/.test(u)) return 'Defense Logistics Agency';
  if (/VETERANS/.test(u)) return 'Department of Veterans Affairs';
  if (/DEFENSE HEALTH|\bDHA\b/.test(u)) return 'Defense Health Agency';
  return clean(sub);
}

function uniqueOffices(hits: OfficeCandidate[]): OfficeCandidate[] {
  const map = new Map<string, OfficeCandidate>();
  for (const hit of hits) {
    const key = hit.dodaac.toUpperCase();
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || (hit.noticeCount ?? 0) > (prev.noticeCount ?? 0)) {
      map.set(key, { ...hit, dodaac: key });
    }
  }
  return [...map.values()];
}

function applyHqFilter(question: string, hits: OfficeCandidate[]): OfficeCandidate[] {
  if (!wantsHeadquarters(question) || hits.length <= 1) return hits;
  const hq = hits.filter((hit) => /\b(hq|headquarters)\b/i.test(hit.officeName));
  return hq.length > 0 ? hq : hits;
}

function applyConstructionConsFilter(
  keyword: string,
  hits: OfficeCandidate[],
): OfficeCandidate[] {
  if (!isConstructionPhrase(keyword) || hits.length <= 1) return hits;
  const cons = hits.filter((hit) => /\bCONS\b/i.test(hit.officeName));
  return cons.length === 1 ? cons : hits;
}

function shouldExpandCommand(query: string): boolean {
  const cmd = resolveCommand(query);
  if (!cmd) return false;
  let leftover = query.toLowerCase();
  leftover = leftover.replace(cmd.key.toLowerCase(), ' ');
  leftover = leftover.replace(cmd.name.toLowerCase(), ' ');
  for (const alias of cmd.aliases) leftover = leftover.replace(alias, ' ');
  leftover = leftover.replace(/\b(hq|headquarters|command)\b/g, ' ');
  leftover = leftover.replace(/[^a-z0-9]+/g, '');
  return leftover.length < 3;
}

const GENERIC_NAICS_TOKENS = new Set([
  'products',
  'product',
  'services',
  'service',
  'type',
  'work',
  'market',
  'small',
  'business',
  'other',
  'miscellaneous',
  'general',
]);

/** Label a measured coverage candidate. Not market identity — do not write onto confirmation. */
export function selectCoverageNaics(
  keyword: string,
  candidates: Array<{ code: string; name: string }>,
): { code: string; name: string } | undefined {
  if (candidates.length === 0) return undefined;
  const tokens = keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !GENERIC_NAICS_TOKENS.has(token));
  if (tokens.length === 0) {
    return { code: candidates[0]!.code, name: candidates[0]!.name };
  }
  const scored = candidates.map((row, index) => {
    const name = row.name.toLowerCase();
    const hits = tokens.filter((token) => name.includes(token)).length;
    return { row, hits, index };
  });
  scored.sort((a, b) => b.hits - a.hits || a.index - b.index);
  const best = scored[0]!;
  return { code: best.row.code, name: best.row.name };
}

export function coverageSnapshotFromKeywordCoverage(
  coverage: KeywordCoverage | null,
): CoverageSnapshot | null {
  if (!coverage) return null;
  const lead = selectCoverageNaics(coverage.keyword, coverage.allNaics);
  return {
    keyword: coverage.keyword,
    ...(lead ? { leadNaics: { code: lead.code, name: lead.name } } : {}),
    ...(coverage.topPsc
      ? { topPsc: { code: coverage.topPsc.code, name: coverage.topPsc.name } }
      : {}),
  };
}

export async function defaultInterpretLookups(): Promise<InterpretLookups> {
  return {
    async searchOfficesByName(query: string): Promise<OfficeCandidate[]> {
      const q = clean(query);
      if (q.length < 3) return [];
      const dir = await loadDodaacDirectory();
      const hits: OfficeCandidate[] = [];
      const needle = q.toUpperCase();
      for (const [dodaac, info] of dir) {
        const name = (info.officeName || '').toUpperCase();
        if (!name) continue;
        if (name.includes(needle) || needle.includes(name)) {
          hits.push({
            dodaac,
            officeName: info.officeName || dodaac,
            subAgency: info.subAgency,
            source: 'dodaac_directory',
          });
        }
      }
      if (shouldExpandCommand(q)) {
        const codes = await dodaacCodesForOfficeName(q);
        for (const code of codes) {
          const info = dir.get(code.toUpperCase());
          hits.push({
            dodaac: code.toUpperCase(),
            officeName: info?.officeName || code,
            subAgency: info?.subAgency ?? null,
            source: 'dodaac_directory',
          });
        }
      }
      const aviation = /\baviation\b/i.test(q);
      if (aviation) {
        for (const [dodaac, loc] of Object.entries(DLA_DODAAC_LOCATIONS)) {
          if (!/AVIATION/i.test(loc.office)) continue;
          hits.push({
            dodaac,
            officeName: loc.office,
            subAgency: 'Defense Logistics Agency',
            city: loc.city,
            state: loc.state,
            source: 'dla_office_locations',
          });
        }
      }
      return uniqueOffices(hits);
    },

    async searchOfficesAtInstallation(place: string): Promise<OfficeCandidate[]> {
      const token = clean(place).replace(/\b(space force base|air force base|sfb|afb|base)\b/gi, '').trim();
      const search = token.split(/\s+/)[0];
      if (!search || search.length < 4) return [];
      const client = sb();
      const { data, error } = await client
        .from('sam_opportunities')
        .select('solicitation_number, office, office_address')
        .ilike('office_address->>city', `%${search}%`)
        .not('solicitation_number', 'is', null)
        .limit(500);
      if (error) {
        console.error('[interpret-market] installation office lookup failed', error.message);
        return [];
      }
      const dir = await loadDodaacDirectory();
      const counts = new Map<string, OfficeCandidate>();
      for (const row of data ?? []) {
        const sol = typeof row.solicitation_number === 'string' ? row.solicitation_number : '';
        const dodaac = extractDodaac(sol);
        if (!dodaac) continue;
        const addr =
          row.office_address && typeof row.office_address === 'object'
            ? (row.office_address as Record<string, unknown>)
            : {};
        const city = typeof addr.city === 'string' ? addr.city : null;
        const state = typeof addr.state === 'string' ? addr.state : null;
        const info = dir.get(dodaac);
        const prev = counts.get(dodaac);
        counts.set(dodaac, {
          dodaac,
          officeName: info?.officeName || (typeof row.office === 'string' ? row.office : dodaac),
          subAgency: info?.subAgency ?? null,
          city,
          state,
          noticeCount: (prev?.noticeCount ?? 0) + 1,
          source: 'sam_office_address',
        });
      }
      return [...counts.values()].sort((a, b) => (b.noticeCount ?? 0) - (a.noticeCount ?? 0));
    },

    async coverageFor(keyword: string): Promise<CoverageSnapshot | null> {
      const result = await queryKeywordCoverage(keyword);
      if (result.status !== 'MARKET_EVIDENCE_FOUND') return null;
      return coverageSnapshotFromKeywordCoverage(result.coverage);
    },
  };
}

function officeLabel(hit: OfficeCandidate): string {
  return hit.officeName.replace(new RegExp(`^${hit.dodaac}\\s+`, 'i'), '').trim() || hit.officeName;
}

function buildConfirmation(args: {
  question: string;
  keyword: string;
  office: OfficeCandidate;
  installation?: string;
  geography?: string;
}): MarketConfirmation {
  const operational = resolveOperationalCustomer({
    subTier: args.office.subAgency,
    officeAddressCity: args.office.city ?? args.installation ?? null,
    contractingOfficeName: args.office.officeName,
    dodaac: args.office.dodaac,
  });
  const buyerDepartment =
    departmentFromSubAgency(args.office.subAgency) ||
    operational.administrative.department ||
    undefined;
  const service =
    operational.operational.component ||
    (buyerDepartment === 'Department of the Navy' ? 'United States Navy' : undefined);
  const installationFromPlace =
    args.installation && !resolveCommand(args.installation) ? args.installation : undefined;
  const installationFromCity = args.office.city || undefined;
  const operationalPlace = operational.operational.installation;
  const installation =
    installationFromPlace ||
    installationFromCity ||
    (operationalPlace &&
    operationalPlace.toUpperCase() !== args.office.officeName.toUpperCase() &&
    !resolveCommand(operationalPlace)
      ? operationalPlace.replace(/\bSFB\b/i, 'Space Force Base')
      : undefined);

  const geography =
    args.geography ||
    (args.office.state ? normalizeStateCode(args.office.state) ?? undefined : undefined);

  return {
    ...(buyerDepartment ? { buyerDepartment } : {}),
    ...(service ? { service } : {}),
    ...(installation
      ? { installation: installation.replace(/\bSFB\b/i, 'Space Force Base') }
      : {}),
    contractingOffice: officeLabel(args.office),
    contractingOfficeCode: args.office.dodaac,
    requirementLabel: args.keyword,
    ...(geography ? { geography } : {}),
    keyword: args.keyword,
  };
}

export function confirmationToRequirement(
  question: string,
  confirmation: MarketConfirmation,
): Requirement {
  const office = [confirmation.contractingOfficeCode, confirmation.contractingOffice]
    .filter(Boolean)
    .join(' ');
  return {
    title: clean(question),
    agency: confirmation.buyerDepartment || 'Unknown buyer',
    keyword: confirmation.keyword,
    description: clean(question),
    ...(confirmation.service ? { sub_agency: confirmation.service } : {}),
    ...(office ? { office } : {}),
    ...(confirmation.installation ? { installation: confirmation.installation } : {}),
    ...(confirmation.naics ? { naics: confirmation.naics } : {}),
    ...(confirmation.psc ? { psc: confirmation.psc } : {}),
    ...(confirmation.geography ? { place_of_performance_state: confirmation.geography } : {}),
  };
}

function rankOfficeOptions(hits: OfficeCandidate[]): OfficeCandidate[] {
  const locationRank = new Set(Object.keys(DLA_DODAAC_LOCATIONS));
  return [...hits].sort((a, b) => {
    const aLoc = locationRank.has(a.dodaac) ? 0 : 1;
    const bLoc = locationRank.has(b.dodaac) ? 0 : 1;
    if (aLoc !== bLoc) return aLoc - bLoc;
    const aNotices = a.noticeCount ?? 0;
    const bNotices = b.noticeCount ?? 0;
    if (aNotices !== bNotices) return bNotices - aNotices;
    return a.dodaac.localeCompare(b.dodaac);
  });
}

function pickClarifiedOffice(
  options: OfficeCandidate[],
  value: string,
): OfficeCandidate | undefined {
  const needle = value.trim().toUpperCase();
  return options.find(
    (hit) =>
      hit.dodaac.toUpperCase() === needle ||
      officeLabel(hit).toUpperCase() === needle ||
      hit.officeName.toUpperCase() === needle,
  );
}

export async function interpretMarketQuestion(
  input: InterpretMarketInput,
  lookups?: InterpretLookups,
): Promise<InterpretMarketResult> {
  const question = clean(input.question);
  const unresolved: string[] = [];
  if (question.length < 8) {
    return {
      status: 'needs_clarification',
      question,
      clarification: {
        dimension: 'requirement',
        prompt: 'What market are you researching? Name the work and the buyer or location.',
      },
      unresolved: ['question too short to resolve a market'],
    };
  }

  const live = lookups ?? (await defaultInterpretLookups());
  const keyword = extractKeyword(question);
  const place = extractPlace(question);
  const buyer = extractBuyerPhrase(question);
  const geographyFromText = extractGeography(question);

  if (!keyword) {
    return {
      status: 'needs_clarification',
      question,
      clarification: {
        dimension: 'requirement',
        prompt: 'What requirement or category should Ralph research? For example, SABER-type construction or shipbuilding.',
      },
      unresolved: ['requirement phrase was not established'],
    };
  }

  const nameQueries = [buyer, place].filter((value): value is string => Boolean(value));
  const namedHits = uniqueOffices(
    (await Promise.all(nameQueries.map((query) => live.searchOfficesByName(query)))).flat(),
  );
  const placeLooksLikeCommand = Boolean(place && resolveCommand(place));
  const installationHits =
    place && !placeLooksLikeCommand ? await live.searchOfficesAtInstallation(place) : [];

  let offices = uniqueOffices(
    namedHits.length && installationHits.length
      ? namedHits.filter((hit) => installationHits.some((inst) => inst.dodaac === hit.dodaac)).length
        ? namedHits.filter((hit) => installationHits.some((inst) => inst.dodaac === hit.dodaac))
        : [...namedHits, ...installationHits]
      : namedHits.length
        ? namedHits
        : installationHits,
  );

  if (installationHits.length && !namedHits.length) {
    offices = installationHits;
  }

  offices = applyHqFilter(question, offices);
  offices = applyConstructionConsFilter(keyword, offices);

  if (input.clarification?.dimension === 'office' && input.clarification.value) {
    const chosen = pickClarifiedOffice(offices.length ? offices : [...namedHits, ...installationHits], input.clarification.value);
    if (chosen) offices = [chosen];
  }

  if (offices.length === 0) {
    unresolved.push('contracting office was not established from the question');
    return {
      status: 'needs_clarification',
      question,
      clarification: {
        dimension: 'buyer',
        prompt:
          'Which buyer or contracting office should Ralph research? Name the command, installation, or office.',
      },
      unresolved,
    };
  }

  if (offices.length > 1) {
    return {
      status: 'needs_clarification',
      question,
      clarification: {
        dimension: 'office',
        prompt: 'Which contracting office should Ralph research? Ralph will not guess among these offices.',
        options: rankOfficeOptions(offices).map((hit) => ({
          id: hit.dodaac,
          label: `${officeLabel(hit)} (${hit.dodaac})`,
        })),
      },
      unresolved: ['multiple contracting offices matched; office is load-bearing'],
    };
  }

  const office = offices[0]!;
  const installation =
    place && !placeLooksLikeCommand
      ? place
      : office.city || undefined;
  const confirmation = buildConfirmation({
    question,
    keyword,
    office,
    installation,
    geography: geographyFromText,
  });

  if (!confirmation.buyerDepartment) {
    unresolved.push('buyer / department was not established');
    return {
      status: 'needs_clarification',
      question,
      clarification: {
        dimension: 'buyer',
        prompt: 'Which department or buyer owns this market? Ralph will not guess the buyer.',
      },
      unresolved,
    };
  }

  return {
    status: 'ready',
    question,
    confirmation,
    intake: confirmationToRequirement(question, confirmation),
    unresolved,
  };
}
