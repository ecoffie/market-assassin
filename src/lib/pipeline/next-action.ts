/**
 * Compute the NEXT ACTION for a tracked opportunity from its notice type — the
 * fix for the browse→track→act cliff. 900 of 1,000 tracked pursuits sit at
 * stage='tracking' with a null `next_action` (76% empty): tracking is a bookmark
 * that goes nowhere, so nobody comes back. This gives every tracked opp a real
 * next step + the tool that does it, so "track" starts a workflow.
 *
 * Keys reuse the EXISTING `next_action` vocabulary already in user_pipeline
 * (`research_agency_incumbent`, `track_only`, …) — not a new label set. Matching
 * mirrors the notice-type logic already in AlertsPanel (lowercase `.includes()`),
 * against the real notice_type values in sam_opportunities:
 *   Combined Synopsis/Solicitation · Solicitation · Award Notice · Sources Sought ·
 *   Presolicitation · Special Notice · Justification.
 *
 * `panel` is the MIPanel to route to (decision this session: route to the tool's
 * panel, not deep-link a specific opp yet). Used at both write time (set the key
 * on the tracked row) and render time (the per-item action button).
 */
import type { AppPanel } from '@/components/app/UnifiedSidebar';

export interface NextAction {
  key: string;        // persisted in user_pipeline.next_action (existing vocabulary)
  label: string;      // the button text the user sees
  panel: AppPanel;    // where the action routes (onPanelChange target)
}

/**
 * Notice type → the single most useful next step.
 * - RFP-class (you can bid) → draft your response (proposals)
 * - Sources Sought / RFI (market research, respond with an LOI) → submit an LOI (proposals)
 * - Pre-sol / Special Notice / Award (not yet biddable) → find the contracting officer (contacts)
 * - anything else → keep tracking (no dead-end button; just the tracked state)
 */
export function computeNextAction(
  noticeType?: string | null,
  _setAside?: string | null,
): NextAction {
  const t = (noticeType || '').toLowerCase();

  // ORDER MATTERS — "Presolicitation" and "Combined Synopsis/Solicitation" both
  // contain the substring "solicitation", so the specific cases MUST be tested
  // before the generic solicitation check, or a pre-sol wrongly reads as biddable.
  //
  // 1. Sources Sought / RFI → market research, respond with an LOI.
  if (t.includes('sources sought') || t.includes('request for information') || t === 'rfi') {
    return { key: 'submit_loi', label: 'Submit a letter of interest', panel: 'proposals' };
  }
  // 2. Pre-sol / Special Notice / Award → not yet biddable → find the CO.
  if (t.includes('presolicitation') || t.includes('special notice') || t.includes('award')) {
    return { key: 'research_agency_incumbent', label: 'Find the contracting officer', panel: 'contacts' };
  }
  // 3. RFP-class (Solicitation / Combined Synopsis/Solicitation / RFP / RFQ) → draft.
  if (t.includes('solicitation') || t === 'rfp' || t === 'rfq') {
    return { key: 'draft_response', label: 'Draft your response', panel: 'proposals' };
  }
  return { key: 'track_only', label: '', panel: 'pipeline' };
}

/**
 * Reverse: given a stored `next_action` key (which may have been set at track time
 * OR be a legacy value), return the button label + panel. Falls back to recomputing
 * from notice type when the key is missing/unknown so legacy tracked rows (null
 * next_action) still get a button. Returns null when there's genuinely no action
 * (track_only / no signal) so the caller renders nothing (no dead empty button).
 */
export function nextActionButton(
  storedKey?: string | null,
  noticeType?: string | null,
): NextAction | null {
  const byKey: Record<string, NextAction> = {
    submit_loi: { key: 'submit_loi', label: 'Submit a letter of interest', panel: 'proposals' },
    draft_response: { key: 'draft_response', label: 'Draft your response', panel: 'proposals' },
    research_agency_incumbent: { key: 'research_agency_incumbent', label: 'Find the contracting officer', panel: 'contacts' },
    find_teaming_partners: { key: 'find_teaming_partners', label: 'Find teaming partners', panel: 'contacts' },
  };
  const key = (storedKey || '').trim();
  if (key && byKey[key]) return byKey[key];
  // An explicit track_only means "no action" — never resurrect a button for it.
  if (key === 'track_only') return null;
  // Legacy / unset (null/empty key) → recompute from notice type so pre-existing
  // tracked rows (written before this feature) still get an action.
  const computed = computeNextAction(noticeType);
  return computed.label ? computed : null;
}
