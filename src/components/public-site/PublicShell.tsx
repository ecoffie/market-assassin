import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import { MP_ROOT_PAINT_CSS, MP_SITE_CSS } from '@/lib/public-site/css';
import { mpFontPreloadHrefs } from '@/lib/public-site/fonts';
import PublicHeader from './PublicHeader';
import PublicFooter from './PublicFooter';

/**
 * The frame for every public, indexable React page: cream canvas, homepage header and footer,
 * and the shared `mp-*` stylesheet.
 *
 * Render it from a route family's layout.tsx so it paints before any page-level Suspense
 * boundary streams in. Both <style> elements are ordinary in-body elements rather than hoisted
 * resources: they arrive in the first HTML chunk ahead of the content, and they are removed
 * when the page unmounts, so a client navigation into the signed-in app restores its theme.
 */
export default function PublicShell({
  children,
  chrome = true,
}: {
  children: ReactNode;
  /** false renders the canvas and styles without the header and footer. */
  chrome?: boolean;
}) {
  for (const href of mpFontPreloadHrefs({ includeInter: false })) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MP_ROOT_PAINT_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: MP_SITE_CSS }} />
      <div data-site="public" className="mp-site">
        {chrome && (
          <a href="#mp-main" className="mp-skip" data-mp-chrome="">
            Skip to content
          </a>
        )}
        {chrome && <PublicHeader />}
        <main id="mp-main" className="mp-main" tabIndex={-1}>
          {children}
        </main>
        {chrome && <PublicFooter />}
      </div>
    </>
  );
}
