/**
 * The words an alert prints for "why is this here" and "what stage is it".
 *
 * Both come from OpportunityMatchEvidence computed at ranking time
 * (scoreOpportunityDetailed), so the email says what the ranker actually used.
 * Deliberately NOT claimed here: a notice with no keyword support is labelled as
 * a market-only match — it must never read as a keyword match.
 */
import type { OpportunityMatchEvidence } from '@/lib/briefings/pipelines/sam-gov';

export { OPEN_STILL_OPEN_EXPLAIN } from '@/lib/alerts/open-contract-d';

type WithEvidence = {
  naicsCode?: string;
  noticeType?: string;
  evidence?: OpportunityMatchEvidence;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const quote = (k: string) => `&ldquo;${esc(k)}&rdquo;`;

/** e.g. `Keyword “workflow automation” in description · NAICS 541511` */
export function renderMatchReason(opp: WithEvidence): string {
  const e = opp.evidence;
  const code = opp.naicsCode || '';
  const naicsBit = e?.naics === 'exact' ? `NAICS ${code}` : e?.naics === 'related' ? `NAICS ${code} (related)` : '';
  if (!e) return naicsBit;
  const bits: string[] = [];
  if (e.keywords.title.length > 0) {
    bits.push(`Keyword ${e.keywords.title.slice(0, 2).map(quote).join(', ')} in title`);
  } else if (e.keywords.body.length > 0) {
    bits.push(`Keyword ${e.keywords.body.slice(0, 2).map(quote).join(', ')} in description`);
  } else {
    bits.push('No keyword match &mdash; in your NAICS market');
  }
  if (naicsBit) bits.push(naicsBit);
  return bits.join(' &middot; ');
}

/** Stage label: Bid / Respond (not priced) / Heads-up only. */
export function renderStageLabel(opp: WithEvidence): string {
  const stage = opp.evidence?.stage;
  const label = esc(stage?.label || opp.noticeType || 'Notice');
  if (!stage) return label;
  if (stage.respondability === 'bid') return `Bid &middot; ${label}`;
  if (stage.respondability === 'response') return `Respond, not priced &middot; ${label}`;
  return `Heads-up only, nothing to submit &middot; ${label}`;
}
