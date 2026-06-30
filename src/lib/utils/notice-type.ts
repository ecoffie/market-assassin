/**
 * SAM.gov notice-type classification — single source of truth.
 *
 * SAM's free-text `notice_type` drives two things in the product:
 *   1. A short, human label (for badges / table cells / filters).
 *   2. "Respondability" — can the user submit something, and if so what KIND
 *      of document. This gates the Proposal Assist wizard.
 *
 * Respondability tiers (per Eric, 2026-06-02). NOTE: both 'bid' AND 'response'
 * mean the user writes (and Mindy drafts) a document — the difference is whether
 * it's PRICED. Only 'none' has nothing to submit.
 *   - 'bid'        — You submit a PRICED proposal/quote. Mindy drafts the full
 *                    proposal. Solicitation / RFP / RFQ / Combined Synopsis /
 *                    Consolidate-Bundle.
 *   - 'response'   — You DO respond (and Mindy drafts it), but it's NOT priced:
 *                    a letter of intent / market-research
 *                    response. Sources Sought / RFI.
 *   - 'none'       — Nothing to submit. Presolicitation / Special Notice /
 *                    Award Notice / Justification / Sale of Surplus Property.
 *                    Presol is a heads-up that a solicitation is coming — the
 *                    action is to TRACK it, not respond.
 *
 * Keep this list aligned with SAM's Notice Type dropdown:
 *   Special Notice · Sources Sought · Presolicitation ·
 *   Consolidate/(Substantially) Bundle · Solicitation ·
 *   Combined Synopsis/Solicitation · Award Notice · Justification ·
 *   Sale of Surplus Property · Intent to Bundle Requirements (DoD-Funded)
 */

export type Respondability = 'bid' | 'response' | 'none';

export interface NoticeTypeInfo {
  /** Short label for UI ("Sources Sought", "Solicitation / RFP", …). null when
   *  the type is unknown/blank so callers can hide the badge. */
  label: string | null;
  respondability: Respondability;
}

/**
 * Classify SAM's free-text notice_type. Matching is substring + case-insensitive
 * so it tolerates the many spellings SAM emits ("Combined Synopsis/Solicitation",
 * "presol.", "RFP", "Request for Quote", etc.).
 */
export function classifyNoticeType(nt?: string | null, title?: string | null): NoticeTypeInfo {
  // Unknown / blank notice_type: we have NO label to show (badge hidden), but
  // respondability MUST default to 'bid' — never block drafting on uncertainty.
  // Many pursuits predate notice_type enrichment and have a null value; treating
  // those as 'none' wrongly disabled "Start drafting" for every such pursuit.
  // Only an EXPLICITLY classified non-respondable type (Presol / Special /
  // Award / Justification / Surplus) should block.
  if (!nt || !nt.trim()) return { label: null, respondability: 'bid' };
  const t = nt.toLowerCase();
  const ttl = (title || '').toLowerCase();

  // OTA / proposal-request signals: agencies increasingly issue actual CALLS FOR
  // PROPOSALS under "Special Notice" — especially OTA "Request for Project
  // Proposals" (RPP), "Request for Solutions" (RFS), "Request for Proposals", and
  // CSO/commercial-solutions-opening flows. These ARE biddable, so a Special
  // Notice whose TITLE shows proposal-request intent must NOT be gated as
  // informational. (Eric: gov uses these to take bids — allow drafting.)
  const isProposalRequest =
    /request for (project )?proposal|\brpp\b|request for solution|\brfs\b|request for (white )?paper|other transaction|\bota\b|\bcso\b|commercial solutions opening|request for (project )?submission/.test(ttl);

  // --- Not respondable: informational only ---------------------------------
  if (t.includes('award')) return { label: 'Award Notice', respondability: 'none' };
  if (t.includes('justification')) return { label: 'Justification', respondability: 'none' };
  if (t.includes('surplus') || t.includes('sale of')) {
    return { label: 'Sale of Surplus Property', respondability: 'none' };
  }
  // "Special Notice" is USUALLY informational — but if the title shows it's a
  // call for proposals (OTA RPP, RFS, etc.), it's biddable. Guard BEFORE the
  // solicitation check so a plain "special" never falls through to biddable, yet
  // an OTA RPP special notice still gets drafted.
  if (t.includes('special')) {
    return isProposalRequest
      ? { label: 'Special Notice · RPP', respondability: 'bid' }
      : { label: 'Special Notice', respondability: 'none' };
  }
  // Presolicitation: a heads-up that a solicitation is coming. You do NOT
  // respond — the action is to track it and bid when the solicitation drops.
  // Guard BEFORE the solicitation check so "pre-solicitation" doesn't match it.
  if (t.includes('presol') || t.includes('pre-sol') || t.includes('pre sol')) {
    return { label: 'Presolicitation', respondability: 'none' };
  }

  // --- Respondable, but NOT a priced bid (cap statement / LOI / RFI) --------
  if (t.includes('sources sought')) return { label: 'Sources Sought', respondability: 'response' };
  if (t.includes('rfi') || t.includes('request for information') || t.includes('information')) {
    return { label: 'RFI', respondability: 'response' };
  }

  // --- Biddable: real priced proposal / quote ------------------------------
  if (t.includes('combined')) return { label: 'Combined Synopsis', respondability: 'bid' };
  if (t.includes('bundle') || t.includes('consolidat')) {
    return { label: 'Consolidate / Bundle', respondability: 'bid' };
  }
  if (t.includes('rfq') || t.includes('quot')) return { label: 'RFQ', respondability: 'bid' };
  if (t.includes('solicitation') || t.includes('rfp')) {
    return { label: 'Solicitation / RFP', respondability: 'bid' };
  }

  // Unknown free text — show it raw, treat as biddable so we don't wrongly
  // block a real solicitation we failed to parse.
  return { label: nt.length > 24 ? `${nt.slice(0, 24)}…` : nt, respondability: 'bid' };
}

/** Short label only (null when unknown). */
export function noticeTypeLabel(nt?: string | null): string | null {
  return classifyNoticeType(nt).label;
}

/** Map to the proposal wizard's tab-mode enum. Cap-statement mode for the
 *  respondable non-bid types (Sources Sought / RFI); full proposal for bid
 *  types. 'none' types (Presol / Special / Award / …) never enter the wizard. */
export function noticeTypeToDetected(
  nt?: string | null
): 'rfp' | 'sources_sought' | 'rfi' | 'rfq' | 'unknown' {
  const { label, respondability } = classifyNoticeType(nt);
  if (!label) return 'unknown';
  if (respondability === 'response') {
    if (/rfi/i.test(label)) return 'rfi';
    return 'sources_sought'; // Sources Sought uses LOI / response tabs
  }
  if (/rfq/i.test(label)) return 'rfq';
  if (respondability === 'bid') return 'rfp';
  return 'unknown';
}
