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
  | 'connect_chatgpt' | 'cancel_subscription'
  | 'write_capability_statement' | 'set_asides' | 'disadvantaged_meaning' | 'certifications' | 'first_bid' | 'write_proposal';

/** The question is asking how to do something, what something means, or for help writing. */
const HOW_TO = /\b(how (do|can|should|would) (i|we|you)|how to|how does|where (do|can) (i|we)|what (does|do) .{1,60}\bmean|what('s| is| are) (a|an|the)?\s*(set[- ]?aside|8\s*\(?a\)?|capability statement|sdb|hubzone|wosb|sdvosb|vosb)|is (this|it|that) (a )?set[- ]?aside|can you (help|show|walk|teach|tell)|help me (write|draft|create|make|find|get|understand|pursue|bid|cancel|connect|upload)|walk me through|i want to (cancel|connect|upload)|teach me)\b/i;

/**
 * Matched WITHOUT a how-to form, because the bare phrase has one meaning.
 *   - Cancel (Eric, 2026-11-27: cancelling must be easy): "cancel my subscription", "unsubscribe", "stop billing me".
 *     Unsubscribing from EMAILS or alerts is not cancelling, so it is left to the normal path.
 *   - Capability statement questions (one customer asked five ways in eleven minutes and got five different answers):
 *     "I need a capability statement", "do you have a capability statement template". An imperative ("write my
 *     capability statement", "draft a capability statement from my upload") is NOT matched: it goes straight to drafting.
 */
const DIRECT: Array<{ id: HelpIntentId; re: RegExp; unless?: RegExp }> = [
  { id: 'cancel_subscription', re: /\b(cancel(l?ing)? (my |the |our )?(mindy )?(subscription|plan|membership|account|pro|team|trial)|unsubscribe|stop (billing|charging)|cancel mindy)\b/i, unless: /\b(e-?mails?|alerts?|newsletter|notifications?|briefings?)\b/i },
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
  { id: 'cancel_subscription', re: /\b(cancel|unsubscribe|end|stop)\b.{0,30}\b(subscription|plan|membership|billing|account|mindy|trial)\b|\bcancel my\b/i },
  { id: 'connect_chatgpt', re: /\b(chat\s?gpt|openai|claude desktop|claude\.ai|mcp|connector)\b/i },
  { id: 'upload_capability_statement', re: /\b(upload|add|attach|put|load|import|share|give)\b.{0,40}\b(capabilit(y|ies) statement|cap statement|past performance|resume|document|file|pdf|word doc)\b/i },
  { id: 'find_events', re: /\b(events?|industry days?|conferences?|outreach (sessions?|events?)|matchmaking|vendor days?)\b/i },
  { id: 'build_shortlist', re: /\btop\s*\d+\b|\bshort ?list\b|\btarget list\b|\b(my|a) list of (opportunit\w*|contracts|bids|targets)\b/i },
  { id: 'pull_bids_from_map', re: /\b(pull|get|save|pick|grab|export|collect)\b.{0,40}\b(bids?|opportunit\w*|contracts?|leads?)\b.{0,30}\bmap\b|\bfrom the map\b/i },
  { id: 'find_contracts', re: /\b(find|search|look for|locate|see|get)\b.{0,30}\b(contracts?|opportunit\w*|bids?|solicitations?|work)\b|\buse (the|this) (system|app|site|platform|tool|mindy|map)\b/i },
];

/**
 * Returns the matching help intent, or null. `hasAttachedOpportunity`: an opportunity is attached to the turn, so
 * "how do I pursue this" is about THAT notice and belongs to the full answer path, not a generic playbook.
 */
export function matchHelpIntent(question: string, opts: { hasAttachedOpportunity?: boolean } = {}): HelpIntentId | null {
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  if (!q || q.length > 400) return null;
  // Asked without a how-to form, these still mean exactly one thing.
  for (const d of DIRECT) if (d.re.test(q) && !(d.unless && d.unless.test(q))) return d.id;
  if (!HOW_TO.test(q)) return null;
  for (const r of RULES) {
    if (!r.re.test(q)) continue;
    if (r.id === 'first_bid' && opts.hasAttachedOpportunity) return null;
    return r.id;
  }
  return null;
}
