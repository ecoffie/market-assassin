import PublicShell from '@/components/public-site/PublicShell';

/** The "How it works" feature pages render inside the shared public shell (homepage top bar + footer). */
export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
