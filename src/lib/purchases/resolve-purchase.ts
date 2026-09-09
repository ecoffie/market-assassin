/**
 * CANONICAL PURCHASE RESOLVER — read-only interpretation of the `purchases` ledger.
 *
 * ⚠️ THIS MODULE NEVER WRITES. It does not mutate historical rows, does not rewrite
 * `order_id` into `stripe_session_id`, and does not normalize cents into dollars in
 * place. It INTERPRETS what is already stored. The rows stay exactly as the two
 * webhooks wrote them; this is the lens that makes both shapes legible.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Two Stripe webhook handlers, in two repos, wrote the same table with different
 * column and unit conventions:
 *
 *   MINDY shape  → `stripe_session_id` set · `tier` set · `amount_paid` in DOLLARS
 *   SHOP  shape  → `order_id` holds the session id · `tier` NULL · `amount_paid` in CENTS
 *
 * Measured 2026-09-09 against production: 306 rows — 168 Mindy, 138 shop, 0 fitting
 * neither, 121 superseded. **Every single shop row has `tier IS NULL`** (138/138), and
 * `metadata`/`bundle` are empty on all of them. So a shop row cannot state its own plan;
 * it has to be interpreted from `product_id` + Stripe's product catalog.
 *
 * ── THE EVIDENCE HIERARCHY (strongest first) ─────────────────────────────────
 * Each resolution carries the evidence class that produced it, so a caller can see
 * WHY a row resolved the way it did rather than trusting a bare label.
 *
 *   E1  explicit_tier      the row states its own tier/bundle (Mindy shape)
 *   E2  catalog_product    `product_id` is a canonical catalog id (`opportunity-hunter-pro`)
 *   E3  stripe_metadata    `product_id` is a raw Stripe `prod_…` whose PRODUCT METADATA
 *                          carries `tier` or `bundle` — supplied by the caller, never guessed
 *   E4  stripe_price_product
 *                          `product_id` is a Stripe `price_…` (the handlers stored
 *                          `lineItems.data[0].price.id`, not the product id — measured on
 *                          real rows). Resolved via a caller-supplied price→product map,
 *                          then through that product's metadata. Same strength as E3: it
 *                          is the SAME Stripe metadata, reached through one more hop.
 *   --  UNRESOLVED         everything else
 *
 * ⚠️ AMOUNT IS DELIBERATELY *NOT* AN EVIDENCE CLASS. It fails the uniqueness test that
 * would make it admissible. Measured collisions in the live ledger:
 *   100000c → Ultimate GovCon Bundle · Starter Plan Installment · Ultimate Giant Bundle
 *             (DISCOUNT) · SWC Event Sponsorship
 *    49700c → Federal Contractor Database · Market Intelligence
 *     4900c → Opportunity Hunter Pro · Opportunity Scout Pro · Market Intelligence
 *    99700c → Pro Giant Bundle · Product Supplier Program
 *    14900c → Mindy Ai · Market Intelligence
 * Inferring a plan from a shared amount would produce a confident wrong entitlement,
 * which is strictly worse than an honest `unresolved`. Amount is carried through as
 * DISPLAY data (correctly scaled) and as a tie-break SIGNAL for humans — never as proof.
 *
 * ── THE LOAD-BEARING RULE ────────────────────────────────────────────────────
 * An unresolved row is `resolved: false` with `tier: null`. It is NEVER rendered as
 * free, and never as "no entitlement". Those are affirmative claims about a PAYING
 * customer that this data cannot support. Same failure class as `count ?? 0`: turning
 * "we do not know" into a specific, plausible, wrong answer. Callers must branch on
 * `resolved` and escalate — see `requiresHumanClassification`.
 */
import type { ProductTier } from '@/lib/supabase/user-profiles';

/** How a resolution was established. Absent when nothing was. */
export type PurchaseEvidence = 'explicit_tier' | 'catalog_product' | 'stripe_metadata' | 'stripe_price_product';

/** Which webhook wrote the row. Determines the unit and the id column. */
export type PurchaseShape = 'mindy' | 'shop' | 'unknown';

