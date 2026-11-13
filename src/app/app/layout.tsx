import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import LightThemeScope from '@/components/theme/LightThemeScope';
import AppMapRoot from '@/components/theme/AppMapRoot';
import '@/components/theme/app-map.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The Opportunity Map's type system (src/app/opportunity-map/template.html --disp/--mono).
// Loaded here, not in the root layout, so only the signed-in app gets them; public pages
// keep their own fonts. Body text stays Inter (root layout).
const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const FONT_VARS = `${spaceGrotesk.variable} ${plexMono.variable}`;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Light look (LightThemeScope / mi-light.css) + the Opportunity Map palette and fonts on
  // top (app-map.css, scoped to .mi-app, which only this layout renders).
  return (
    <LightThemeScope>
      <div className={`mi-app min-h-dvh ${FONT_VARS}`}>
        <AppMapRoot classes={FONT_VARS} />
        {children}
      </div>
    </LightThemeScope>
  );
}
