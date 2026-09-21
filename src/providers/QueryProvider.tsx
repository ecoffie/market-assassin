'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, ReactNode } from 'react';

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  // Create QueryClient with optimized defaults for 100K users
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Don't refetch on window focus (reduces API calls)
        refetchOnWindowFocus: false,
        // Don't refetch on reconnect (reduces API calls)
        refetchOnReconnect: false,
        // Retry once on failure
        retry: 1,
        // Stale time: data is fresh for 5 minutes
        staleTime: 5 * 60 * 1000,
        // Cache time: keep data in cache for 30 minutes
        gcTime: 30 * 60 * 1000,
      },
      mutations: {
        // Retry mutations once
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

export default QueryProvider;
