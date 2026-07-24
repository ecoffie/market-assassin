/**
 * /opportunity-map — the full Federal Opportunity Map (ported from Eric's evc prototype to
 * live data). Reached from the /home-v5 hero mini-map ("Open the full map"). Full-screen
 * map + list + filters. Data fetched server-side; the map itself is a client component.
 *
 * mcpConnected drives the "Draft with Mindy" target: false → Mindy's own proposal drafter;
 * true → the user's connected agent (per Eric — "Mindy's unless they have MCP connected").
 * MCP-connection detection is a fast-follow; defaults to the Mindy drafter today.
 */
import type { Metadata } from 'next';
import { getMapOpportunities, SET_GROUPS } from '@/lib/opportunities/map-data';
import OpportunityMap from '@/components/app/OpportunityMap';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Federal Opportunity Map — Mindy',
  description: 'Live federal opportunities on a map, colored by set-aside — SDVOSB, small business, 8(a), WOSB, HUBZone.',
};

export default async function OpportunityMapPage() {
  const opps = await getMapOpportunities(600).catch(() => []);
  const setGroups = SET_GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color }));
  return <OpportunityMap opps={opps} setGroups={setGroups} mcpConnected={false} />;
}
