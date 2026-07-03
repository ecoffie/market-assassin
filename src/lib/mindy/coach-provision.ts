/**
 * Coach Mode client + org provisioning — the ONE place a client business becomes
 * a workspace under an org. Extracted from the coach route so single "add client"
 * AND bulk import (and any future admin/script path) share IDENTICAL logic — no
 * drift between how one client vs. fifty get created.
 *
 * Each client = a workspace (`workspace_id`), reusing the existing workspace model
 * (memory: coach_mode_tenancy — shared DB + org_id scoping, NOT a separate DB).
 * A provisioned client always ends up with a row in user_notification_settings
 * (the source of truth), seeded from capability text when provided.
 */
import { buildProfileFromText } from '@/lib/market/profile-from-text';

const CLIENT_EMAIL_DOMAIN = 'clients.getmindy.ai';

/** Synthetic per-workspace email used to key workspace-scoped rows for a client. */
export function clientWorkspaceEmail(workspaceId: string): string {
  return `${workspaceId}@${CLIENT_EMAIL_DOMAIN}`;
}

/** Stable, collision-resistant workspace id from org + business name. */
export function clientWorkspaceId(orgId: string, businessName: string): string {
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `org-${orgId.slice(0, 8)}-${slug || 'client'}`;
}

/** A coach-supplied client email → deliverable recipient, or null (blanks + the
 *  synthetic namespace are undeliverable). */
export function recipientFromPrimary(primaryEmail?: string | null): string | null {
  const e = (primaryEmail || '').trim().toLowerCase();
  if (!e || !e.includes('@') || e.endsWith(`@${CLIENT_EMAIL_DOMAIN}`)) return null;
  return e;
}

/** Max rows one bulk import will touch (protects the function budget / rate limits). */
export const BULK_IMPORT_MAX_ROWS = 500;

export interface ParsedBulkRow {
  businessName: string;
  capabilityText: string | null;
  primaryEmail: string | null;
}

/**
 * Normalize a raw bulk-import payload into clean rows: accepts business_name|name,
 * caps at BULK_IMPORT_MAX_ROWS, drops rows with no business name. Pure — no I/O.
 */
export function parseBulkImportRows(clients: unknown): ParsedBulkRow[] {
  const rowsIn = Array.isArray(clients) ? clients : [];
  return rowsIn
    .slice(0, BULK_IMPORT_MAX_ROWS)
    .map((raw): ParsedBulkRow => {
      const r = (raw ?? {}) as Record<string, unknown>;
      return {
        businessName: String(r.business_name || r.name || '').trim(),
        capabilityText: r.capability_text ? String(r.capability_text) : null,
        primaryEmail: r.primary_email ? String(r.primary_email) : null,
      };
    })
    .filter((r) => r.businessName);
}

/**
 * Cap math for a bulk import. `maxClients=null` means UNLIMITED (enterprise orgs) —
 * the branch that, if wrong, would silently truncate an SBDC/APEX importing hundreds
 * of clients. Returns how many to process now and how many are rejected for cap.
 * Pure — the caller supplies the current active count.
 */
export function computeBulkImportCap(
  rowCount: number,
  maxClients: number | null | undefined,
  existingActive: number,
): { remaining: number; rejectedForCap: number } {
  const remaining = maxClients == null ? rowCount : Math.max(0, maxClients - (existingActive || 0));
  const toProcess = Math.min(rowCount, remaining);
  return { remaining: toProcess, rejectedForCap: rowCount - toProcess };
}

export interface SeedResult {
  naics: string[];
  psc: string[];
  keywords: string[];
  states: string[];
  setAsides: string[];
  agencies: number;
}

/**
 * Seed a client workspace's market profile from pasted capability/website text.
 * Uses the SHARED buildProfileFromText engine (the same one onboarding uses), so a
 * coach adding a client they don't deeply understand gets Mindy's grounded
 * extraction (real industry, USASpending-grounded codes, states, set-asides, buyers).
 */
