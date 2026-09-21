/**
 * scrub-pii — redact contact PII from RAG chunk text before it reaches an LLM.
 *
 * Why (Eric, Jun 2026): the Mindy knowledge base is Eric's 8-year teaching
 * corpus + 743 podcast transcripts. A live audit found real contact details
 * embedded in the chunks — personal emails (eric@excellri.com), government POC
 * addresses (bianca.d.henderson@navy.mil), and ~6,300 phone numbers. Mindy Chat
 * grounds her answers on these chunks, so without scrubbing she can volunteer a
 * real person's email or phone in a reply. The system-prompt instruction
 * ("never name people") is advisory — an LLM will leak what's in its context.
 * This scrubs at the data boundary so the contact details never reach the model.
 *
 * Scope: contact PII only (emails, phone numbers, raw SSNs). We deliberately do
 * NOT strip names/company names here — that would gut legitimate teaching content
 * ("how Booz Allen structures a bid"). Name-handling stays a prompt concern; the
 * hard PII (things that enable real-world contact) is removed mechanically.
 *
 * If a user actually needs a buying-office POC, that lives in the Decision Makers
 * panel (sourced from SAM, not the teaching KB) — chat should never be the channel.
 */

// Email: standard local@domain. Catches john.smith@x.com, eric@excellri.com,
// bianca.d.henderson@navy.mil, proposals@abcgovservices.com.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Phone: US formats — (305) 929-1619, 305-929-1619, 538 540 5585, +1 305...,
// 3059291619. Requires a 3-3-4 shape so we don't nuke contract numbers or
// dollar figures (those rarely match the 3-3-4 separator pattern, and a leading
// boundary keeps us off long digit runs like UEIs/PIIDs).
const PHONE_RE = /(?<![\d-])(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?![\d-])/g;

// SSN: 123-45-6789 (rare in this corpus, but cheap to guard).
const SSN_RE = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g;

/**
 * Redact contact PII from a single string. Returns the cleaned string;
 * input is never mutated.
 */
export function scrubPii(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL_RE, '[email redacted]')
    .replace(SSN_RE, '[redacted]')
    .replace(PHONE_RE, '[phone redacted]');
}
