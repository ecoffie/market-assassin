import PublicShell from '@/components/public-site/PublicShell';

/** /customers renders inside the shared public shell (homepage top bar + footer). */
export default function CustomersLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
