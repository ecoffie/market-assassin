/**
 * Redact tool arguments before they are written to an execution log.
 *
 * Logs keep enough to trace a call (which filters, which ids) without holding customer
 * documents or secrets:
 *   - Keys that name a secret or a contact detail are masked.
 *   - Document-like fields (RFP text, proposal drafts, descriptions) and any string over
 *     MAX_INLINE chars are replaced with { redacted, len, sha256 } so two calls can still be
 *     compared without storing the text.
 *   - Depth and array length are bounded.
 */
import { createHash } from 'node:crypto';

const MAX_INLINE = 500;
const MAX_DEPTH = 4;
const MAX_ARRAY = 50;

const SECRET_KEY = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|session)/i;
const CONTACT_KEY = /(email|phone|ssn|tax[_-]?id|ein)/i;
const DOCUMENT_KEY = /^(text|rfp|rfp_text|content|document|documents|draft|body|proposal|proposal_text|description|capability_statement|sow|sow_text|narrative)$/i;

function digest(s: string): { redacted: true; len: number; sha256: string } {
  return { redacted: true, len: s.length, sha256: createHash('sha256').update(s).digest('hex').slice(0, 16) };
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (value == null) return value;
  if (SECRET_KEY.test(key)) return '[secret]';
  if (CONTACT_KEY.test(key)) return '[contact]';
  if (typeof value === 'string') {
    if (DOCUMENT_KEY.test(key) || value.length > MAX_INLINE) return digest(value);
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => redactValue(key, v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY} more]`);
    return out;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(k, v, depth + 1);
    return out;
  }
  return '[unsupported]';
}

export function redactToolArgs(args: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  return redactValue('', args, 0) as Record<string, unknown>;
}
