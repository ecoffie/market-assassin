'use client';

import { AuthProvider } from '@/lib/supabase/AuthContext';

export default function PlannerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}