/** The subset of a `purchases` row this resolver reads. Nothing here is written back. */
export interface PurchaseRowInput {
  id?: string;
  user_email?: string | null;
  stripe_session_id?: string | null;
  order_id?: string | null;
  tier?: string | null;
  bundle?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  amount_paid?: number | string | null;
  status?: string | null;
  created_at?: string | null;
  superseded_by?: string | null;
}

/**
 * Stripe product metadata, keyed by `prod_…` id. Supplied by the CALLER (from
 * `stripe.products.list`), never hardcoded here — a catalog baked into source drifts
 * from the dashboard silently, and this file must not be the thing that goes stale.
 */
export interface StripeProductMeta {
  tier?: string | null;
  bundle?: string | null;
  name?: string | null;
}
export type StripeProductCatalog = Record<string, StripeProductMeta>;

/**
 * Stripe `price_…` id → the `prod_…` id it belongs to. Also caller-supplied.
 *
 * ⚠️ Needed because the webhooks are inconsistent about WHICH Stripe id they store in
 * `product_id`: `lineItems.data[0].price.id` (a `price_…`) in the Mindy handler versus a
 * resolved product id elsewhere. Measured: `price_1TTYe9K5zyiZ50PBmJlUQuXQ` belongs to
 * `prod_UI5RXVGKsdywuf` (tier `briefings`) — the same product other rows name directly.
 * Without this hop, two rows for the identical purchase resolve differently, which would
 * make the resolver's own answer depend on which handler happened to win a race.
 */
export type StripePriceIndex = Record<string, string>;

export interface ResolvedPurchase {
  /** True only when a tier or bundle was POSITIVELY established. */
  resolved: boolean;
  tier: ProductTier | null;
  bundle: string | null;
  evidence: PurchaseEvidence | null;
  shape: PurchaseShape;
  /** The Stripe checkout session id, wherever it happens to live on this row. */
  sessionId: string | null;
  /** Amount in DOLLARS, scaled per shape. Display/corroboration only — never proof. */
  amountDollars: number | null;
  /** The raw stored value, un-normalized, so the caller can see what is actually on disk. */
  rawAmount: number | null;
  /** Set when `resolved` is false: what specifically could not be established. */
  unresolvedReason?: string;
  /** True when only a human can close the gap. */
  requiresHumanClassification: boolean;
  /** Non-fatal observations worth surfacing (conflicts, outliers, superseded rows). */
  notes: string[];
}

/**
 * Canonical catalog product ids → tier. These are OUR ids (`src/lib/products.ts`),
 * not Stripe's, and they appear in `product_id` on older shop rows.
 *
 * Bundles resolve to a bundle name rather than a tier, because a bundle grants a SET of
 * flags through `updateAccessFlags`' bundle branch — collapsing one to a single tier
 * would silently drop the rest of the entitlement.
 */
const CATALOG_TIER: Record<string, ProductTier> = {
  'opportunity-hunter-pro': 'hunter_pro',
  'opportunity-scout-pro': 'hunter_pro',
  'contractor-database': 'contractor_db',
  'recompete-contracts': 'recompete',
  'market-assassin-standard': 'assassin_standard',
  'market-assassin-premium': 'assassin_premium',
  'ai-content-generator': 'content_standard',
  'content-full-fix': 'content_full_fix',
};

const CATALOG_BUNDLE: Record<string, string> = {
  'ultimate-govcon-bundle': 'ultimate',
  'pro-giant-bundle': 'pro_giant',
  'govcon-starter-bundle': 'starter',
};

/** Tier strings we accept from an external source (row or Stripe metadata). */
const KNOWN_TIERS = new Set<string>([
  'hunter_pro', 'content_standard', 'content_full_fix', 'assassin_standard',
  'assassin_premium', 'recompete', 'contractor_db', 'briefings', 'briefings_monthly',
  'briefings_annual', 'briefings_lifetime', 'fhc_membership', 'team_monthly',
  'team_annual', 'assassin_premium_upgrade', 'content_full_fix_upgrade',
]);

/**
 * Placeholder values that LOOK like a tier but assert nothing. `backfill_unknown` sits
 * on 154 rows and `unknown` on 1 — treating either as evidence would manufacture a
 * resolution out of an admission of ignorance.
 */
const NON_TIERS = new Set(['backfill_unknown', 'unknown', '', 'null', 'none']);

