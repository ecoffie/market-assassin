import { createHash } from 'node:crypto';
import { getAppSupabase, normalizeEmail } from '@/lib/app/workspace';
import {
  ALLOWED_ALERT_FREQUENCY,
  ALLOWED_SAVED_SEARCH_MODE,
  SAVED_SEARCH_NAME_MAX,
  type SavedSearchAlertFrequency,
  type SavedSearchMode,
} from './constants';
import { normalizeAlertPreferences } from './alert-preferences';
import {
  cronWillDeliverAlerts,
  isProfileScopedFilters,
  isUnsupportedAlertScope,
  unsupportedAlertScopeMessage,
} from './alert-scope';
import { savedSearchFingerprint, savedSearchesMatchFingerprint } from './fingerprint';
import { validateSavedSearchFilters } from './validate-filters';
import type {
  CreateSavedSearchInput,
  DeleteSavedSearchOptions,
  SavedSearchRow,
  SavedSearchServiceResult,
  UpdateSavedSearchInput,
} from './types';

function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || (error.message || '').includes('saved_searches'));
}

function requireActorEmail(email: string): SavedSearchServiceResult<never> | null {
  const trimmed = (email || '').trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    return { ok: false, code: 'invalid_actor', message: 'A signed-in Mindy account is required to schedule market alerts.' };
  }
  if (trimmed === 'stdio@localhost' || trimmed.endsWith('@localhost')) {
    return { ok: false, code: 'invalid_actor', message: 'Saved-search scheduling requires an authenticated Mindy account (not the stdio dev identity).' };
  }
  return null;
}

function rowFromDb(raw: Record<string, unknown>): SavedSearchRow {
  return {
    id: String(raw.id),
    user_email: String(raw.user_email),
    name: String(raw.name),
    mode: raw.mode as SavedSearchMode,
    filters: (raw.filters as Record<string, unknown>) || {},
    bbox: (raw.bbox as SavedSearchRow['bbox']) ?? null,
    alerts_enabled: Boolean(raw.alerts_enabled),
    alert_frequency: raw.alert_frequency as SavedSearchAlertFrequency,
    last_alerted_at: raw.last_alerted_at ? String(raw.last_alerted_at) : null,
    last_seen_notice_ids: Array.isArray(raw.last_seen_notice_ids) ? (raw.last_seen_notice_ids as string[]) : [],
    total_alerts_sent: Number(raw.total_alerts_sent) || 0,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

async function assertProfileScopeAvailable(
  email: string,
  filters: Record<string, unknown>,
): Promise<SavedSearchServiceResult<never> | null> {
  if (!isProfileScopedFilters(filters)) return null;

  const supabase = getAppSupabase();
  const { data: prof, error } = await supabase
    .from('user_profiles')
    .select('naics_codes')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: 'profile_scope_unavailable',
      message: 'Could not verify your profile NAICS for scope=profile. Complete your Mindy profile before scheduling a profile-scoped alert.',
    };
  }

  const codes = (prof?.naics_codes as string[] | null) || [];
  if (!codes.length) {
    return {
      ok: false,
      code: 'profile_scope_unavailable',
      message:
        'scope=profile requires at least one NAICS code on your Mindy profile. Add profile NAICS before scheduling — the alert cron would otherwise skip this search silently.',
    };
  }

  return null;
}

