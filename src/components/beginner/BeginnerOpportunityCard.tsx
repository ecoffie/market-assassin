/**
 * Beginner opportunity card — renders the view model only.
 * Do not map set-aside / notice / dates here; that lives in src/lib/beginner.
 */
import type { BeginnerOpportunityCard as CardModel } from '@/lib/beginner';

export function BeginnerOpportunityCard({ card }: { card: CardModel }) {
  if (!card.grounded) return null;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {card.noticeLabel && (
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-800">{card.noticeLabel}</span>
        )}
        {card.setAsideLabel && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-700">{card.setAsideLabel}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">Due: {card.dueLabel}</p>
      {card.amountLabel && <p className="text-sm text-slate-600">{card.amountLabel}</p>}
      {card.agencyLabel && <p className="text-sm text-slate-600">{card.agencyLabel}</p>}
      {card.audienceLabel && <p className="mt-1 text-sm text-slate-700">{card.audienceLabel}</p>}
      {card.pscLabel && <p className="text-sm text-slate-600">{card.pscLabel}</p>}
      {card.searchContext && (
        <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">{card.searchContext}</p>
      )}
      {card.plainMeaning && (
        <p className="mt-3 text-sm text-slate-800">
          <span className="font-medium">What this means: </span>
          {card.plainMeaning}
        </p>
      )}
      <p className="mt-1 text-sm text-slate-800">
        <span className="font-medium">Next step: </span>
        {card.nextStep}
      </p>
      {card.samUrl && (
        <p className="mt-3">
          <a
            href={card.samUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-indigo-700 underline"
          >
            Open full listing on SAM
          </a>
        </p>
      )}
      {card.referenceNumber && (
        <p className="mt-2 text-xs text-slate-500">Reference #: {card.referenceNumber}</p>
      )}
    </article>
  );
}
