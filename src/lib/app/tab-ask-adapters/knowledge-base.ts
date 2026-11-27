/**
 * Ask Mindy → Knowledge Base tab. Maps a parsed question onto the ONE param the panel's search box
 * already sends to GET /api/app/knowledge-base: `q` (a single phrase matched against document titles
 * and summaries). The tab's document-type pills are left exactly as the user set them, so the answer is
 * what typing the phrase into the tab's own search box would show.
 *
 * The tab cannot express: a buyer/agency, a state, a set-aside, NAICS/PSC codes, a fiscal year,
 * `-exclusions`, OR-alternatives (the route searches one phrase), or advice. Those return null → the box
 * offers "Ask Mindy in chat instead". A dropped constraint is never silent.
 */
import { countPhrase, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '../tab-ask';

export interface KnowledgeBaseAskParams {
  q: string;
}

const NOUN = { one: 'document', many: 'documents' };

function reason(ask: ParsedTabAsk): string | null {
  const i = ask.intent;
  if (ask.empty) return 'Type a topic to search the knowledge base for.';
  if (ask.advice) return 'That reads like a question for Mindy, not a list to filter.';
  if (i.agencies.length) return 'The knowledge base searches document titles and summaries; it can’t filter by buyer.';
  if (i.states.length) return 'The knowledge base can’t filter by state.';
  if (i.setAsides.length) return 'The knowledge base can’t filter by set-aside.';
  if (i.naics.length || i.psc.length) return 'The knowledge base can’t filter by NAICS or PSC code.';
  if (ask.fiscalYears.length) return 'The knowledge base can’t filter by fiscal year.';
  if (i.exclusions.length) return 'The knowledge base can’t exclude words.';
  if (ask.keywords.length > 1) return 'The knowledge base searches one phrase at a time.';
  if (!ask.keywords.length) return 'Type a topic to search the knowledge base for.';
  return null;
}

export const knowledgeBaseAskAdapter: TabAskAdapter<KnowledgeBaseAskParams> = {
  tab: 'knowledge_base',
  noun: NOUN,
  placeholder: 'Ask Mindy: e.g. capability statement templates',
  examples: ['capability statement', 'past performance', 'cybersecurity proposals'],
  tabWords: ['knowledge base', 'documents', 'document', 'docs', 'doc'],

  toQuery(ask) {
    if (reason(ask)) return null;
    return { q: ask.keywords[0] };
  },

  summary(ask: ParsedTabAsk, count: TabAskCount) {
    return `Mindy searched: “${ask.keywords[0] || ''}” in titles and summaries — ${countPhrase(count, NOUN)}`;
  },

  whyNot(ask) {
    return reason(ask) || '';
  },
};