export async function createSavedSearch(
  input: CreateSavedSearchInput,
): Promise<SavedSearchServiceResult<{ search: SavedSearchRow; idempotent: boolean; bbox_omitted: boolean }>> {
  const actorErr = requireActorEmail(input.userEmail);
  if (actorErr) return actorErr;

  const name = (input.name || '').trim();
  if (!name) return { ok: false, code: 'invalid_name', message: 'name is required' };

  const mode: SavedSearchMode = ALLOWED_SAVED_SEARCH_MODE.includes(input.mode as SavedSearchMode)
    ? (input.mode as SavedSearchMode)
    : 'open';
  if (input.mode && !ALLOWED_SAVED_SEARCH_MODE.includes(input.mode)) {
    return { ok: false, code: 'invalid_mode', message: `mode must be one of: ${ALLOWED_SAVED_SEARCH_MODE.join(', ')}` };
  }

  if (input.alertFrequency && !ALLOWED_ALERT_FREQUENCY.includes(input.alertFrequency)) {
    return {
      ok: false,
      code: 'invalid_frequency',
      message: `alert_frequency must be one of: ${ALLOWED_ALERT_FREQUENCY.join(', ')}`,
    };
  }

  const validated = validateSavedSearchFilters(input.filters);
  if (!validated.ok) return { ok: false, code: 'invalid_filters', message: validated.error };

  if (isUnsupportedAlertScope(mode, validated.filters)) {
    return { ok: false, code: 'unsupported_alert_scope', message: unsupportedAlertScopeMessage() };
  }

  if (!cronWillDeliverAlerts(mode, validated.filters)) {
    return { ok: false, code: 'unsupported_alert_scope', message: unsupportedAlertScopeMessage() };
  }

  const email = normalizeEmail(input.userEmail);
  const profileErr = await assertProfileScopeAvailable(email, validated.filters);
  if (profileErr) return profileErr;

  const { alertsEnabled, alertFrequency } = normalizeAlertPreferences({
    alertsEnabled: input.alertsEnabled,
    alertFrequency: input.alertFrequency,
  });

  const fingerprint = savedSearchFingerprint({
    mode,
    filters: validated.filters,
    alertFrequency,
    alertsEnabled,
  });

  const supabase = getAppSupabase();

  const { data: existing, error: listErr } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('user_email', email);

  if (listErr) {
    if (tableMissing(listErr)) {
      return {
        ok: false,
        code: 'scheduler_unavailable',
        message: 'Saved searches are not available yet — run the saved_searches migration.',
      };
    }
    return { ok: false, code: 'scheduler_unavailable', message: listErr.message };
  }

  const dup = (existing || []).find((row: Record<string, unknown>) =>
    savedSearchesMatchFingerprint(
      {
        mode: String(row.mode),
        filters: (row.filters as Record<string, unknown>) || {},
        alert_frequency: String(row.alert_frequency),
        alerts_enabled: Boolean(row.alerts_enabled),
      },
      fingerprint,
    ),
  );
  const bboxOmitted = !(input.bbox && typeof input.bbox === 'object');
  if (dup) {
    return {
      ok: true,
      data: { search: rowFromDb(dup as Record<string, unknown>), idempotent: true, bbox_omitted: bboxOmitted },
    };
  }

  const bbox = input.bbox && typeof input.bbox === 'object' ? input.bbox : null;
  const { data, error } = await supabase
    .from('saved_searches')
    .insert({
      user_email: email,
      name: name.slice(0, SAVED_SEARCH_NAME_MAX),
      mode,
      filters: validated.filters,
      bbox,
      alerts_enabled: alertsEnabled,
      alert_frequency: alertFrequency,
    })
    .select()
    .single();

  if (error) {
    if (tableMissing(error)) {
      return {
        ok: false,
        code: 'scheduler_unavailable',
        message: 'Saved searches are not available yet — run the saved_searches migration.',
      };
    }
    return { ok: false, code: 'scheduler_unavailable', message: error.message };
  }

  return {
    ok: true,
    data: { search: rowFromDb(data as Record<string, unknown>), idempotent: false, bbox_omitted: bboxOmitted },
  };
}

export async function listSavedSearches(
  userEmail: string,
): Promise<SavedSearchServiceResult<{ searches: SavedSearchRow[] }>> {
  const actorErr = requireActorEmail(userEmail);
  if (actorErr) return actorErr;

  const supabase = getAppSupabase();
  const { data, error } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('user_email', normalizeEmail(userEmail))
    .order('created_at', { ascending: false });

  if (error) {
    if (tableMissing(error)) return { ok: true, data: { searches: [] } };
    return { ok: false, code: 'scheduler_unavailable', message: error.message };
  }

  return {
    ok: true,
    data: { searches: (data || []).map((r: Record<string, unknown>) => rowFromDb(r)) },
  };
}