function asTier(v: unknown): ProductTier | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s || NON_TIERS.has(s)) return null;
  return KNOWN_TIERS.has(s) ? (s as ProductTier) : null;
}

/**
 * Which webhook wrote this row.
 *
 * `stripe_session_id` present ⇒ Mindy, because the shop handler never populated that
 * column. A row with neither id is `unknown` — reported, never coerced into a shape,
 * since the unit of `amount_paid` would then be a guess. (0 such rows today; this
 * branch exists so a future one is visible rather than silently mis-scaled.)
 */
export function purchaseShape(row: PurchaseRowInput): PurchaseShape {
  if (row.stripe_session_id) return 'mindy';
  if (row.order_id) return 'shop';
  return 'unknown';
}

/**
 * The Stripe checkout session id, from whichever column holds it.
 *
 * This mirrors the live DB guard `uniq_purchases_session_any`, which is
 * `UNIQUE(COALESCE(NULLIF(stripe_session_id,''), NULLIF(order_id,'')))` — so reading
 * and constraint agree by construction rather than by coincidence.
 *
 * ⚠️ Not every value here is a `cs_…`. One row carries a CHARGE id (`ch_…`) in
 * `order_id`, so callers matching against Stripe sessions must check the prefix.
 */
export function purchaseSessionId(row: PurchaseRowInput): string | null {
  const s = String(row.stripe_session_id ?? '').trim();
  if (s) return s;
  const o = String(row.order_id ?? '').trim();
  return o || null;
}

/**
 * Amount in DOLLARS — computed for display, never written back.
 * Mindy stores dollars; shop stores cents. `unknown` shape returns null rather than
 * picking a scale, because a 100× error in a money figure is not a rounding issue.
 */
export function purchaseAmountDollars(row: PurchaseRowInput): number | null {
  const raw = row.amount_paid;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  switch (purchaseShape(row)) {
    case 'mindy': return n;
    case 'shop': return n / 100;
    default: return null;
  }
}

/**
 * Resolve one purchase row to an entitlement.
 *
 * `stripeCatalog` is optional. Without it, raw `prod_…` rows stay UNRESOLVED rather
 * than being guessed — which is the correct degradation: the resolver's answer gets
 * less complete, never less true.
 */
