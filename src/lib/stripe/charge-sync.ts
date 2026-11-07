/**
 * Stripe → stripe_charges, incrementally, from the daily sync-stripe-cache job.
 *
 * WHY: the fast sync skipped charges and the endpoint that used to write them is disabled, so
 * the mirror froze at 2026-06-11 while mrr-goal, list-purchases and classify-customers-v2 kept
 * reading it (528 live charges behind on 2026-11-07).
 *
 * NO GAPS: the watermark is simply max(created_at) in the table, so it can only move as far as
 * rows actually landed. The whole window is listed first (Stripe returns newest-first), then
 * written OLDEST-first in chunks, stopping at the first failure or at the deadline. Writing
 * newest-first would jump the watermark past whatever had not landed yet, permanently.
 *
 * The window re-reads CHARGE_OVERLAP_DAYS behind the watermark to pick up refunds on recent
 * charges. A refund older than that is not seen by this path. Upserts on id are idempotent, and
 * a row already enriched keeps its product metadata without another invoice call.
 *
 * Never throws: the failure is RETURNED so the job can report it.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { customerMirrorRow } from './subscription-mirror';

export const CHARGE_OVERLAP_DAYS = 30;
const PAGE_SIZE = 100;
const WRITE_CHUNK = 100;
const ENRICH_CONCURRENCY = 5;

export interface ChargeSyncResult {
  ok: boolean;
  /** True when every charge in the window landed. False = a later run continues from the watermark. */
  complete: boolean;
  reason?: 'time_budget' | 'no_watermark' | 'failed';
  error?: string;
  watermarkBefore: string | null;
  windowFrom: string | null;
  listed: number;
  upserted: number;
  remaining: number;
  invoiceLookups: number;
}

/** Copies a charge's product from its invoice when the charge metadata does not carry one. */
export async function enrichChargeMetadata(charge: Stripe.Charge): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = { ...(charge.metadata || {}) };
  if (metadata.product_name || metadata.product_id) return metadata;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chargeAny = charge as any;
  const invoiceId = typeof chargeAny.invoice === 'string' ? chargeAny.invoice : chargeAny.invoice?.id;
  if (!invoiceId) return metadata;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice: any = await getStripe().invoices.retrieve(invoiceId, {
      expand: ['lines.data.price.product'],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = invoice.lines?.data?.find((item: any) => item.price?.product) || invoice.lines?.data?.[0];
    const product = line?.price?.product;

    if (product) {
      metadata.product_id = typeof product === 'string' ? product : product.id;
      metadata.product_name = typeof product === 'string' ? line?.description : product.name;
    } else if (line?.description || invoice.description || charge.description) {
      metadata.product_name = line?.description || invoice.description || charge.description;
    }

    if (line?.price?.id) metadata.price_id = line.price.id;
    if (invoice.subscription) {
      metadata.subscription_id = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription.id;
    }
  } catch (error) {
    console.warn(`Unable to enrich charge ${charge.id} from invoice ${invoiceId}:`, error);
  }

  return metadata;
}

