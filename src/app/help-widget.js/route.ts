/** GET /help-widget.js — the "Get help" button on every page. Script body: src/lib/support/help-widget.ts. */
import { helpWidgetScript } from '@/lib/support/help-widget';

export const revalidate = 3600;

export function GET() {
  return new Response(helpWidgetScript(), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
    },
  });
}
