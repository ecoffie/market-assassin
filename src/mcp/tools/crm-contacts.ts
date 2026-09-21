/**
 * MCP tool: add_contacts_to_crm — one-shot push of contacts into the USER'S OWN
 * GoHighLevel CRM. Pairs with Mindy's contact-discovery tools (search_federal_contacts,
 * get_sblo_contact, find_capable_contractors, lookup_federal_osbp): find your teaming
 * targets / buying-office POCs, then add them to your CRM in a single follow-up call.
 *
 * Identity comes from the VERIFIED MCP caller (ctx.userEmail) — NEVER from an
 * agent-supplied field — and resolves that user's stored GHL connection. No
 * connection → honest miss (grounded:false, connected:false) that tells the agent to
 * connect GHL first; it does NOT fabricate a write.
 *
 * Pattern: pure fn, `_meta` ALWAYS ships, `_ai_hint` OFF by default, honest-miss no
 * fabrication. Billing handled by the transport (runMeteredTool).
 */
import { getCrmConnection } from '@/lib/crm/connections';
import { upsertContactsBatch, type CrmContactInput, type CrmUpsertRow } from '@/lib/ghl/contacts';
import { mcpFlags } from '@/lib/mcp/flags';

const MAX_CONTACTS = 200;

export interface AddContactsInput {
  /** The verified MCP caller (ctx.userEmail). Required — the tool writes to THIS user's CRM. */
  userEmail: string;
  contacts: CrmContactInput[];
  /** Optional tags applied to every contact (e.g. a campaign or source label). */
  tags?: string[];
}

export interface AddContactsResult {
  connected: boolean;
  provider: string | null;
  added: number;
  updated: number;
  failed: number;
  capped: boolean;
  rows: CrmUpsertRow[];
  message?: string;
  _meta: { grounded: boolean; degraded: boolean; connected: boolean; count: number };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string };
}

export async function addContactsToCrm(input: AddContactsInput): Promise<AddContactsResult> {
  const email = (input.userEmail || '').trim();
  const conn = email ? await getCrmConnection(email) : null;

  // No connection → honest miss (never fabricate a write).
  if (!conn) {
    const result: AddContactsResult = {
      connected: false,
      provider: null,
      added: 0,
      updated: 0,
      failed: 0,
      capped: false,
      rows: [],
      message: 'No CRM is connected for this account. Connect your GoHighLevel (Private Integration Token + Location ID) in Mindy → MCP account settings, then retry.',
      _meta: { grounded: false, degraded: false, connected: false, count: 0 },
    };
    if (mcpFlags.aiHint) {
      result._ai_hint = {
        summary: 'No CRM connected — nothing was written.',
        how_to_use: 'Tell the user to connect GoHighLevel in Mindy MCP account settings, then retry. Do NOT claim any contact was added.',
        key_caveats: 'No write occurred. Do not invent contact IDs or success.',
      };
    }
    return result;
  }

  const all = Array.isArray(input.contacts) ? input.contacts : [];
  const contacts = all.slice(0, MAX_CONTACTS);
  const capped = all.length > MAX_CONTACTS;

  const res = await upsertContactsBatch(conn.token, conn.locationId, contacts, input.tags || []);
  const grounded = res.created + res.updated > 0;

  const result: AddContactsResult = {
    connected: true,
    provider: conn.provider,
    added: res.created,
    updated: res.updated,
    failed: res.failed,
    capped,
    rows: res.rows,
    _meta: { grounded, degraded: res.degraded, connected: true, count: contacts.length },
  };
  if (capped) result.message = `Only the first ${MAX_CONTACTS} contacts were processed (${all.length} supplied). Call again with the rest.`;

  if (mcpFlags.aiHint) {
    result._ai_hint = buildHint(result);
  }
  return result;
}

function buildHint(r: AddContactsResult): NonNullable<AddContactsResult['_ai_hint']> {
  if (r._meta.degraded && !r._meta.grounded) {
    return {
      summary: 'The CRM push errored — no contacts were confirmed added.',
      how_to_use: 'Report the failure and the per-row errors; suggest checking the GHL token scope (contacts.write). Do not claim success.',
      key_caveats: 'Degraded: GHL returned an error. Do not invent added contacts.',
    };
  }
  if (!r._meta.grounded) {
    return {
      summary: 'No contacts were added (all rows failed validation or upsert).',
      how_to_use: 'Show the per-row errors (missing email/phone, etc.). Do not claim any contact landed in the CRM.',
      key_caveats: 'Genuine zero-write. Do not fabricate contact IDs.',
    };
  }
  return {
    summary: `${r.added} added and ${r.updated} updated in the connected ${r.provider?.toUpperCase()} CRM${r.failed ? ` (${r.failed} failed)` : ''}.`,
    how_to_use: 'Confirm what landed; each row carries its contact_id. Surface any failed rows with their error.',
    key_caveats: 'Only cite contacts whose row status is created/updated. Failed rows did NOT land.',
  };
}