/** A `stripe_charges` row. */
export function chargeMirrorRow(charge: Stripe.Charge, metadata: Record<string, unknown>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chargeAny = charge as any;
  return {
    id: charge.id,
    customer_id: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id,
    amount: charge.amount,
    currency: charge.currency,
    status: charge.status,
    description: charge.description,
    receipt_email: charge.receipt_email,
    invoice_id: typeof chargeAny.invoice === 'string' ? chargeAny.invoice : chargeAny.invoice?.id,
    payment_intent_id: typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id,
    metadata,
    created_at: new Date(charge.created * 1000).toISOString(),
    livemode: charge.livemode,
    refunded: charge.refunded,
    amount_refunded: charge.amount_refunded,
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export async function syncChargesIncremental(opts: {
  /** Epoch ms after which no further Stripe page or write chunk is started. */
  deadlineMs: number;
  nowMs?: () => number;
}): Promise<ChargeSyncResult> {
  const nowMs = opts.nowMs ?? Date.now;
  const r: ChargeSyncResult = {
    ok: false, complete: false, watermarkBefore: null, windowFrom: null,
    listed: 0, upserted: 0, remaining: 0, invoiceLookups: 0,
  };
  const fail = (error: string): ChargeSyncResult => ({ ...r, ok: false, complete: false, reason: 'failed', error });

  try {
    const db = getWriteClient();
    const { data: top, error: topErr } = await db
      .from('stripe_charges')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    if (topErr) return fail(`watermark read failed: ${topErr.message}`);

    const watermark = (top?.[0]?.created_at as string | undefined) ?? null;
    r.watermarkBefore = watermark;
    // An empty mirror is unknown history, not "start now". Seeding it is the full backfill's job.
    if (!watermark) return { ...r, reason: 'no_watermark', error: 'stripe_charges is empty; run the full charges backfill first' };

    const since = Math.floor(Date.parse(watermark) / 1000) - CHARGE_OVERLAP_DAYS * 86_400;
    r.windowFrom = new Date(since * 1000).toISOString();

    const charges: Stripe.Charge[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      if (nowMs() >= opts.deadlineMs) return { ...r, ok: true, reason: 'time_budget' };
      const params: Stripe.ChargeListParams = {
        limit: PAGE_SIZE,
        created: { gte: since },
        expand: ['data.customer'],
      };
      if (startingAfter) params.starting_after = startingAfter;
      const page = await getStripe().charges.list(params);
      for (const c of page.data) if (c.livemode !== false) charges.push(c);
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
    r.listed = charges.length;
    charges.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));

    for (let i = 0; i < charges.length; i += WRITE_CHUNK) {
      r.remaining = charges.length - i;
      if (nowMs() >= opts.deadlineMs) return { ...r, ok: true, reason: 'time_budget' };
      const chunk = charges.slice(i, i + WRITE_CHUNK);

      const { data: existing, error: existErr } = await db
        .from('stripe_charges')
        .select('id, metadata')
        .in('id', chunk.map((c) => c.id));
      if (existErr) return fail(`existing charge read failed: ${existErr.message}`);
      const known = new Map((existing || []).map((e: { id: string; metadata: Record<string, unknown> | null }) => [e.id, e.metadata]));

      const rows = await mapPool(chunk, ENRICH_CONCURRENCY, async (charge) => {
        const prior = known.get(charge.id);
        if (prior?.product_name || prior?.product_id) {
          return chargeMirrorRow(charge, { ...prior, ...(charge.metadata || {}) });
        }
        r.invoiceLookups++;
        return chargeMirrorRow(charge, await enrichChargeMetadata(charge));
      });

      // The FK. A full customer refreshes its row; a bare id or deleted customer only fills the
      // key and never overwrites an existing email. One row per id: Postgres refuses an upsert
      // that touches the same row twice.
      const full = new Map<string, Record<string, unknown>>();
      const bare = new Map<string, Record<string, unknown>>();
      for (const c of chunk) {
        if (!c.customer) continue;
        const row = customerMirrorRow(c.customer);
        const isFull = typeof c.customer === 'object' && !('deleted' in c.customer && c.customer.deleted);
        (isFull ? full : bare).set(row.id as string, row);
      }
      for (const id of full.keys()) bare.delete(id);
      if (full.size) {
        const { error } = await db.from('stripe_customers').upsert([...full.values()], { onConflict: 'id' });
        if (error) return fail(`customer mirror failed: ${error.message}`);
      }
      if (bare.size) {
        const { error } = await db.from('stripe_customers').upsert([...bare.values()], { onConflict: 'id', ignoreDuplicates: true });
        if (error) return fail(`customer mirror failed: ${error.message}`);
      }

      const { error: chargeErr } = await db.from('stripe_charges').upsert(rows, { onConflict: 'id' });
      if (chargeErr) return fail(`charge upsert failed: ${chargeErr.message}`);
      r.upserted += rows.length;
    }

    return { ...r, ok: true, complete: true, remaining: 0 };
  } catch (e) {
    return fail((e as Error).message || 'charge sync failed');
  }
}
