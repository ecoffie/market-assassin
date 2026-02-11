import { useState, useMemo, useCallback } from 'react';

export interface PaginationResult<T> {
  currentItems: T[];
  totalItems: number;
  showingCount: number;
  hasMore: boolean;
  showMore: () => void;
  showAll: () => void;
  reset: () => void;
}

/**
 * Cumulative "Load More" pagination hook.
 * Shows first `perPage` items, then expands by `perPage` on each showMore() call.
 */
export function usePagination<T>(items: T[], perPage: number): PaginationResult<T> {
  const [visibleCount, setVisibleCount] = useState(perPage);

  const currentItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount]
  );

  const hasMore = visibleCount < items.length;

  const showMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + perPage, items.length));
  }, [perPage, items.length]);

  const showAll = useCallback(() => {
    setVisibleCount(items.length);
  }, [items.length]);

  const reset = useCallback(() => {
    setVisibleCount(perPage);
  }, [perPage]);

  return {
    currentItems,
    totalItems: items.length,
    showingCount: currentItems.length,
    hasMore,
    showMore,
    showAll,
    reset,
  };
}
