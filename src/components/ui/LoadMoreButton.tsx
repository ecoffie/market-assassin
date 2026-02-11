'use client';

interface LoadMoreButtonProps {
  showingCount: number;
  totalItems: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onShowAll?: () => void;
  label?: string;
}

export default function LoadMoreButton({
  showingCount,
  totalItems,
  hasMore,
  onLoadMore,
  onShowAll,
  label = 'items',
}: LoadMoreButtonProps) {
  if (!hasMore) return null;

  const remaining = totalItems - showingCount;

  return (
    <div className="flex items-center justify-center gap-4 pt-4">
      <span className="text-sm text-slate-400">
        Showing {showingCount} of {totalItems} {label}
      </span>
      <button
        onClick={onLoadMore}
        className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-sm font-semibold rounded-lg transition-colors border border-blue-500/30"
      >
        Load More
      </button>
      {onShowAll && remaining > 10 && (
        <button
          onClick={onShowAll}
          className="px-3 py-2 text-slate-400 hover:text-slate-200 text-sm font-medium transition-colors"
        >
          Show All ({totalItems})
        </button>
      )}
    </div>
  );
}
