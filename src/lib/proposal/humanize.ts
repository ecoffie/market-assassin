/**
 * Humanization pass — runs after AI generation, before returning to user.
 *
 * Mirrors what Content Reaper's humanizePost does for LinkedIn:
 * defense-in-depth against the LLM patterns that scream "AI-written"
 * (em-dashes used as breath marks, triple-adjective stacks, generic
 * intros like "In today's federal landscape...").
 *
 * Strategy: regex + string replacements. NOT another AI call (that
 * would double cost + add latency). Fast, deterministic, easy to
 * extend.
 *
 * Each replacement is conservative — we only touch patterns that are
 * unambiguous AI tells. Real human writers occasionally use em-dashes
 * and "leverage" too, but the FREQUENCY at which LLMs use them is
 * the dead giveaway.
 */

interface HumanizationStats {
  emDashesReplaced: number;
  bannedPhrasesReplaced: number;
  generic_intros_stripped: number;
  triple_adjective_stacks_simplified: number;
}

// ---- Banned phrases — replace inline with empty or shorter form ----
//
// Order matters: longer phrases come first so they're caught before
// their substrings get touched by shorter rules.
const BANNED_PHRASES: Array<[RegExp, string]> = [
  // Generic openers that scream "GPT"
  [/\bIn today's (rapidly evolving|complex|dynamic|ever-changing|fast-paced) federal landscape,?\s*/gi, ''],
  [/\bIn (today's|the current) (federal|government) (contracting|procurement) (environment|landscape|space),?\s*/gi, ''],
  [/\bThe federal (contracting|procurement) (landscape|environment) (is|continues to be) (rapidly evolving|increasingly complex|highly competitive),?\s*/gi, ''],
  [/\b(As|Given) the (increasing|growing|evolving) (complexity|demands|requirements) of federal contracting,?\s*/gi, ''],

  // Marketing fluff superlatives — replace with neutral or strip
  [/\bworld[- ]class\b/gi, ''],
  [/\bbest[- ]in[- ]class\b/gi, ''],
  [/\bcutting[- ]edge\b/gi, ''],
  [/\bstate[- ]of[- ]the[- ]art\b/gi, ''],
  [/\bnext[- ]generation\b/gi, 'modern'],
  [/\bcomprehensive (suite|set) of\b/gi, ''],
  [/\bend[- ]to[- ]end\b/gi, 'full'],
  [/\bturnkey\b/gi, ''],
  [/\bone[- ]stop[- ]shop\b/gi, ''],

  // Filler verbs that AI overuses
  [/\bleverag(e|es|ed|ing)\b/gi, 'use'],
  [/\butiliz(e|es|ed|ing)\b/gi, 'use'],
  [/\bsynerg(y|ies|istic)\b/gi, ''],
  [/\bholistically\b/gi, ''],

  // "Passionate / dedicated / committed" — every bidder claims this
  [/\bWe are (passionate|deeply committed|dedicated|highly committed) about\b/gi, 'We'],
  [/\bOur (passionate|dedicated|committed) team\b/gi, 'Our team'],

  // Empty meta-prose
  [/\bIt is worth noting that\b/gi, ''],
  [/\bIt is important to (note|recognize|understand) that\b/gi, ''],
  [/\bIt should be (noted|understood|recognized) that\b/gi, ''],
  [/\bSuffice (it )?to say\b/gi, ''],

  // "Solutions" used as a magic word
  [/\binnovative solutions\b/gi, 'approach'],
  [/\btailored solutions\b/gi, 'approach'],
  [/\bend[- ]to[- ]end solutions\b/gi, 'approach'],
];

// ---- Em-dash usage ----
//
// LLMs use em-dashes (—) constantly as breath marks. Real humans use
// commas, parens, or periods in most cases. We convert standalone
// em-dashes (with spaces around them) to commas. We leave em-dashes
// used as ranges (e.g. "Mon–Fri" with no spaces) alone.
function normalizeEmDashes(text: string): { text: string; count: number } {
  let count = 0;
  const next = text.replace(/\s+—\s+/g, () => {
    count++;
    return ', ';
  });
  return { text: next, count };
}

// ---- Triple-adjective stacks ----
//
// "Robust, scalable, and secure solutions" — pattern of three
// adjectives + noun. AI loves this. Humans usually pick one or two.
// We trim to the strongest pair.
//
// Heuristic: comma-comma-and pattern with all adjective-looking tokens.
const TRIPLE_ADJ_RE = /\b([a-z]+(?:able|ive|ous|ful|ant|ent|ic|al)),\s+([a-z]+(?:able|ive|ous|ful|ant|ent|ic|al)),\s+and\s+([a-z]+(?:able|ive|ous|ful|ant|ent|ic|al))\s+/gi;

function simplifyTripleAdjectives(text: string): { text: string; count: number } {
  let count = 0;
  const next = text.replace(TRIPLE_ADJ_RE, (_, a, b, c) => {
    count++;
    void c;
    return `${a} and ${b} `;
  });
  return { text: next, count };
}

// ---- Generic LLM intros — stripped if they appear at the start ----
//
// These are the openings AI defaults to when given a section to write.
// Real writers don't open this way.
const GENERIC_INTRO_PATTERNS: RegExp[] = [
  /^(Here|This) (is|will be) (an?|the) (overview|outline|draft) of[^.]*\.\s*/i,
  /^This section (will|aims to|seeks to) (provide|outline|describe|present)[^.]*\.\s*/i,
  /^I('| a)m (pleased|happy|excited) to (present|share|offer)[^.]*\.\s*/i,
  /^(Below|Following) (is|are) (my|our) (draft|response|approach)[^.]*\.\s*/i,
];

function stripGenericIntros(text: string): { text: string; count: number } {
  let count = 0;
  let next = text.trimStart();
  for (const pattern of GENERIC_INTRO_PATTERNS) {
    if (pattern.test(next)) {
      next = next.replace(pattern, '');
      count++;
    }
  }
  return { text: next, count };
}

// ---- Main ----------------------------------------------------------

export function humanizeProposalDraft(rawDraft: string): { text: string; stats: HumanizationStats } {
  let text = rawDraft;
  const stats: HumanizationStats = {
    emDashesReplaced: 0,
    bannedPhrasesReplaced: 0,
    generic_intros_stripped: 0,
    triple_adjective_stacks_simplified: 0,
  };

  // 1. Strip generic intros (run first so they don't survive the rest)
  const introResult = stripGenericIntros(text);
  text = introResult.text;
  stats.generic_intros_stripped = introResult.count;

  // 2. Replace banned phrases
  for (const [pattern, replacement] of BANNED_PHRASES) {
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) stats.bannedPhrasesReplaced++;
  }

  // 3. Normalize em-dashes
  const dashResult = normalizeEmDashes(text);
  text = dashResult.text;
  stats.emDashesReplaced = dashResult.count;

  // 4. Simplify triple-adjective stacks
  const tripleResult = simplifyTripleAdjectives(text);
  text = tripleResult.text;
  stats.triple_adjective_stacks_simplified = tripleResult.count;

  // 5. Cleanup pass: collapse runaway spaces left by phrase deletions
  text = text.replace(/[ \t]{2,}/g, ' ');
  // Collapse triple+ newlines down to double
  text = text.replace(/\n{3,}/g, '\n\n');
  // Trim spaces at line ends
  text = text.replace(/[ \t]+$/gm, '');
  // Restore sentence capitalization after leading deletions
  text = text.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());

  return { text: text.trim(), stats };
}

/**
 * Convenience: returns just the cleaned text.
 */
export function humanize(rawDraft: string): string {
  return humanizeProposalDraft(rawDraft).text;
}
