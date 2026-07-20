/**
 * MCP tool: build_pursuit_dossier — the capture package on ONE opportunity.
 *
 * Combination tool (highest-value). Paste a solicitation number / notice_id and this
 * assembles a full "should I bid + how do I win THIS one" dossier in a single call —
 * a capture manager's day of research collapsed to one deliverable. It anchors on
 * get_solicitation_incumbent (resolves the notice + likely prior award + NAICS/agency),
 * then fans out (parallel, guarded) to:
 *   solicitation docs · market depth (how crowded) · price-to-win · the named buying-
 *   office contacts · the incumbent's financial health.
 *
 * No new data engine — orchestrates existing atomic tools. Each section is GUARDED
 * (honest-miss: a failed section degrades to null, never fabricates). `_meta` always
 * ships. Credits charged by the transport. grounded=false when the solicitation
 * number resolves to nothing — never invent a notice.
 */
import { getSolicitationIncumbent } from '@/mcp/tools/solicitation-incumbent';
import { solicitationDocuments } from '@/mcp/tools/solicitation-documents';
import { assessMarketDepth } from '@/mcp/tools/market-depth';
import { getPricingIntel } from '@/mcp/tools/pricing-intel';
import { searchFederalContacts } from '@/mcp/tools/federal-contacts';
import { getIncumbentFinancials } from '@/mcp/tools/incumbent-financials';

export interface PursuitDossierInput {
  /** Solicitation number (e.g. 140L6226Q0013) OR 32-char notice UUID. */
  solicitation_number?: string;
  /** Alias for solicitation_number. */
  notice_id?: string;
  /** Optional label for the deliverable header. */
  client_name?: string;
  /** The verified MCP caller (ctx.userEmail) — never from args. */
  userEmail?: string;
}

export interface PursuitDossierResult {
  subject: string;
  opportunity: unknown | null;
  incumbent: unknown | null;
  incumbent_financials: unknown | null;
  prior_awards: unknown[];
  competition: unknown | null;
  price_to_win: unknown | null;
  buying_office_contacts: unknown[];
  documents: unknown | null;
  next_step: string;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    solicitation: string | null;
    naics: string | null;
    agency: string | null;
    incumbent_name: string | null;
    sections: { docs: boolean; competition: boolean; pricing: boolean; contacts: number; financials: boolean };
    elapsed_ms: number;
    note?: string;
  };
}

async function guarded<T>(p: Promise<T>): Promise<{ value: T | null; degraded: boolean }> {
  try {
    return { value: await p, degraded: false };
  } catch (err) {
    console.error('[build_pursuit_dossier] section failed:', err);
    return { value: null, degraded: true };
  }
}

/** Pull a field off the loosely-typed SAM notice under several possible names. */
function pick(obj: unknown, ...keys: string[]): string | undefined {
  const o = (obj ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function miss(note: string, sol: string | null, started: number): PursuitDossierResult {
  return {
    subject: 'this opportunity',
    opportunity: null, incumbent: null, incumbent_financials: null, prior_awards: [],
    competition: null, price_to_win: null, buying_office_contacts: [], documents: null,
    next_step: 'Confirm the solicitation number or paste the SAM title, then re-run.',
    _meta: {
      grounded: false, degraded: false, solicitation: sol, naics: null, agency: null,
      incumbent_name: null,
      sections: { docs: false, competition: false, pricing: false, contacts: 0, financials: false },
      elapsed_ms: Date.now() - started, note,
    },
  };
}

export async function buildPursuitDossier(input: PursuitDossierInput): Promise<PursuitDossierResult> {
  const started = Date.now();
  const sol = String(input.solicitation_number || input.notice_id || '').trim() || null;
  if (!sol) return miss('No solicitation number or notice_id provided.', null, started);

  // 1) Anchor — resolve the notice + likely incumbent (+ NAICS / agency / office).
  const anchor = await guarded(getSolicitationIncumbent({ solicitation_number: sol, notice_id: sol }));
  const a = anchor.value;
  const notice = a?.notice ?? null;
  const incumbent = a?.incumbent ?? null;
  if (!notice) {
    return miss('Solicitation number did not resolve to an open notice on SAM.', sol, started);
  }

  const naics = pick(notice, 'naics', 'naicsCode', 'naics_code');
  const agency = pick(notice, 'agency', 'department', 'subTier', 'fullParentPathName');
  const office = pick(notice, 'office', 'officeAddress', 'dodaac');
  const noticeId = pick(notice, 'notice_id', 'noticeId') || sol;
  const incumbentName = (incumbent as { recipientName?: string } | null)?.recipientName;

  // 2) Fan out — parallel, each guarded — on what the notice gave us.
  const [docs, depth, pricing, contacts, financials] = await Promise.all([
    guarded(solicitationDocuments({ notice_id: noticeId })),
    naics ? guarded(assessMarketDepth({ naics })) : Promise.resolve({ value: null, degraded: false as boolean }),
    naics ? guarded(getPricingIntel({ naics })) : Promise.resolve({ value: null, degraded: false as boolean }),
    agency || office
      ? guarded(searchFederalContacts({ agency, office, limit: 10 }))
      : Promise.resolve({ value: null, degraded: false as boolean }),
    incumbentName
      ? guarded(getIncumbentFinancials({ company_name: incumbentName }))
      : Promise.resolve({ value: null, degraded: false as boolean }),
  ]);

  const degraded = [anchor, docs, depth, pricing, contacts, financials].some((s) => s.degraded);
  const contactRows = (contacts.value as { contacts?: unknown[] } | null)?.contacts ?? [];

  return {
    subject: input.client_name || pick(notice, 'title') || `Solicitation ${sol}`,
    opportunity: notice,
    incumbent,
    incumbent_financials: financials.value,
    prior_awards: a?.prior_awards ?? [],
    competition: depth.value,
    price_to_win: pricing.value,
    buying_office_contacts: contactRows,
    documents: docs.value,
    next_step:
      'Run evaluate_bid_decision with your read on the 5 gates, then extract_compliance_matrix to start the response.',
    _meta: {
      grounded: true,
      degraded,
      solicitation: sol,
      naics: naics ?? null,
      agency: agency ?? null,
      incumbent_name: incumbentName ?? null,
      sections: {
        docs: !!docs.value,
        competition: !!depth.value,
        pricing: !!pricing.value,
        contacts: contactRows.length,
        financials: !!financials.value,
      },
      elapsed_ms: Date.now() - started,
    },
  };
}
