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
import {
  extractPackageNamedContacts,
  dedupeAgainstPackage,
} from '@/lib/gov-contacts/package-named-contacts';
import { getIncumbentFinancials } from '@/mcp/tools/incumbent-financials';

/** Inline doc text cap inside the dossier — full text is via get_solicitation_documents. */
const DOSSIER_DOC_TEXT_CAP = 1_500;

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

export interface PursuitDossierOmitted {
  competition_businesses_omitted: number;
  competition_businesses_returned: number;
  competition_businesses_available: number;
  document_text_chars_omitted: number;
  document_text_chars_returned: number;
  note: string;
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
    grounded_incumbent: boolean;
    sections: { docs: boolean; competition: boolean; pricing: boolean; contacts: number; financials: boolean };
    elapsed_ms: number;
    omitted: PursuitDossierOmitted | null;
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

function slimDocuments(docs: unknown): { slimmed: unknown; charsReturned: number; charsOmitted: number } {
  if (!docs || typeof docs !== 'object') {
    return { slimmed: docs, charsReturned: 0, charsOmitted: 0 };
  }
  const d = docs as {
    description?: string;
    sow_text?: string;
    documents?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  };
  let charsReturned = 0;
  let charsOmitted = 0;

  const capField = (text: string | undefined): string => {
    const s = text || '';
    if (s.length <= DOSSIER_DOC_TEXT_CAP) {
      charsReturned += s.length;
      return s;
    }
    charsReturned += DOSSIER_DOC_TEXT_CAP;
    charsOmitted += s.length - DOSSIER_DOC_TEXT_CAP;
    return `${s.slice(0, DOSSIER_DOC_TEXT_CAP)}\n…[truncated in dossier — call get_solicitation_documents for full text]`;
  };

  const slimDocs = (d.documents || []).map((doc) => {
    const full = String(doc.extracted_text || '');
    const capped = capField(full);
    return {
      ...doc,
      extracted_text: capped,
      extracted_text_truncated: full.length > DOSSIER_DOC_TEXT_CAP || Boolean(doc.extracted_text_truncated),
    };
  });

  return {
    slimmed: {
      ...d,
      description: capField(d.description),
      sow_text: capField(d.sow_text),
      documents: slimDocs,
    },
    charsReturned,
    charsOmitted,
  };
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
      grounded_incumbent: false,
      sections: { docs: false, competition: false, pricing: false, contacts: 0, financials: false },
      elapsed_ms: Date.now() - started,
      omitted: null,
      note,
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
  const groundedIncumbent = a?._meta?.grounded_incumbent === true;
  if (!notice) {
    return miss('Solicitation identifier did not resolve to a stored notice.', sol, started);
  }

  const naics = pick(notice, 'naics', 'naicsCode', 'naics_code');
  const agency = pick(notice, 'agency', 'department', 'subTier', 'fullParentPathName');
  const office = pick(notice, 'office', 'officeAddress', 'dodaac');
  const noticeId = pick(notice, 'notice_id', 'noticeId') || sol;
  const namedIncumbentRow = groundedIncumbent ? incumbent : null;
  const incumbentName = (namedIncumbentRow as { recipientName?: string } | null)?.recipientName;

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

  // ── CONTACT: the people named in THIS solicitation outrank the directory ──
  // Measured on 36C24226Q0857: the CO (Michael.Spivack@va.gov) is named 8x in
  // the package and appeared in NONE of the 10 directory contacts, which listed
  // unrelated national VA staff. The package was already fetched above for the
  // documents section, so this reads that text rather than adding a lookup.
  // The directory is KEPT as fallback/enrichment, deduped by email.
  const docsValue = docs.value as {
    description?: string;
    sow_text?: string;
    documents?: { extracted_text?: string }[];
  } | null;
  const packageText = [
    docsValue?.sow_text ?? '',
    docsValue?.description ?? '',
    ...(docsValue?.documents ?? []).map((d) => d.extracted_text ?? ''),
  ].join('\n');
  const packageContacts = extractPackageNamedContacts(packageText);
  const directoryRows = (contacts.value as { contacts?: Record<string, unknown>[] } | null)?.contacts ?? [];
  const contactRows: unknown[] = [
    ...packageContacts,
    ...dedupeAgainstPackage(directoryRows, packageContacts),
  ];

  const depthMeta = (depth.value as {
    _meta?: { businesses_returned?: number; businesses_available?: number };
    businesses?: unknown[];
  } | null)?._meta;
  const businessesReturned = depthMeta?.businesses_returned ??
    ((depth.value as { businesses?: unknown[] } | null)?.businesses?.length ?? 0);
  const businessesAvailable = depthMeta?.businesses_available ?? businessesReturned;
  const competitionOmitted = Math.max(0, businessesAvailable - businessesReturned);

  const { slimmed: slimDocs, charsReturned, charsOmitted } = slimDocuments(docs.value);

  const omitted: PursuitDossierOmitted | null =
    competitionOmitted > 0 || charsOmitted > 0
      ? {
          competition_businesses_omitted: competitionOmitted,
          competition_businesses_returned: businessesReturned,
          competition_businesses_available: businessesAvailable,
          document_text_chars_omitted: charsOmitted,
          document_text_chars_returned: charsReturned,
          note:
            competitionOmitted > 0 || charsOmitted > 0
              ? 'Dossier omits records for size. competition lists a capped firm sample — call assess_market_depth for the full scored list. Document bodies are truncated here — call get_solicitation_documents for full attachment text.'
              : 'No records omitted.',
        }
      : {
          competition_businesses_omitted: 0,
          competition_businesses_returned: businessesReturned,
          competition_businesses_available: businessesAvailable,
          document_text_chars_omitted: 0,
          document_text_chars_returned: charsReturned,
          note: 'No competition or document-text records omitted from this dossier payload.',
        };

  return {
    subject: input.client_name || pick(notice, 'title') || `Solicitation ${sol}`,
    opportunity: notice,
    incumbent: namedIncumbentRow,
    incumbent_financials: financials.value,
    prior_awards: a?.prior_awards ?? [],
    competition: depth.value,
    price_to_win: pricing.value,
    buying_office_contacts: contactRows,
    documents: slimDocs,
    // ── ACTION: only recommend a handoff whose output is verified ──────────
    // extract_compliance_matrix was REMOVED from this recommendation. Measured
    // on 36C24226Q0857: 9 of 72 requirement rows carried a source_quote that
    // does not appear anywhere in the 257,674-char package, and 4 rows cited a
    // "Section L" the package does not contain. Most rows are sound, but the
    // dossier told the customer to "start the response" from it as if it were
    // verified. Recommending an unverified extractor is how a fabricated
    // requirement reaches a proposal. It stays available as its own tool; it is
    // not steered into from here until it has its own acceptance standard.
    next_step: packageContacts.length
      ? `Run evaluate_bid_decision with your read on the 5 gates, then contact ${
          packageContacts[0].contact_fullname ?? packageContacts[0].contact_email
        }${packageContacts[0].contact_title ? ` (${packageContacts[0].contact_title})` : ''} — named in the solicitation — before the deadline.`
      : 'Run evaluate_bid_decision with your read on the 5 gates, then read the solicitation documents above and confirm the submission requirements directly against the package.',
    _meta: {
      grounded: true,
      degraded,
      solicitation: sol,
      naics: naics ?? null,
      agency: agency ?? null,
      incumbent_name: incumbentName ?? null,
      grounded_incumbent: groundedIncumbent,
      sections: {
        docs: !!docs.value,
        competition: !!depth.value,
        pricing: !!pricing.value,
        contacts: contactRows.length,
        financials: !!financials.value,
      },
      elapsed_ms: Date.now() - started,
      omitted,
    },
  };
}
