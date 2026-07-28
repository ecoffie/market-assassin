/**
 * /app SBIR/STTR panel (Eric 2026-07-28) — the /app shell had NO SBIR surface (only the older
 * /briefings did), so the DoD SBIR ingestion (#6) had nowhere to appear for app users. This mounts the
 * existing, already-working SBIR panel into /app's PanelContainer, so app users can search SBIR/STTR
 * topics — including the new DoD source (Army/Navy/AF/SOCOM/DTRA topics with numbers + close dates).
 *
 * Reuse-don't-rebuild (GOS invariant): the briefings SbirPanel already fetches /api/sbir, renders the
 * API's sourceOptions (which now include "DoD SBIR/STTR"), and searches by keyword/agency/source. We
 * wrap it rather than duplicate 400+ lines; the /app panel signature is { email, tier }.
 */
'use client';

import BriefingsSbirPanel from '@/components/briefings/SbirPanel';
import type { AppTier } from '../UnifiedSidebar';

interface SbirPanelProps {
  email: string | null; // matches the PanelContainer signature (email can be null for a signed-out view)
  tier?: AppTier;
}

// tier is accepted for the uniform /app panel signature; SBIR search is open (no gate) like Grants.
// The briefings panel wants a string; pass '' when signed out (it just omits the X-User-Email header).
export default function SbirPanel({ email }: SbirPanelProps) {
  return <BriefingsSbirPanel email={email ?? ''} />;
}
