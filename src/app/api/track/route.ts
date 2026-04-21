/**
 * Email Tracking API
 *
 * GET /api/track/open?t={token} - Track email open (returns 1x1 transparent GIF)
 * GET /api/track/click?t={token}&url={encodedUrl} - Track link click (redirects to URL)
 */

import { NextRequest, NextResponse } from 'next/server';
import { recordEmailOpen, recordLinkClick } from '@/lib/engagement';

// 1x1 transparent GIF (smallest possible tracking pixel)
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('t');
  const action = searchParams.get('a') || 'open'; // 'open' or 'click'
  const url = searchParams.get('url');

  if (!token) {
    // Return transparent pixel anyway to avoid broken images
    return new NextResponse(TRANSPARENT_GIF, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  }

  try {
    if (action === 'click' && url) {
      // Track click and redirect
      const decodedUrl = decodeURIComponent(url);

      // Record the click (fire and forget)
      recordLinkClick(token, decodedUrl).catch(() => {});

      // Redirect to the actual URL
      return NextResponse.redirect(decodedUrl, { status: 302 });
    } else {
      // Track open (default)
      recordEmailOpen(token).catch(() => {});

      // Return transparent pixel
      return new NextResponse(TRANSPARENT_GIF, {
        status: 200,
        headers: {
          'Content-Type': 'image/gif',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }
  } catch (err) {
    console.error('[track] Error:', err);

    // Always return something valid
    if (action === 'click' && url) {
      return NextResponse.redirect(decodeURIComponent(url), { status: 302 });
    }

    return new NextResponse(TRANSPARENT_GIF, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store',
      },
    });
  }
}
