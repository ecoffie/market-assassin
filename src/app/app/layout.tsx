import LightThemeScope from '@/components/theme/LightThemeScope';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Light look matching the homepage + map (src/components/theme/LightThemeScope.tsx).
  return <LightThemeScope>{children}</LightThemeScope>;
}