export function resolvePurchase(
  row: PurchaseRowInput,
  stripeCatalog: StripeProductCatalog = {},
  stripePriceIndex: StripePriceIndex = {},
): ResolvedPurchase {
  const shape = purchaseShape(row);
  const notes: string[] = [];
  const base = {
    shape,
    sessionId: purchaseSessionId(row),
    amountDollars: purchaseAmountDollars(row),
    rawAmount: row.amount_paid === null || row.amount_paid === undefined
      ? null
      : (Number.isFinite(Number(row.amount_paid)) ? Number(row.amount_paid) : null),
    notes,
  };

  if (row.superseded_by) {
    notes.push('superseded — this row was marked a duplicate; it is not the canonical record for its session');
  }
  if (shape === 'unknown') {
    notes.push('no session identifier in either stripe_session_id or order_id — amount unit cannot be determined');
  }
  const sid = base.sessionId;
  if (sid && !sid.startsWith('cs_')) {
    notes.push(`identifier is not a checkout session (${sid.slice(0, 3)}…) — will not match Stripe session lookups`);
  }

  // ── E1: the row states its own tier/bundle. Only Mindy rows ever do. ──
  const ownTier = asTier(row.tier);
  const ownBundle = String(row.bundle ?? '').trim() || null;
  if (ownTier || ownBundle) {
    return { ...base, resolved: true, tier: ownTier, bundle: ownBundle,
      evidence: 'explicit_tier', requiresHumanClassification: false };
  }
  // A tier string we don't recognise is a signal, not a resolution.
  if (row.tier && !ownTier && !NON_TIERS.has(String(row.tier).trim().toLowerCase())) {
    notes.push(`row carries tier="${row.tier}" which is not a known ProductTier — ignored as evidence`);
  }

  const pid = String(row.product_id ?? '').trim();

  // ── E2: our own catalog id. Stable across repricing; the name may vary cosmetically. ──
  if (pid && CATALOG_TIER[pid]) {
    return { ...base, resolved: true, tier: CATALOG_TIER[pid], bundle: null,
      evidence: 'catalog_product', requiresHumanClassification: false };
  }
  if (pid && CATALOG_BUNDLE[pid]) {
    return { ...base, resolved: true, tier: null, bundle: CATALOG_BUNDLE[pid],
      evidence: 'catalog_product', requiresHumanClassification: false };
  }

  // ── E3: Stripe product metadata, supplied by the caller. ──
  // This is what makes the large `prod_…` block legible: Stripe's own dashboard
  // carries `metadata.tier` / `metadata.bundle` on these products.
  const meta = pid ? stripeCatalog[pid] : undefined;
  if (meta) {
    const metaTier = asTier(meta.tier);
    const metaBundle = String(meta.bundle ?? '').trim() || null;
    if (metaTier || metaBundle) {
      // The product NAME can disagree with the row's stored name (one Stripe product
      // served two display names over time). Surface it; the metadata still governs.
      if (meta.name && row.product_name && meta.name !== row.product_name) {
        notes.push(`row product_name "${row.product_name}" differs from Stripe's "${meta.name}" — same product id, renamed or reused`);
      }
      return { ...base, resolved: true, tier: metaTier, bundle: metaBundle,
        evidence: 'stripe_metadata', requiresHumanClassification: false };
    }
    // Known to Stripe, but Stripe has no tier for it either.
    return { ...base, resolved: false, tier: null, bundle: null, evidence: null,
      unresolvedReason: `Stripe product ${pid} ("${meta.name ?? row.product_name ?? 'unnamed'}") carries no tier or bundle metadata`,
      requiresHumanClassification: true };
  }

  // ── E4: the row stored a Stripe PRICE id. Hop price → product → metadata. ──
  if (pid && stripePriceIndex[pid]) {
    const viaProd = stripePriceIndex[pid];
    const pMeta = stripeCatalog[viaProd];
    if (pMeta) {
      const pTier = asTier(pMeta.tier);
      const pBundle = String(pMeta.bundle ?? '').trim() || null;
      if (pTier || pBundle) {
        notes.push(`product_id is a Stripe price id; resolved via product ${viaProd} ("${pMeta.name ?? '?'}")`);
        return { ...base, resolved: true, tier: pTier, bundle: pBundle,
          evidence: 'stripe_price_product', requiresHumanClassification: false };
      }
      return { ...base, resolved: false, tier: null, bundle: null, evidence: null,
        unresolvedReason: `price ${pid} → product ${viaProd} ("${pMeta.name ?? 'unnamed'}") carries no tier or bundle metadata`,
        requiresHumanClassification: true };
    }
  }

  // ── UNRESOLVED. Never free, never "no entitlement". ──
  return {
    ...base, resolved: false, tier: null, bundle: null, evidence: null,
    unresolvedReason: pid
      ? `product_id "${pid}" is neither a catalog id nor present in the supplied Stripe catalog`
      : 'row carries no product_id and no explicit tier',
    requiresHumanClassification: true,
  };
}

/**
 * Fold a customer's rows into their strongest entitlement claim.
 *
 * Superseded rows are excluded (they are duplicates by definition). UNRESOLVED rows are
 * counted and returned rather than dropped: a customer with one unresolved purchase has
 * an OPEN QUESTION, and silently returning "no entitlement" for them is exactly the
 * fabrication this module exists to prevent.
 */
export function resolveCustomerPurchases(
  rows: PurchaseRowInput[],
  stripeCatalog: StripeProductCatalog = {},
  stripePriceIndex: StripePriceIndex = {},
): {
  resolved: ResolvedPurchase[];
  unresolved: ResolvedPurchase[];
  tiers: ProductTier[];
  bundles: string[];
  hasUnresolved: boolean;
} {
  const live = rows.filter((r) => !r.superseded_by);
  const all = live.map((r) => resolvePurchase(r, stripeCatalog, stripePriceIndex));
  const resolved = all.filter((r) => r.resolved);
  const unresolved = all.filter((r) => !r.resolved);
  return {
    resolved,
    unresolved,
    tiers: [...new Set(resolved.map((r) => r.tier).filter((t): t is ProductTier => Boolean(t)))],
    bundles: [...new Set(resolved.map((r) => r.bundle).filter((b): b is string => Boolean(b)))],
    hasUnresolved: unresolved.length > 0,
  };
}
