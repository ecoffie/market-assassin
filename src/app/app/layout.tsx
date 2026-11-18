import { FONT_CLASS, APP_PRELOADS, preloadFonts } from '@/lib/fonts/self-hosted';
import LightThemeScope from '@/components/theme/LightThemeScope';
import AppMapRoot from '@/components/theme/AppMapRoot';
import '@/components/theme/app-map.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// The Opportunity Map's type system (src/app/opportunity-map/template.html --disp/--mono):
// Space Grotesk 500/600/700 and IBM Plex Mono 400/500/600, self-hosted (src/app/self-hosted-fonts.css).
// The variables are set here, not in the root layout, so only the signed-in app uses them; public
// pages keep their own fonts. Body text stays Inter (root layout).
const FONT_VARS = `${FONT_CLASS.spaceGrotesk} ${FONT_CLASS.plexMono}`;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  preloadFonts(APP_PRELOADS);
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
