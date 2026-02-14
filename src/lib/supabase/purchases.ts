import { createClient } from '@supabase/supabase-js';

// Use service role key for server-side operations (webhooks, etc.)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Create admin client with service role for bypassing RLS
function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Supabase credentials not configured');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

// Product IDs and their tiers
export type ProductId =
  | 'market-assassin'
  | 'content-generator'
  | 'contractor-database'
  | 'opportunity-hunter-pro'
  | 'recompete'
  | 'bundle-starter'
  | 'bundle-ultimate'
  | 'bundle-complete'
  | 'unknown';

export type ProductTier =
  | 'standard'
  | 'premium'
  | 'content-engine'
  | 'full-fix'
  | 'pro'
  | 'basic'
  // New tier names matching user_profiles access flags
  | 'hunter_pro'
  | 'content_standard'
  | 'content_full_fix'
  | 'assassin_standard'
  | 'assassin_premium'
  | 'recompete'
  | 'contractor_db'
  | 'bundle';

export interface Purchase {
  id: string;
  user_id?: string;
  user_email: string;
  stripe_session_id?: string;
  stripe_customer_id?: string;
  product_id: ProductId;
  product_name?: string;
  tier: ProductTier;
  bundle?: string;
  amount_paid?: number;
  currency?: string;
  status: 'completed' | 'refunded' | 'pending' | 'failed';
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePurchaseInput {
  email: string;
  stripe_session_id?: string;
  stripe_customer_id?: string;
  product_id: ProductId;
  product_name?: string;
  tier: ProductTier;
  bundle?: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new purchase record in Supabase
 */
export async function createPurchase(input: CreatePurchaseInput): Promise<Purchase | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('purchases')
    .insert({
      user_email: input.email.toLowerCase(),
      stripe_session_id: input.stripe_session_id,
      stripe_customer_id: input.stripe_customer_id,
      product_id: input.product_id,
      product_name: input.product_name,
      tier: input.tier,
      bundle: input.bundle,
      amount_paid: input.amount,
      currency: input.currency || 'usd',
      status: 'completed',
      metadata: input.metadata,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating purchase:', error);
    return null;
  }

  console.log(`Purchase created: ${input.product_id} (${input.tier}) for ${input.email}`);
  return data;
}

/**
 * Get all purchases for an email
 */
export async function getPurchasesByEmail(email: string): Promise<Purchase[]> {
  const supabase = getAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('purchases')
    .select('*')
    .eq('user_email', email.toLowerCase())
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching purchases:', error);
    return [];
  }

  return data || [];
}

/**
 * Check if user has access to a specific product
 */
export async function hasProductAccess(email: string, productId: ProductId): Promise<boolean> {
  const supabase = getAdminClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('purchases')
    .select('id')
    .eq('user_email', email.toLowerCase())
    .eq('product_id', productId)
    .eq('status', 'completed')
    .limit(1);

  if (error) {
    console.error('Error checking product access:', error);
    return false;
  }

  return (data?.length || 0) > 0;
}

/**
 * Get the tier for a specific product purchase
 */
export async function getProductTier(email: string, productId: ProductId): Promise<ProductTier | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('purchases')
    .select('tier')
    .eq('user_email', email.toLowerCase())
    .eq('product_id', productId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error getting product tier:', error);
    return null;
  }

  return data?.[0]?.tier || null;
}

/**
 * Upgrade a user's tier for a product
 */
export async function upgradeTier(
  email: string,
  productId: ProductId,
  newTier: ProductTier,
  stripeSessionId?: string
): Promise<boolean> {
  const supabase = getAdminClient();
  if (!supabase) return false;

  // First, check if they have an existing purchase
  const { data: existing } = await supabase
    .from('purchases')
    .select('id, tier')
    .eq('user_email', email.toLowerCase())
    .eq('product_id', productId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    // Update existing purchase with new tier
    const { error } = await supabase
      .from('purchases')
      .update({
        tier: newTier,
        metadata: {
          upgraded_at: new Date().toISOString(),
          upgrade_session_id: stripeSessionId,
          previous_tier: existing[0].tier
        }
      })
      .eq('id', existing[0].id);

    if (error) {
      console.error('Error upgrading tier:', error);
      return false;
    }

    console.log(`Upgraded ${email} from ${existing[0].tier} to ${newTier} for ${productId}`);
    return true;
  }

  // No existing purchase, create new one with the tier
  const result = await createPurchase({
    email,
    product_id: productId,
    tier: newTier,
    stripe_session_id: stripeSessionId,
  });

  return result !== null;
}

/**
 * Check if a Stripe session has already been processed (idempotency)
 */
export async function isSessionProcessed(sessionId: string): Promise<boolean> {
  const supabase = getAdminClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('purchases')
    .select('id')
    .eq('stripe_session_id', sessionId)
    .limit(1);

  if (error) {
    console.error('Error checking session:', error);
    return false;
  }

  return (data?.length || 0) > 0;
}

/**
 * Get all products a user has access to (for activation page)
 */
export async function getUserProducts(email: string): Promise<{
  productId: ProductId;
  productName: string;
  tier: ProductTier;
  accessUrl: string;
}[]> {
  const purchases = await getPurchasesByEmail(email);

  // Map of product IDs to their display info
  const productInfo: Partial<Record<ProductId, { name: string; url: string }>> = {
    'market-assassin': { name: 'Federal Market Assassin', url: '/federal-market-assassin' },
    'content-generator': { name: 'Content Reaper', url: '/content-generator' },
    'contractor-database': { name: 'Federal Contractor Database', url: '/contractor-database' },
    'opportunity-hunter-pro': { name: 'Opportunity Hunter Pro', url: '/opportunity-hunter' },
    'recompete': { name: 'Recompete Contracts Tracker', url: '/recompete' },
    'bundle-starter': { name: 'GovCon Starter Bundle', url: '/dashboard' },
    'bundle-ultimate': { name: 'GovCon Ultimate Bundle', url: '/dashboard' },
    'bundle-complete': { name: 'GovCon Complete Bundle', url: '/dashboard' },
  };

  // Get unique products (most recent tier for each)
  const productMap = new Map<ProductId, Purchase>();
  for (const purchase of purchases) {
    if (!productMap.has(purchase.product_id)) {
      productMap.set(purchase.product_id, purchase);
    }
  }

  return Array.from(productMap.values()).map(purchase => ({
    productId: purchase.product_id,
    productName: productInfo[purchase.product_id]?.name || purchase.product_name || purchase.product_id,
    tier: purchase.tier,
    accessUrl: productInfo[purchase.product_id]?.url || '/',
  }));
}
