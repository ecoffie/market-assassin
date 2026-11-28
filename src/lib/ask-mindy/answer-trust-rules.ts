/**
 * Answer rules approved by Eric for Mindy Day (2026-11-28, "approve the day plan"), in the playbook pattern of
 * competition-playbook.ts. One source for research mode and standard Ask Mindy answers.
 *
 *   a. DATE KINDS: every date says what kind it is (a contract end is not a recompete date; a forecast date is the
 *      agency's plan, not a solicitation).
 *   b. THIN RESULTS INSIDE THE LAG WINDOW: "not yet published", never "no award was made", reusing the tool's lag_note.
 *   c. CHANNELS NO PLATFORM CAN SEE (GSA eBuy RFQs, classified/IC requirements, consortium OTA calls, purchase-card
 *      micro-purchases): say so, why, and where to go instead. Never a "Mindy gap", never invented coverage. NECO is
 *      never cited as an active channel. Lab/FFRDC subcontracts are not tracked.
 */

/** The one wording for the Defense reporting lag (#2549), wherever it is said. */
export const DEFENSE_LAG_SENTENCE =
  'Defense awards are published on USAspending.gov with a delay of about 90 days (DoD reporting policy)';

export const DATE_KIND_RULES = [
  'DATE KINDS: every date in an answer says what kind of date it is.',
  '- Contract end date (period of performance ends): "the current contract ends <date>". It is NOT a recompete or release date; a follow-on, if any, is usually solicited months before, and the date is not announced.',
  '- Forecast date: the agency\'s planned quarter or date to solicit or award: "the agency plans to <solicit/award> around <date> (a plan, not a solicitation; plans move)".',
  '- Solicitation dates: posted date and response deadline from the notice ("responses due <date>").',
  '- Award date: when the award was signed.',
  '- Never write that something "comes out on", "is released on" or "opens on" a contract end date or a forecast date.',
].join('\n');

export const LAG_WINDOW_RULES = [
  'THIN RESULTS INSIDE THE REPORTING LAG: when recent awards or a time series look thin or empty for the latest months, and the tool returned _meta.lag_note (or the buyer is Defense), say the recent awards are "not yet published", never "no award was made", "they stopped buying" or "no activity". Reuse the tool\'s lag_note in plain words.',
  `- For Defense, use exactly: "${DEFENSE_LAG_SENTENCE}".`,
  '- No data-freshness dates ("as of", "data through"): say it in words ("recent awards may not appear yet").',
].join('\n');

export const UNSEEN_CHANNELS_RULES = [
  'CHANNELS NO PLATFORM CAN SEE: when the customer asks about one of these, say plainly that no platform (Mindy or any other) shows it, why, and where to go instead. Never call it a Mindy gap, never offer a search for it and never invent coverage.',
  '- GSA eBuy RFQs: only GSA Schedule (MAS) holders can see them. Where to go: get on the relevant GSA Schedule, or team with a current schedule holder who can see and answer the RFQ.',
  '- Classified and intelligence community requirements: not published, by rule (FAR 5.202(a)(1), the security exception to publicizing). Where to go: the agency\'s small business office and cleared primes\' supplier programs; this work usually needs a facility clearance, which a government customer or prime sponsors.',
  '- Consortium-managed OTA solicitations: project calls go to consortium members only. Where to go: join the consortium that runs that technology area (name one only when a source in the conversation or the rules register names it as active), or team with a member.',
  '- Purchase-card micro-purchases: not posted anywhere; the cardholder buys directly. Where to go: the buying office\'s award history shows what it buys small and from whom; introduce the company to that office and its small business specialist.',
  '- National lab and FFRDC subcontracts: these do not appear in federal award or subaward data. For how to sell to a DOE national lab, call get_lab_supplier_info and give its sourced portal, rules and office; for other FFRDCs, name a portal only when a source in the conversation gives it.',
  '- NECO (the Navy Electronic Commerce Online portal): never cite it as an active place to find Navy solicitations.',
].join('\n');

export const ANSWER_TRUST_RULES = [DATE_KIND_RULES, '', LAG_WINDOW_RULES, '', UNSEEN_CHANNELS_RULES].join('\n');
