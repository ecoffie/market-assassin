'use client';

/**
 * StaleDataBanner — honest "you're seeing saved data" notice.
 *
 * Shown when a read route degraded gracefully during a database outage: the API
 * served its last-good snapshot (see src/lib/resilience/last-good.ts) instead of
 * erroring. The response carries `_degraded: true` and `_servedAt` (the ISO time
 * the data was actually captured). We surface the REAL age so a user never acts
 * on hours-old opportunities thinking they're live.
 */

function formatServedAt(iso: string | null | undefined): string {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'earlier';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `${time} today`;
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

export default function StaleDataBanner({
  degraded,
  servedAt,
  onRetry,
}: {
  degraded?: boolean;
  servedAt?: string | null;
  onRetry?: () => void;
}) {
  if (!degraded) return null;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        background: '#fbf1de',
        border: '1px solid #efd9ac',
        borderLeft: '4px solid #b45309',
        borderRadius: 8,
        padding: '10px 14px',
        margin: '0 0 14px',
        fontSize: 13.5,
        color: '#7a3d08',
        lineHeight: 1.45,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 15 }}>⚠️</span>
      <span style={{ flex: 1, minWidth: 200 }}>
        <strong>Showing saved data from {formatServedAt(servedAt)}.</strong>{' '}
        Live updates are catching up — this refreshes automatically once the data
        service is back.
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: '#b45309',
            background: '#fff',
            border: '1px solid #efd9ac',
            borderRadius: 6,
            padding: '4px 12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Retry now
        </button>
      )}
    </div>
  );
}
