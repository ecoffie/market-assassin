import './mi-light.css';
import { mpFontFaceCss } from '@/lib/public-site/fonts';
import MiLightRoot from './MiLightRoot';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SERIF_FACES = mpFontFaceCss({ includeInter: false });

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Light look matching the homepage + map. The wrapper covers SSR; MiLightRoot
  // also puts the class on <html> so portals (modals, drawers) match.
  return (
    <div className="mi-light min-h-dvh">
      <style dangerouslySetInnerHTML={{ __html: SERIF_FACES }} />
      <MiLightRoot />
      {children}
    </div>
  );
}
