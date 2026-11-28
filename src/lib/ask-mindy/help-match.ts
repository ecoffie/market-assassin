/**
 * Which help entry (if any) a customer's question is asking for. Deterministic and conservative: only a clear
 * HOW-TO or WHAT-DOES-IT-MEAN question matches, so an ordinary research request ("find me cyber work in Florida",
 * "who buys roofing in Texas") never gets a canned answer. No match → the turn runs exactly as before.
 *
 * Order matters: the more specific intents (write a capability statement) are tested before the broader ones
 * (upload a document).
 */
export type HelpIntentId =
  | 'find_contracts' | 'pull_bids_from_map' | 'build_shortlist' | 'upload_capability_statement' | 'find_events'
  | 'connect_chatgpt' | 'cancel_subscription' | 'stop_emails' | 'unsubscribe_either'
  | 'write_capability_statement' | 'set_asides' | 'disadvantaged_meaning' | 'certifications' | 'first_bid' | 'write_proposal'
  | 'security' | 'security_soc2' | 'security_gov_authorization' | 'security_cui';

/** The question is asking how to do something, what something means, or for help writing. */
const HOW_TO = /\b(how (do|can|should|would) (i|we|you)|how to|how does|where (do|can) (i|we)|what (does|do) .{1,60}\bmean|what('s| is| are) (a|an|the)?\s*(set[- ]?aside|8\s*\(?a\)?|capability statement|sdb|hubzone|wosb|sdvosb|vosb)|is (this|it|that) (a )?set[- ]?aside|can you (help|show|walk|teach|tell)|help me (write|draft|create|make|find|get|understand|pursue|bid|cancel|connect|upload)|walk me through|i want to (cancel|connect|upload)|teach me)\b/i;

/**
 * Matched WITHOUT a how-to form, because the bare phrase has one meaning.
 *   - Emails: "unsubscribe from emails", "stop the alerts", "too many emails" mean EMAIL, never the paid plan.
 *   - Cancel (Eric, 2026-11-27: cancelling must be easy): "cancel my subscription", "stop billing me", "end my plan",
 *     "refund". Paid plan only.
 *   - A bare "unsubscribe" (or "unsubscribe from Mindy") could mean either, so the answer gives both links.
 *   - Capability statement questions (one customer asked five ways in eleven minutes and got five different answers):
 *     "I need a capability statement", "do you have a capability statement template". An imperative ("write my
 *     capability statement", "draft a capability statement from my upload") is NOT matched: it goes straight to drafting.
 */
const DIRECT: Array<{ id: HelpIntentId; re: RegExp; unless?: RegExp }> = [
  { id: 'stop_emails', re: /\b(unsubscribe|stop|turn off|opt out|pause|too many|fewer|less)\b.{0,30}\b(e-?mails?|alerts?|newsletters?|notifications?|briefings?|digests?)\b/i },
  { id: 'cancel_subscription', re: /\b(cancel(l?ing)? (my |the |our )?(mindy )?(subscription|plan|membership|account|pro|team|trial)|stop (billing|charging)|end (my |the )?(subscription|plan|membership)|refund|cancel mindy)\b/i },
  { id: 'unsubscribe_either', re: /\bunsubscribe\b/i },
  // Security and data handling (Eric, 2026-11-28). The specific questions first, each with its own one-line honest
  // answer; certification names count only when the question is ABOUT Mindy ("are you…", "is Mindy…", "do you have…"),
  // so "which agencies buy CMMC services" stays a contract question.
  { id: 'security_soc2', re: /\b(are you|is mindy|is it|is this (app|platform|site)|do you (have|hold)|does mindy (have|hold)|can you (share|send))\b.{0,30}\bsoc\s*2\b/i },
  { id: 'security_gov_authorization', re: /\b(are you|is mindy|is it|is this (app|platform|site)|do you (have|hold)|does mindy (have|hold))\b.{0,30}\b(fedramp|cmmc|fisma|il\s*[245]|impact level)\b/i },
  { id: 'security_cui', re: /\b(can|may|should) (i|we) (upload|put|store|share|add|use)\b.{0,30}\b(cui|controlled unclassified|classified)\b|\b(is|are) (mindy|you|it)\b.{0,20}\b(approved|authorized|cleared|ok|okay|allowed)\b.{0,20}\b(for )?(cui|controlled unclassified|classified)\b/i },
  { id: 'security', re: /\b(is|are) (my|our) (data|files?|information|vault|documents?|uploads?) (safe|secure|private|protected|encrypted)\b|\b(train|training|trained)\b.{0,30}\b(ai|models?|llms?)\b.{0,20}\b(on )?(my|our) (data|files?|documents?|information)\b|\bwho can (see|access|read) (my|our) (data|files?|documents?|vault|information|uploads?)\b|\bsecurity (questionnaire|review|overview|policy|practices|documentation|docs)\b|\b(delete|remove|erase|export|download) (all )?(of )?(my|our) (data|vault|files?|information)\b|\bhow (secure|safe) is (mindy|my data|your (app|platform|site))\b/i },
  { id: 'write_capability_statement', re: /\b(need|want|looking for|template|example|sample|format)\b.{0,40}\b(capabilit(y|ies) statement|cap statement)\b|\b(capabilit(y|ies) statement|cap statement)\b.{0,30}\b(template|example|sample|format)\b|\bwhat should (my|a) (capabilit(y|ies) statement|cap statement) (include|say|have|look like)\b/i },
];

const RULES: Array<{ id: HelpIntentId; re: RegExp }> = [
  // GovCon basics first where a phrase could also read as a product question.
  { id: 'write_capability_statement', re: /\b(write|create|make|draft|build|put together|structure)\b.{0,40}\b(capabilit(y|ies) statement|cap statement)\b|\bwhat (should|goes) (go )?in(to)? (a|my) capabilit(y|ies) statement\b|\bwhat('s| is) a capabilit(y|ies) statement\b/i },
  { id: 'write_proposal', re: /\b(write|draft|prepare|put together)\b.{0,30}\bproposal\b/i },
  { id: 'disadvantaged_meaning', re: /\b(socially|economically)( and (socially|economically))? disadvantaged\b|\bsdb\b|\b8\s*\(?a\)? (program|business)\b|\bwhat('s| is) (an? )?8\s*\(?a\)?\b/i },
  { id: 'certifications', re: /\b(certif\w*|get certified)\b.{0,60}\b(veteran|small business|8\s*\(?a\)?|hubzone|wosb|women|sdvosb|vosb|minority|disadvantaged)\b|\b(veteran|sdvosb|vosb|hubzone|wosb|edwosb|women[- ]owned|small business)\b.{0,40}\b(certif\w*)\b/i },
  { id: 'set_asides', re: /\bset[- ]?asides?\b/i },
  { id: 'first_bid', re: /\b(first|1st) (bid|contract|proposal|federal contract|government contract)\b|\bpursue (this|that|an|my|the|a) (opportunit\w*|bid|contract|solicitation)\b|\b(bid on|respond to|go after) (this|that|an|a) (opportunit\w*|solicitation|contract)\b/i },
  // Product how-to.
  { id: 'cancel_subscription', re: /\b(cancel|end|stop)\b.{0,30}\b(subscription|plan|membership|billing|account|mindy|trial)\b|\bcancel my\b/i },
  { id: 'connect_chatgpt', re: /\b(chat\s?gpt|openai|claude desktop|claude\.ai|mcp|connector)\b/i },
  { id: 'upload_capability_statement', re: /\b(upload|add|attach|put|load|import|share|give)\b.{0,40}\b(capabilit(y|ies) statement|cap statement|past performance|resume|document|file|pdf|word doc)\b/i },
  { id: 'find_events', re: /\b(events?|industry days?|conferences?|outreach (sessions?|events?)|matchmaking|vendor days?)\b/i },
  { id: 'build_shortlist', re: /\btop\s*\d+\b|\bshort ?list\b|\btarget list\b|\b(my|a) list of (opportunit\w*|contracts|bids|targets)\b/i },
  { id: 'pull_bids_from_map', re: /\b(pull|get|save|pick|grab|export|collect)\b.{0,40}\b(bids?|opportunit\w*|contracts?|leads?)\b.{0,30}\bmap\b|\bfrom the map\b/i },
  { id: 'find_contracts', re: /\b(find|search|look for|locate|see|get)\b.{0,30}\b(contracts?|opportunit\w*|bids?|solicitations?|work)\b|\buse (the|this) (system|app|site|platform|tool|mindy|map)\b/i },
];

/**
 * A canned answer fires only when the message IS a short how-to request (Agent 4, 2026-11-28: a question about how
 * Mindy presents a number from an attached capability statement got the "upload your capability statement" answer).
 * When in doubt, fall through: a missed help answer still gets a normal answer; a wrong one looks broken.
 */
const MAX_WORDS = 18;
/** Questions about Mindy's own behaviour ("how do you present…", "when do you say…", "what do you do when…"). */
const ABOUT_MINDY = /\b(how|when|why|where) (do|does|did|would|will|should) (you|mindy|it)\b|\bwhat (do|does|would|will) (you|mindy) do\b|\bhow (are|is) (you|mindy) (going to|deciding|handling)\b/i;
/** Digits, money or percentages the help register never needs (8(a), "top 25" and "1st" are part of real how-tos). */
function hasNumbers(q: string): boolean {
  const stripped = q.replace(/\b8\s*\(?a\)?/gi, ' ').replace(/\btop\s*\d+\b/gi, ' ').replace(/\b1st\b/gi, ' ')
    // Security names that carry a digit ("SOC 2", "CMMC level 2", "ISO 27001", "2FA") are names, not figures.
    .replace(/\bsoc\s*2\b(\s*type\s*(1|2|i|ii)\b)?/gi, ' ').replace(/\bcmmc(\s*(level|l)\s*\d)?\b/gi, ' ').replace(/\biso\s*27001\b/gi, ' ').replace(/\b2fa\b/gi, ' ');
  return /[\d$%€£]/.test(stripped);
}
/** True when the message is shaped like ONE short how-to request and nothing else. */
export function isHelpShaped(q: string): boolean {
  const words = q.split(' ').filter(Boolean);
  if (words.length > MAX_WORDS) return false;
  // One sentence or question only: no second question, no follow-on clause after a full stop.
  if (q.replace(/[.?!]+$/, '').split(/[.?!;]+\s+/).filter((x) => x.trim()).length > 1) return false;
  if (/["\u201c\u201d]/.test(q)) return false;
  if (hasNumbers(q)) return false;
  if (ABOUT_MINDY.test(q)) return false;
  return true;
}

/**
 * Returns the matching help intent, or null. `hasAttachedOpportunity`: an opportunity is attached to the turn, so
 * "how do I pursue this" is about THAT notice and belongs to the full answer path, not a generic playbook.
 */
export function matchHelpIntent(question: string, opts: { hasAttachedOpportunity?: boolean } = {}): HelpIntentId | null {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  if (!q || q.length > 400) return null;
  if (!isHelpShaped(q)) return null;
  // Asked without a how-to form, these still mean exactly one thing.
  for (const d of DIRECT) if (d.re.test(q) && !(d.unless && d.unless.test(q))) return d.id;
  const how = HOW_TO.exec(q);
  // The how-to phrase leads the message (a greeting or two words of lead-in at most), not buried in a longer ask.
  if (!how || q.slice(0, how.index).split(' ').filter(Boolean).length > 4) return null;
  for (const r of RULES) {
    if (!r.re.test(q)) continue;
    if (r.id === 'first_bid' && opts.hasAttachedOpportunity) return null;
    return r.id;
  }
  return null;
}
