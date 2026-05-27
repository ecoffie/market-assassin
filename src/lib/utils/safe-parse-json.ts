/**
 * Robust AI-output JSON parser.
 *
 * Generalization of the briefings `extractAndParseJSON` helper, with
 * Content Reaper's "never throw — fall back" pattern added on top.
 *
 * LLMs wrap JSON in code fences, prefix with prose ("Sure, here you
 * go:"), append explanatory text, or emit slightly-malformed JSON with
 * trailing commas or stray newlines inside strings. This helper:
 *
 *   1. Strips markdown code fences (```json ... ```)
 *   2. Slices to the outermost {} or [] (handles wrapper prose)
 *   3. Sanitizes control chars + normalizes newlines
 *   4. Removes newlines inside string values (LLM streaming artifact)
 *   5. Tries JSON.parse
 *   6. On failure: tries again with whitespace collapsed
 *   7. On final failure: returns the supplied fallback (or throws if
 *      no fallback provided — same as the original extractAndParseJSON)
 *
 * Use everywhere `JSON.parse(aiResponse)` exists. Eliminates a real
 * class of 500 errors from LLM output variance.
 *
 * Content Reaper pattern #7 — built 2026-05-27 from the audit.
 */

interface SafeParseOptions<T> {
  /** Return this if parsing fails. If omitted, throws on failure
   *  (matching extractAndParseJSON behavior). */
  fallback?: T;
  /** Prefer array extraction (uses [...] braces) instead of object. */
  shape?: 'object' | 'array';
  /** Tag for log lines. Helps identify which caller is misbehaving. */
  source?: string;
}

export function safeParseJSON<T>(
  responseText: string,
  options: SafeParseOptions<T> = {}
): T {
  const { fallback, shape = 'object', source = 'safeParseJSON' } = options;

  if (!responseText || typeof responseText !== 'string') {
    if (fallback !== undefined) return fallback;
    throw new Error(`[${source}] Empty AI response`);
  }

  let jsonStr = responseText.trim();

  // 1. Strip markdown code fences
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // 2. Slice to outermost brace pair
  if (shape === 'array') {
    const firstBracket = jsonStr.indexOf('[');
    const lastBracket = jsonStr.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      jsonStr = jsonStr.slice(firstBracket, lastBracket + 1);
    }
  } else {
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
  }

  // 3. Sanitize control chars
  // eslint-disable-next-line no-control-regex
  jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
  jsonStr = jsonStr.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 4. Remove raw newlines inside string values (LLM streaming artifact)
  let result = '';
  let inString = false;
  let prevChar = '';
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    }
    result += (char === '\n' && inString) ? ' ' : char;
    prevChar = (char === '\\' && prevChar === '\\') ? '' : char;
  }
  jsonStr = result;

  // 5. Try parse
  try {
    return JSON.parse(jsonStr) as T;
  } catch (firstError) {
    // 6. Try again with whitespace collapsed
    const sanitized = jsonStr.replace(/\n/g, ' ').replace(/\s+/g, ' ');
    try {
      return JSON.parse(sanitized) as T;
    } catch (secondError) {
      // 7. Fallback or throw
      console.error(`[${source}] JSON parse failed (both attempts):`, {
        firstError: firstError instanceof Error ? firstError.message : String(firstError),
        secondError: secondError instanceof Error ? secondError.message : String(secondError),
        preview: responseText.slice(0, 300),
      });
      if (fallback !== undefined) return fallback;
      throw new Error(`[${source}] Failed to parse AI response as JSON: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
    }
  }
}
