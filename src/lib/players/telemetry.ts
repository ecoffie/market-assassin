/**
 * Players request telemetry — the dimensions needed to diagnose a "0 Players" report after the
 * fact (the 2026-10-04 audit could not recover the original zero query: map events never recorded
 * the Players NAICS filter or its result).
 *
 * Server-side, so it is not subject to the beacon/strong-auth loss. Deliberately NO user identity:
 * `user_email` is NOT NULL, so it carries a fixed system sentinel (never an email, cannot collide
 * with one), and the name search is recorded as presence + length, never its text.
 * `event_source='players_api'` keeps it out of the opportunity_map funnel's user counts.
 */
import { createClient } from '@supabase/supabase-js';
import type { PlayersStatus, PlayersSource } from './truth';

export const PLAYERS_TELEMETRY_SENTINEL = 'system:players-api';

export interface PlayersResultEvent {
  type: 'companies';
  naics: string;            // comma-joined codes as requested ('' = none)
  geoLevel: 'national' | 'state' | 'city';
  states: string[];
  droppedStates: number;
  explicitState: boolean;
  hasSearch: boolean;
  searchLen: number;
  setAside: string;
  hasAgency: boolean;
  total: number | null;     // null = unknown
  shown: number;
  status: PlayersStatus;
  source: PlayersSource;
  sourceActionMax: string | null;
  ms: number;
}

export function playersTelemetryRow(e: PlayersResultEvent) {
  return {
    user_email: PLAYERS_TELEMETRY_SENTINEL,
    event_type: 'tool_use',
    event_source: 'players_api',
    metadata: { action: 'players_result', ...e },
  };
}

/**
 * Production deployments only (VERCEL_ENV=production) — a preview or local run must never write
 * telemetry rows into the production database. Never throws, never blocks the response on failure.
 */
export function playersTelemetryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production';
}

export async function recordPlayersResult(e: PlayersResultEvent): Promise<void> {
  if (!playersTelemetryEnabled()) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    const { error } = await createClient(url, key).from('user_engagement').insert(playersTelemetryRow(e));
    if (error) console.error('[players-telemetry] insert failed:', error.message);
  } catch (err) {
    console.error('[players-telemetry] insert threw:', (err as Error).message);
  }
}
