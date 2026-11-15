/**
 * Detects an answer that turns "no incumbent found" into "there is no incumbent".
 *
 * Production smoke (2026-11-15, gpt-4o-mini): "There are no prior awards reported for this solicitation,
 * so it appears there is no incumbent at this time." The lookup only established that USASpending had no
 * matching prior award; work can be new, or the predecessor can sit under another number or title.
 *
 * Used by tests and the live wording check. Hedges ("could not identify an incumbent", "no incumbent was
 * found", "no incumbent could be confirmed") are allowed; claims of absence are not.
 */
const OVERCLAIMS: RegExp[] = [
  /\b(there\s+is|there's|there\s+was)\s+(currently\s+)?no\s+(current\s+|existing\s+|known\s+)?incumbent\b(?!\s+(listed|named|recorded|on\s+record|in\s+the\s+(award\s+)?records|(was|were|could|can|has\s+been)\s+(found|identified|confirmed|listed|named)))/i,
  /\b(appears|seems)\s+(that\s+)?(there\s+is\s+|to\s+be\s+|to\s+have\s+)?no\s+(current\s+|existing\s+)?incumbent\b/i,
  /\bno\s+one\s+(currently\s+)?(holds|held|has)\s+(it|this|the\s+contract)\b/i,
  /\b(does\s+not|doesn't|did\s+not|didn't)\s+have\s+an?\s+(current\s+|existing\s+)?incumbent\b/i,
  /\b(this|it)\s+(is|appears\s+to\s+be|seems\s+to\s+be|looks\s+like)\s+(a\s+)?(brand[-\s]new|new|first[-\s]time|greenfield)\s+(requirement|contract|procurement|buy|award)\b/i,
  /\bwithout\s+an?\s+incumbent\b/i,
];

export function overclaimsIncumbentAbsence(answer: string): boolean {
  const text = String(answer || '');
  return OVERCLAIMS.some((r) => r.test(text));
}
