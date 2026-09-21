/**
 * Beginner opportunity card — renders the view model only.
 * Do not map set-aside / notice / dates here; that lives in src/lib/beginner.
 */
import type { PublicBeginnerCard } from '@/lib/beginner';
import { STAGE_LABEL } from '@/lib/beginner/labels';

/**
 * Stage is the thing a beginner most needs and least knows: an RFI and a
 * Solicitation look identical on a card. Colour + words, not colour alone.
 */
const STAGE_STYLE: Record<PublicBeginnerCard['stage'], string> = {
  open_bid: 'bg-emerald-900/40 text-emerald-200 ring-1 ring-emerald-700/50',
  market_research: 'bg-amber-900/40 text-amber-200 ring-1 ring-amber-700/50',
  upcoming: 'bg-sky-900/40 text-sky-200 ring-1 ring-sky-700/50',
  awarded: 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-600/50',
  informational: 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-600/50',
  unknown: 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-600/50',
};

export function BeginnerOpportunityCard({
  card,
  tone = 'aha',
  onOpen,
}: {
  card: PublicBeginnerCard;
  tone?: 'aha' | 'default';
  onOpen?: () => void;
}) {
  if (!card.grounded) return null;

  const samLabel = tone === 'aha' ? 'See the full opportunity' : 'Open full listing on SAM';

  return (
    <article className="rounded-xl border border-hairline bg-surface p-4">
      <h3 className="text-base font-semibold text-ink">{card.title}</h3>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_STYLE[card.stage]}`}
          data-stage={card.stage}
        >
          {STAGE_LABEL[card.stage]}
        </span>
        {/* The stage badge already says it. A second chip rendered "Coming
            soon — not open yet" next to "Coming soon — get ready". */}
        {card.stage === 'unknown' && card.noticeLabel && (
          <span className="rounded-full bg-navy px-2.5 py-0.5 text-ink">{card.noticeLabel}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted">{card.dueLabel}</p>
      {card.amountLabel && <p className="text-sm text-muted">{card.amountLabel}</p>}
      {card.agencyLabel && <p className="text-sm text-muted">{card.agencyLabel}</p>}
      {card.audienceLabel && <p className="mt-1 text-sm text-ink-soft">{card.audienceLabel}</p>}
      {card.detailPassage && (
        <p className="mt-2 rounded-lg border border-hairline bg-ground-deep p-2 text-xs text-ink-soft">
          <span className="font-medium text-muted">Your words are in this listing&rsquo;s details: </span>
          <q>{card.detailPassage}</q>
        </p>
      )}
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
            onClick={() => onOpen?.()}
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
