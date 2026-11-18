'use client';
/**
 * Which Vault document features this signed-in user may see — asked of the server
 * (/api/app/vault/doc-access), never read from a build flag. Starts all-false and stays false on
 * any error, so nothing appears unless the server says so.
 */
import { useEffect, useState } from 'react';
import { authedFetch } from '../authHeaders';

export type VaultCapabilities = { uploads: boolean; generate: boolean };
const NONE: VaultCapabilities = { uploads: false, generate: false };

export function useVaultCapabilities(email: string | null | undefined): VaultCapabilities {
  const [caps, setCaps] = useState<VaultCapabilities>(NONE);
  useEffect(() => {
    let live = true;
    setCaps(NONE);
    if (!email) return;
    authedFetch(`/api/app/vault/doc-access?email=${encodeURIComponent(email)}`, email)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setCaps({ uploads: d.uploads === true, generate: d.generate === true }); })
      .catch(() => { /* stay all-false */ });
    return () => { live = false; };
  }, [email]);
  return caps;
}
