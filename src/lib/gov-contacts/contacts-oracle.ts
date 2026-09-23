/**
 * Verdict for the W912PL contact-roster oracle (scripts/verify-oracles.mjs → `contacts`).
 *
 * Three outcomes, not two. A DEGRADED roster (statement timeout / query error) is UNMEASURED:
 * the oracle could not observe the roster, so it must neither pass nor print "0 people".
 * Measured 2026-09-23: W912PL has 182 government-buyer rows, yet under concurrency the lookup
 * hit the 8s PostgREST statement_timeout, queryFederalContacts returned
 * {contacts:[], degraded:true}, and the oracle reported "0 people" — a timeout rendered as an
 * empty office. No source ≠ zero (docs/engineering/silent-failure-registry.md).
 */
export type OracleStatus = 'pass' | 'fail' | 'unmeasured';

export interface RosterLike {
  contacts?: Array<{ contact_email?: string | null; email?: string | null }>;
  degraded?: boolean;
  trace?: string[];
}

export interface ContactsOracleVerdict {
  status: OracleStatus;
  detail: string;
}

export function classifyContactsRoster(r: RosterLike | null | undefined): ContactsOracleVerdict {
  if (!r) return { status: 'unmeasured', detail: 'UNMEASURED — no roster result returned' };
  if (r.degraded) {
    const why = (r.trace || []).filter(Boolean).join(' | ') || 'no trace';
    return { status: 'unmeasured', detail: `UNMEASURED — roster degraded, count unknown (a timeout is not zero): ${why}` };
  }
  const people = r.contacts || [];
  const emails = people.map((p) => String(p.contact_email || p.email || '').toLowerCase()).filter(Boolean);
  const usace = emails.filter((e) => e.includes('usace.army.mil')).length;
  const deptWideFallback = emails.some((e) => /osd\.osbp|osd\.mil/i.test(e));
  // Correct = a real roster (≥3), majority the district's own domain, and NO dept-wide leak.
  const pass = people.length >= 3 && usace >= Math.ceil(people.length / 2) && !deptWideFallback;
  return {
    status: pass ? 'pass' : 'fail',
    detail: `${people.length} people, ${usace} @usace.army.mil, dept-wide-fallback=${deptWideFallback}`,
  };
}
