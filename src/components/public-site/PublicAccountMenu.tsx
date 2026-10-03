'use client';

import { useEffect } from 'react';

/**
 * Mounts the shared account chrome (src/app/opportunity-map/account-menu.ts) on React pages.
 * The markup and script are the same strings the map and homepage emit; the script runs after
 * hydration and swaps the placeholder for "Log In" or the signed-in avatar.
 */
export default function PublicAccountMenu({ html, script }: { html: string; script: string }) {
  useEffect(() => {
    new Function(script)();
  }, [script]);
  return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
}
