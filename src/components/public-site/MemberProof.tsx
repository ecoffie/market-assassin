'use client';

/**
 * "Mindy members' companies have won $1.3B in federal contracts · 1,700+ contractors use Mindy".
 * Numbers come from /api/public/member-proof (derived from the member contract-wins report).
 * Renders nothing until they load, and nothing if the snapshot is missing or stale.
 */
import { useEffect, useState } from 'react';
import { proofCount, proofDollars, type MemberProof as Proof } from '@/lib/admin/member-proof-format';

export default function MemberProof({ align = 'center' }: { align?: 'center' | 'left' }) {
  const [p, setP] = useState<Proof | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/public/member-proof')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j?.available) setP(j as Proof); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!p) return null;
  return (
    <p
      style={{
        margin: '12px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--mp-muted)',
        textAlign: align, fontFamily: 'var(--mp-font-sans)',
      }}
    >
      <strong style={{ color: 'var(--mp-ink)', fontWeight: 600 }}>{proofCount(p.members)} contractors</strong> use Mindy.
      Their companies have won <strong style={{ color: 'var(--mp-ink)', fontWeight: 600 }}>{proofDollars(p.lifetimeDollars)}</strong> in
      federal contracts.
    </p>
  );
}
