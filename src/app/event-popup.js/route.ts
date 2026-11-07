/** GET /event-popup.js — one-time Nov 28 event pop-up. Script body: src/lib/events/event-popup.ts. */
import { eventPopupScript } from '@/lib/events/event-popup';

export const revalidate = 3600;

export function GET() {
  return new Response(eventPopupScript(), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=600, s-maxage=3600',
    },
  });
}