export async function seedClientProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  businessName: string,
  text: string,
  primaryEmail?: string | null,
): Promise<SeedResult> {
  const p = await buildProfileFromText(text);
  const naics = p?.naics || [];
  const psc = p?.topPsc ? [p.topPsc.code] : [];
  const keywords = p?.keywords || [];
  const states = p?.states || [];
  const setAsides = p?.setAsides || [];

  const clientEmail = clientWorkspaceEmail(workspaceId);
  await supabase.from('user_notification_settings').upsert({
    user_email: clientEmail,
    alert_recipient_email: recipientFromPrimary(primaryEmail),
    naics_codes: naics,
    psc_codes: psc,
    keywords,
    location_states: states,
    set_aside_certifications: setAsides,
    business_type: 'Small Business',
    primary_industry: businessName,
    alerts_enabled: true,
    alert_frequency: 'weekly',   // gentle for a tracked client, not daily spam
    is_active: true,
  }, { onConflict: 'user_email' });

  // Pre-load the top buying agencies into the client's Target List (who to talk to).
  let agenciesSeeded = 0;
  if (p?.agencies?.length) {
    const targets = p.agencies.slice(0, 6).map((a) => ({
      workspace_id: workspaceId,
      user_email: clientEmail,
      agency_name: a.name,
      set_aside_spending: a.amount,
      status: 'targeting',
      added_from: 'capability_text_seed',
      source_naics: naics.join(','),
    }));
    const { error } = await supabase.from('user_target_list').insert(targets);
    if (!error) agenciesSeeded = targets.length;
  }

  return { naics, psc, keywords, states, setAsides, agencies: agenciesSeeded };
}

/**
 * Name-only client (no capability text, or text that yielded no codes): still write
 * a minimal profile row so the client ALWAYS exists in the source-of-truth table
 * (alerts off until codes are added). Without it a client-mode read silently has
 * nothing to return and a write-path bug could fall back to the coach's own row.
 */
export async function ensureClientProfileRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  businessName: string,
  primaryEmail?: string | null,
): Promise<void> {
  await supabase.from('user_notification_settings').upsert({
    user_email: clientWorkspaceEmail(workspaceId),
    alert_recipient_email: recipientFromPrimary(primaryEmail),
    naics_codes: [],
    psc_codes: [],
    keywords: [],
    location_states: [],
    set_aside_certifications: [],
    business_type: 'Small Business',
    primary_industry: businessName,
    alerts_enabled: false,
    alert_frequency: 'weekly',
    is_active: true,
  }, { onConflict: 'user_email', ignoreDuplicates: true });
}

export interface ProvisionClientInput {
  businessName: string;
  primaryEmail?: string | null;
  capabilityText?: string | null;
  assignedCoach?: string | null;
}

export interface ProvisionClientResult {
  ok: boolean;
  workspaceId: string;
  businessName: string;
  clientId?: string;
  seeded: SeedResult | null;
  reallySeeded: boolean;
  skipped?: 'duplicate';
  error?: string;
}

/**
 * Provision ONE client under an org: insert the org_clients row, then seed (or
 * ensure) its profile. Idempotent on (org_id, workspace_id) — a re-run of the same
 * business name reports `skipped: 'duplicate'` instead of erroring, so bulk import
 * is safe to retry. This is the shared unit both single-add and bulk import call.
 */
export async function provisionClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  input: ProvisionClientInput,
): Promise<ProvisionClientResult> {
  const businessName = (input.businessName || '').trim();
  const workspaceId = clientWorkspaceId(orgId, businessName);
  if (!businessName) {
    return { ok: false, workspaceId, businessName, seeded: null, reallySeeded: false, error: 'business_name required' };
  }

  // Idempotent insert: skip if this org already has this workspace (retry-safe).
  const { data: existing } = await supabase
    .from('org_clients')
    .select('id')
    .eq('org_id', orgId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (existing) {
    return { ok: true, workspaceId, businessName, clientId: existing.id, seeded: null, reallySeeded: false, skipped: 'duplicate' };
  }

  const { data, error } = await supabase.from('org_clients').insert({
    org_id: orgId,
    workspace_id: workspaceId,
    business_name: businessName,
    primary_email: input.primaryEmail || null,
    assigned_coach: input.assignedCoach || null,
  }).select('id').single();
  if (error) {
    return { ok: false, workspaceId, businessName, seeded: null, reallySeeded: false, error: error.message };
  }

  let seeded: SeedResult | null = null;
  const capabilityText = (input.capabilityText || '').trim();
  if (capabilityText) {
    try {
      seeded = await seedClientProfile(supabase, workspaceId, businessName, capabilityText, input.primaryEmail);
    } catch (e) {
      // Seeding is best-effort — a client must still be created even if extraction fails.
      console.error(`[coach-provision] seed failed for "${businessName}":`, (e as Error)?.message);
    }
  }
  const reallySeeded = !!seeded && (seeded.naics.length > 0 || seeded.keywords.length > 0);
  if (!reallySeeded) {
    await ensureClientProfileRow(supabase, workspaceId, businessName, input.primaryEmail);
  }

  return { ok: true, workspaceId, businessName, clientId: data.id, seeded, reallySeeded };
}
