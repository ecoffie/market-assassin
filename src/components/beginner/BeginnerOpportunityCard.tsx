/**
 * Beginner opportunity card — renders the view model only.
 * Do not map set-aside / notice / dates here; that lives in src/lib/beginner.
 */
import type { PublicBeginnerCard } from '@/lib/beginner';

export function BeginnerOpportunityCard({
  card,
  tone = 'aha',
}: {
  card: PublicBeginnerCard;
  tone?: 'aha' | 'default';
}) {
  if (!card.grounded) return null;

  const samLabel = tone === 'aha' ? 'See the full opportunity' : 'Open full listing on SAM';

  return (
    <article className="rounded-xl border border-hairline bg-surface p-4">
      <h3 className="text-base font-semibold text-ink">{card.title}</h3>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {card.noticeLabel && (
          <span className="rounded-full bg-navy px-2.5 py-0.5 text-ink">{card.noticeLabel}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted">Due: {card.dueLabel}</p>
      {card.amountLabel && <p className="text-sm text-muted">{card.amountLabel}</p>}
      {card.agencyLabel && <p className="text-sm text-muted">{card.agencyLabel}</p>}
      {card.audienceLabel && <p className="mt-1 text-sm text-ink-soft">{card.audienceLabel}</p>}
      {card.searchContext && <p className="mt-2 text-xs text-faint">{card.searchContext}</p>}
      {card.plainMeaning && (
        <p className="mt-3 text-sm text-ink">
          <span className="font-medium">What this means: </span>
          {card.plainMeaning}
        </p>
      )}
      <p className="mt-1 text-sm text-ink">
        <span className="font-medium">Next step: </span>
        {card.nextStep}
      </p>
      {card.samUrl && (
        <p className="mt-3">
          <a
            href={card.samUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-accent underline"
          >
            {samLabel}
          </a>
        </p>
      )}
      {card.referenceNumber && (
        <p className="mt-2 text-xs text-faint">Reference #: {card.referenceNumber}</p>
      )}
    </article>
  );
}
