'use client';

interface OpportunityDetailStripProps {
  attachmentCount?: number;
  contactCount?: number;
  deadlineLabel?: string | null;
  deadlineUrgent?: boolean;
  placeLabel?: string | null;
  attachmentsAnchorId?: string;
  contactsAnchorId?: string;
  className?: string;
}

/** Scannable chips — document/contact chips scroll to the rich sections below. */
export default function OpportunityDetailStrip({
  attachmentCount = 0,
  contactCount = 0,
  deadlineLabel,
  deadlineUrgent = false,
  placeLabel,
  attachmentsAnchorId,
  contactsAnchorId,
  className = '',
}: OpportunityDetailStripProps) {
  const scrollTo = (id?: string) => {
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const chips: {
    key: string;
    label: string;
    tone: string;
    onClick?: () => void;
  }[] = [];

  if (attachmentCount > 0) {
    chips.push({
      key: 'attachments',
      label: `📎 ${attachmentCount} document${attachmentCount === 1 ? '' : 's'} ↓`,
      tone: 'border-purple-500/40 bg-purple-500/10 text-purple-200 hover:bg-purple-500/20',
      onClick: () => scrollTo(attachmentsAnchorId),
    });
  }
  if (contactCount > 0) {
    chips.push({
      key: 'contacts',
      label: `👤 ${contactCount} contact${contactCount === 1 ? '' : 's'} ↓`,
      tone: 'border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20',
      onClick: () => scrollTo(contactsAnchorId),
    });
  }
  if (deadlineLabel) {
    chips.push({
      key: 'deadline',
      label: `📅 Due ${deadlineLabel}`,
      tone: deadlineUrgent
        ? 'border-red-500/40 bg-red-500/10 text-red-300'
        : 'border-gray-600/40 bg-gray-800/60 text-gray-300',
    });
  }
  if (placeLabel) {
    chips.push({
      key: 'place',
      label: `📍 ${placeLabel}`,
      tone: 'border-gray-600/40 bg-gray-800/60 text-gray-400',
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {chips.map((chip) => {
        const Tag = chip.onClick ? 'button' : 'span';
        return (
          <Tag
            key={chip.key}
            type={chip.onClick ? 'button' : undefined}
            onClick={chip.onClick}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              chip.tone
            } ${chip.onClick ? 'cursor-pointer' : ''}`}
          >
            {chip.label}
          </Tag>
        );
      })}
    </div>
  );
}
