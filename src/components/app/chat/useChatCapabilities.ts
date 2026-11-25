'use client';
/**
 * Whether this signed-in user's chat turns may carry pasted screenshots — asked of the server, never read
 * from a build flag, so paste appears only where the server will actually read the image
 * (ASK_MINDY_COMPANY_RESEARCH + its allowlist). Starts false and stays false on any error.
 */
import { useEffect, useState } from 'react';
import { authedFetch } from '../authHeaders';

export const CHAT_CAPABILITIES_PATH = '/api/app/chat/capabilities';
export type ChatCapabilities = { screenshots: boolean };
const NONE: ChatCapabilities = { screenshots: false };

export function useChatCapabilities(email: string | null | undefined): ChatCapabilities {
  const [caps, setCaps] = useState<ChatCapabilities>(NONE);
  useEffect(() => {
    let live = true;
    setCaps(NONE);
    if (!email) return;
    authedFetch(`${CHAT_CAPABILITIES_PATH}?email=${encodeURIComponent(email)}`, email)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setCaps({ screenshots: d.screenshots === true }); })
      .catch(() => { /* stay false */ });
    return () => { live = false; };
  }, [email]);
  return caps;
}
