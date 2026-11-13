'use client';

/** Live countdown to Mindy Day (Nov 28, 2026, 11:00 AM ET = 16:00 UTC). Renders nothing before hydration. */
import { useEffect, useState } from 'react';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';

const START = Date.parse('2026-11-28T16:00:00Z');

export default function Countdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  if (now === null) return <div className="lcb-cd" aria-hidden="true" style={{ minHeight: 64 }} />;
  const left = Math.max(0, START - now);
  if (left === 0) return <p className="mp-label" style={{ marginTop: 18 }}>We&apos;re live now</p>;
  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const cell = (n: number, label: string) => (
    <div style={{ display: 'grid', justifyItems: 'center', minWidth: 58, padding: '10px 8px', border: '1px solid var(--mp-line)', borderRadius: 10, background: 'var(--mp-surface)' }}>
      <b style={{ fontSize: 24, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{String(n).padStart(2, '0')}</b>
      <span className="mp-meta" style={{ fontSize: 11, marginTop: 4 }}>{label}</span>
    </div>
  );
  return (
    <div className="lcb-cd" style={{ marginTop: 18 }} role="timer" aria-label={`${d} days ${h} hours ${m} minutes until we go live`}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{cell(d, 'days')}{cell(h, 'hours')}{cell(m, 'min')}{cell(s, 'sec')}</div>
      <p className="mp-meta" style={{ marginTop: 10 }}>Live only. The {EVENT.claimCredits.toLocaleString('en-US')} free credits go to people who show up live.</p>
    </div>
  );
}