export async function updateSavedSearch(
  input: UpdateSavedSearchInput,
): Promise<SavedSearchServiceResult<{ search: SavedSearchRow; noop: boolean }>> {
  const actorErr = requireActorEmail(input.userEmail);
  if (actorErr) return actorErr;

  const id = (input.id || '').trim();
  if (!id) return { ok: false, code: 'not_found', message: 'id is required' };

  const supabase = getAppSupabase();
  const { data: current, error: readErr } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('id', id)
    .eq('user_email', normalizeEmail(input.userEmail))
    .maybeSingle();

  if (readErr) {
    if (tableMissing(readErr)) {
      return {
        ok: false,
        code: 'scheduler_unavailable',
        message: 'Saved searches are not available yet — run the saved_searches migration.',
      };
    }
    return { ok: false, code: 'scheduler_unavailable', message: readErr.message };
  }
  if (!current) return { ok: false, code: 'not_found', message: 'Saved search not found for this account' };

  const currentRow = rowFromDb(current as Record<string, unknown>);
  const normalized = normalizeAlertPreferences({
    alertsEnabled: typeof input.alertsEnabled === 'boolean' ? input.alertsEnabled : currentRow.alerts_enabled,
    alertFrequency: input.alertFrequency ?? currentRow.alert_frequency,
  });

  const updates: Record<string, unknown> = {};
  if (typeof input.alertsEnabled === 'boolean' || input.alertFrequency !== undefined) {
    updates.alerts_enabled = normalized.alertsEnabled;
    updates.alert_frequency = normalized.alertFrequency;
  }
  if (typeof input.name === 'string' && input.name.trim()) {
    updates.name = input.name.trim().slice(0, SAVED_SEARCH_NAME_MAX);
  }

  if (!Object.keys(updates).length) {
    return { ok: false, code: 'invalid_name', message: 'No valid fields to update' };
  }

  const wouldChange =
    (updates.name !== undefined && updates.name !== currentRow.name) ||
    (updates.alerts_enabled !== undefined && updates.alerts_enabled !== currentRow.alerts_enabled) ||
    (updates.alert_frequency !== undefined && updates.alert_frequency !== currentRow.alert_frequency);

  if (!wouldChange) {
    return { ok: true, data: { search: currentRow, noop: true } };
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('saved_searches')
    .update(updates)
    .eq('id', id)
    .eq('user_email', normalizeEmail(input.userEmail))
    .select()
    .maybeSingle();

  if (error) {
    if (tableMissing(error)) {
      return {
        ok: false,
        code: 'scheduler_unavailable',
        message: 'Saved searches are not available yet — run the saved_searches migration.',
      };
    }
    return { ok: false, code: 'scheduler_unavailable', message: error.message };
  }
  if (!data) return { ok: false, code: 'not_found', message: 'Saved search not found for this account' };

  return { ok: true, data: { search: rowFromDb(data as Record<string, unknown>), noop: false } };
}

export async function deleteSavedSearch(
  userEmail: string,
  id: string,
  options?: DeleteSavedSearchOptions,
): Promise<SavedSearchServiceResult<{ deleted: boolean; noop: boolean }>> {
  const actorErr = requireActorEmail(userEmail);
  if (actorErr) return actorErr;

  if (options?.requireConfirm && options.confirm !== true) {
    return {
      ok: false,
      code: 'confirmation_required',
      message:
        'Destructive delete requires confirm=true. Prefer update_market_schedule with alerts_enabled=false to pause alerts without deleting the saved search.',
    };
  }

  const searchId = (id || '').trim();
  if (!searchId) {
    return { ok: true, data: { deleted: false, noop: true } };
  }

  const supabase = getAppSupabase();
  const { error, count } = await supabase
    .from('saved_searches')
    .delete({ count: 'exact' })
    .eq('id', searchId)
    .eq('user_email', normalizeEmail(userEmail));

  if (error) {
    if (tableMissing(error)) {
      return {
        ok: false,
        code: 'scheduler_unavailable',
        message: 'Saved searches are not available yet — run the saved_searches migration.',
      };
    }
    return { ok: false, code: 'scheduler_unavailable', message: error.message };
  }
  if (!count) {
    return { ok: true, data: { deleted: false, noop: true } };
  }

  return { ok: true, data: { deleted: true, noop: false } };
}

/** Hash for tests/logging without exposing raw filters. */
export function savedSearchFiltersDigest(filters: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex').slice(0, 12);
}
