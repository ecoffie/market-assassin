/**
 * The one-line refund notice shown right next to every button that takes money (Eric,
 * 2026-11-10: "right next to all sales so they see there is no refunds"). Wording matches
 * /terms §3–4: all sales are final, no refunds for partial billing periods.
 *
 * Keep the text in NO_REFUND_TEXT so every sale point says exactly the same thing.
 */
export const NO_REFUND_TEXT = 'All sales final · No refunds';

export default function NoRefundNote({
  className,
  style,
  align = 'center',
}: {
  className?: string;
  style?: React.CSSProperties;
  align?: 'center' | 'left';
}) {
  return (
    <p
      className={className}
      data-no-refund-note=""
      style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.4, opacity: 0.8, textAlign: align, ...style }}
    >
      {NO_REFUND_TEXT}.{' '}
      <a href="/terms" style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}>
        Terms
      </a>
    </p>
  );
}
