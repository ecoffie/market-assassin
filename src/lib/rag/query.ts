const STOPWORDS = new Set([
  'about',
  'above',
  'after',
  'again',
  'against',
  'also',
  'and',
  'are',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'can',
  'cannot',
  'does',
  'for',
  'from',
  'has',
  'have',
  'into',
  'may',
  'must',
  'not',
  'or',
  'our',
  'shall',
  'should',
  'that',
  'the',
  'their',
  'this',
  'through',
  'with',
  'would',
]);

export function extractRagSearchTokens(query: string, maxTokens = 12): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 40)
    .filter((token) => !STOPWORDS.has(token));

  return Array.from(new Set(tokens)).slice(0, maxTokens);
}

export function buildLooseRagSearchQuery(query: string, maxTokens = 12): string {
  return extractRagSearchTokens(query, maxTokens).join(' OR ');
}
