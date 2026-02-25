/**
 * Post-generation humanizer — strips common AI writing patterns
 * that make LinkedIn posts sound robotic or AI-generated.
 * Runs as a text transform after Grok generates content.
 */

// Phrases that AI models overuse — matched case-insensitively at line start or after newlines
const AI_OPENER_PATTERNS: [RegExp, string][] = [
  // Filler openers that add nothing
  [/^In today['']s (?:rapidly evolving |ever-changing |fast-paced )?(?:landscape|world|environment|era),?\s*/im, ''],
  [/^In the (?:rapidly evolving |ever-changing |fast-paced )?(?:world|landscape|realm) of .{5,40},?\s*/im, ''],
  [/^(?:Let['']s )?(?:dive|delve) (?:in|into|deeper)[.!]?\s*/im, ''],
  [/^Here['']s the (?:thing|deal|reality|truth)[.:]\s*/im, ''],
  [/^(?:It['']s worth noting|It goes without saying|Needless to say)[.:,]?\s*/im, ''],
  [/^(?:Have you ever (?:wondered|stopped to think|considered))[?]?\s*/im, ''],
  [/^(?:Picture this|Imagine this|Think about it)[.:]\s*/im, ''],
  [/^(?:Let me (?:be (?:clear|honest|real)|share (?:something|a secret)))[.:]\s*/im, ''],
  [/^(?:The (?:reality|truth|fact) is)[,:]?\s*/im, ''],
  [/^(?:At the end of the day)[,:]?\s*/im, ''],
];

// Mid-text AI filler phrases — replaced inline
const AI_FILLER_PATTERNS: [RegExp, string][] = [
  [/\bIt['']s worth noting that\b/gi, ''],
  [/\bIt goes without saying that\b/gi, ''],
  [/\bNeedless to say,?\s*/gi, ''],
  [/\bIn this day and age,?\s*/gi, ''],
  [/\bAt the end of the day,?\s*/gi, ''],
  [/\bMoving forward,?\s*/gi, ''],
  [/\bThat being said,?\s*/gi, ''],
  [/\bWith that in mind,?\s*/gi, ''],
  [/\bIt['']s no secret that\b/gi, ''],
  [/\bThe bottom line is,?\s*/gi, ''],
  [/\bAs we (?:all )?know,?\s*/gi, ''],
  [/\bLet that sink in[.!]?\s*/gi, ''],
  [/\bRead that again[.!]?\s*/gi, ''],
  [/\bFull stop[.!]?\s*/gi, ''],
  [/\bPeriod[.!]?\s*/gi, ''],
  [/\bGame[- ]changer[.!]?\s*/gi, ''],
  [/\bThis is huge[.!]?\s*/gi, ''],
];

// Overused AI adjective clusters
const AI_ADJECTIVE_PATTERNS: [RegExp, string][] = [
  [/\bseamless(?:ly)?\b/gi, 'smooth'],
  [/\bleverage\b/gi, 'use'],
  [/\bleverage(?:d|s|ing)\b/gi, (match: string) => match.replace(/leverage/i, 'use')],
  [/\butilize\b/gi, 'use'],
  [/\butiliz(?:ed|es|ing)\b/gi, (match: string) => match.replace(/utiliz/i, 'us')],
  [/\brunway\b/gi, 'opportunity'],
  [/\bsynerg(?:y|ies|ize)\b/gi, 'alignment'],
  [/\bholistic(?:ally)?\b/gi, 'complete'],
  [/\brobust\b/gi, 'strong'],
  [/\bscalable\b/gi, 'flexible'],
  [/\btransformative\b/gi, 'significant'],
  [/\bparadigm shift\b/gi, 'major change'],
  [/\bpivot(?:al)?\b/gi, 'key'],
  [/\bgame[- ]changing\b/gi, 'important'],
  [/\bcutting[- ]edge\b/gi, 'advanced'],
  [/\bgroundbreaking\b/gi, 'new'],
] as [RegExp, string][];

/**
 * Humanize a single post by stripping AI patterns.
 * Preserves markdown bold/italic formatting.
 */
export function humanizePost(text: string): string {
  let result = text;

  // Strip AI opener patterns (only first match — these appear at start)
  for (const [pattern, replacement] of AI_OPENER_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  // Strip mid-text filler phrases
  for (const [pattern, replacement] of AI_FILLER_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  // Replace overused AI adjectives
  for (const [pattern, replacement] of AI_ADJECTIVE_PATTERNS) {
    result = result.replace(pattern, replacement as string);
  }

  // Convert double dashes to proper em dash or remove excessive usage
  result = result
    .replace(/\s*--\s*/g, ' — ')         // Double dash to em dash with spaces
    .replace(/\s*———*\s*/g, ' — ')       // Triple+ em dashes to single
    .replace(/(.*—.*—.*?)—/g, '$1:')     // 3+ em dashes in one line — replace extras with colon

  // Clean up artifacts: double spaces, orphaned punctuation, leading commas
  result = result
    .replace(/^\s*,\s*/gm, '')           // Lines starting with comma after removal
    .replace(/\.\s*\./g, '.')            // Double periods
    .replace(/  +/g, ' ')               // Double spaces
    .replace(/\n\s*\n\s*\n/g, '\n\n')   // Triple+ newlines
    .trim();

  // Capitalize first letter if it got lowercased after removal
  if (result.length > 0 && /^[a-z]/.test(result)) {
    // Only capitalize if the line doesn't start with markdown bold
    if (!result.startsWith('*')) {
      result = result.charAt(0).toUpperCase() + result.slice(1);
    }
  }

  return result;
}
