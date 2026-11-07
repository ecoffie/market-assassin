import type { ReactNode } from 'react';
import LightThemeScope from '@/components/theme/LightThemeScope';

// Old dark-styled pages get the light homepage look (src/components/theme/LightThemeScope.tsx).
export default function Layout({ children }: { children: ReactNode }) {
  return <LightThemeScope>{children}</LightThemeScope>;
}
