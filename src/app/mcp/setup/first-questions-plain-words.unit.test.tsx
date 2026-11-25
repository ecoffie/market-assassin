import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import McpSetupPage from './page';
import FirstQuestions from './FirstQuestions';
import { CLAUDE_FIRST_ASK, FIRST_QUESTIONS_NO_MARKET_NOTE } from './setup-copy';

/**
 * The "you're done, now ask this" moment told a beginner to type NAICS, recompete and RFP,
 * with none of them explained. Someone who does not know their NAICS code was stuck at the
 * very first question, while the homepage says "Mindy picks the codes for you."
 */
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;|&rsquo;/g, "'");

describe('setup guide first questions use plain words', () => {
  const page = renderToStaticMarkup(<McpSetupPage />);
  const pageText = text(page);

  it('the Claude success box asks a question with no NAICS in it', () => {
    expect(CLAUDE_FIRST_ASK).not.toMatch(/NAICS/i);
    expect(CLAUDE_FIRST_ASK).toBe(
      'Use Mindy to find federal contracts for [what you sell] that are ending in the next 6 months.',
    );
    // Wired into the page, and the old jargon question is gone.
    expect(pageText).toContain(CLAUDE_FIRST_ASK);
    expect(pageText).not.toContain('expiring in my NAICS');
  });

  it('the generic footer tells people to say what they sell, not to add NAICS codes', () => {
    expect(FIRST_QUESTIONS_NO_MARKET_NOTE).toBe('Tell Mindy what you sell and these get specific to your market.');
    expect(pageText).toContain(FIRST_QUESTIONS_NO_MARKET_NOTE);
    expect(pageText).not.toContain('Add your NAICS codes');
  });

  it('explains recompete and RFP where a beginner first meets them', () => {
    const block = renderToStaticMarkup(<FirstQuestions />);
    // "recompete" links to the glossary, the same way the pricing page does.
    expect(block).toMatch(/<a [^>]*href="\/glossary\/recompete"[^>]*>recompetes<\/a>/);
    expect(text(block)).toContain('coming back up for bid');
    // RFP is spelled out on first use.
    expect(text(block)).toContain('request for proposals (RFP)');
    // And it reaches the rendered page.
    expect(page).toContain('href="/glossary/recompete"');
  });

  it('no generic (unpersonalised) first question asks for a NAICS code', () => {
    const blockText = text(renderToStaticMarkup(<FirstQuestions />));
    expect(blockText).not.toMatch(/NAICS/);
  });
});
