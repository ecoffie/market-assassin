import { createClient } from '@supabase/supabase-js';

// Use service role key for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Supabase credentials not configured');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

// Product access flag types (matching your database columns)
export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  stripe_customer_id?: string;

  // Access flags (your naming convention)
  access_hunter_pro: boolean;
  access_content_standard: boolean;
  access_content_full_fix: boolean;
  access_assassin_standard: boolean;
  access_assassin_premium: boolean;
  access_recompete: boolean;
  access_contractor_db: boolean;

  // License
  license_key?: string;
  license_activated_at?: string;
  bundle?: string;

  created_at: string;
  updated_at: string;
}

export type ProductAccessFlag =
  | 'access_hunter_pro'
  | 'access_content_standard'
  | 'access_content_full_fix'
  | 'access_assassin_standard'
  | 'access_assassin_premium'
  | 'access_recompete'
  | 'access_contractor_db';

// Tier types matching your purchases table
export type ProductTier =
  | 'hunter_pro'
  | 'content_standard'
  | 'content_full_fix'
  | 'assassin_standard'
  | 'assassin_premium'
  | 'recompete'
  | 'contractor_db'
  // Upgrade tiers
  | 'assassin_premium_upgrade'
  | 'content_full_fix_upgrade';

/**
 * Generate a license key in format XXXX-XXXX-XXXX-XXXX
 */
export function generateLicenseKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments: string[] = [];

  for (let i = 0; i < 4; i++) {
    let segment = '';
    for (let j = 0; j < 4; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(segment);
  }

  return segments.join('-');
}

/**
 * Get or create a user profile by email
 */
export async function getOrCreateProfile(email: string, name?: string): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const normalizedEmail = email.toLowerCase().trim();

  // Try to get existing profile
  const { data: existing, error: fetchError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', normalizedEmail)
    .single();

  if (existing && !fetchError) {
    return existing as UserProfile;
  }

  // Create new profile with license key
  const licenseKey = generateLicenseKey();

  const { data: newProfile, error: insertError } = await supabase
    .from('user_profiles')
    .insert({
      email: normalizedEmail,
      name: name || null,
      license_key: licenseKey,
      access_hunter_pro: false,
      access_content_standard: false,
      access_content_full_fix: false,
      access_assassin_standard: false,
      access_assassin_premium: false,
      access_recompete: false,
      access_contractor_db: false,
    })
    .select()
    .single();

  if (insertError) {
    console.error('Error creating user profile:', insertError);
    return null;
  }

  console.log(`Created new user profile for ${normalizedEmail} with license key ${licenseKey}`);
  return newProfile as UserProfile;
}

/**
 * Get user profile by email
 */
export async function getProfileByEmail(email: string): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error) {
    if (error.code !== 'PGRST116') { // Not found is ok
      console.error('Error fetching profile:', error);
    }
    return null;
  }

  return data as UserProfile;
}

/**
 * Get user profile by license key
 */
export async function getProfileByLicenseKey(licenseKey: string): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('license_key', licenseKey.toUpperCase().trim())
    .single();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Error fetching profile by license:', error);
    }
    return null;
  }

  return data as UserProfile;
}

/**
 * Map tier to access flag
 */
export function tierToAccessFlag(tier: ProductTier): ProductAccessFlag {
  const mapping: Record<ProductTier, ProductAccessFlag> = {
    'hunter_pro': 'access_hunter_pro',
    'content_standard': 'access_content_standard',
    'content_full_fix': 'access_content_full_fix',
    'assassin_standard': 'access_assassin_standard',
    'assassin_premium': 'access_assassin_premium',
    'recompete': 'access_recompete',
    'contractor_db': 'access_contractor_db',
    // Upgrade tiers map to their premium access flags
    'assassin_premium_upgrade': 'access_assassin_premium',
    'content_full_fix_upgrade': 'access_content_full_fix',
  };
  return mapping[tier];
}

/**
 * Grant access to a product for a user
 */
export async function grantProductAccess(
  email: string,
  tier: ProductTier,
  options?: {
    name?: string;
    stripeCustomerId?: string;
    bundle?: string;
  }
): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const normalizedEmail = email.toLowerCase().trim();

  // Get or create profile first
  let profile = await getOrCreateProfile(normalizedEmail, options?.name);
  if (!profile) return null;

  // Get the access flag for this tier
  const accessFlag = tierToAccessFlag(tier);

  // Build update object
  const updates: Record<string, unknown> = {
    [accessFlag]: true,
  };

  // If granting content_full_fix, also grant content_standard
  if (tier === 'content_full_fix') {
    updates.access_content_standard = true;
  }

  // If granting assassin_premium, also grant assassin_standard
  if (tier === 'assassin_premium') {
    updates.access_assassin_standard = true;
  }

  // Add optional fields
  if (options?.stripeCustomerId) {
    updates.stripe_customer_id = options.stripeCustomerId;
  }
  if (options?.bundle) {
    updates.bundle = options.bundle;
  }
  if (options?.name && !profile.name) {
    updates.name = options.name;
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('email', normalizedEmail)
    .select()
    .single();

  if (error) {
    console.error('Error granting product access:', error);
    return null;
  }

  console.log(`Granted ${accessFlag} to ${normalizedEmail}`);
  return data as UserProfile;
}

/**
 * Update access flags based on tier and/or bundle
 * Simplified function matching the Express pattern
 */
export async function updateAccessFlags(
  email: string,
  tier?: string,
  bundle?: string
): Promise<Record<string, boolean>> {
  const supabase = getAdminClient();
  if (!supabase) return {};

  const normalizedEmail = email.toLowerCase().trim();
  const updates: Record<string, boolean> = {};

  // Bundle access grants (supports both short names and full product IDs)
  if (bundle) {
    // GovCon Starter Bundle ($697): Hunter Pro + Recompete + Contractor DB
    if (bundle === 'starter' || bundle === 'govcon-starter-bundle') {
      updates.access_hunter_pro = true;
      updates.access_recompete = true;
      updates.access_contractor_db = true;
    }
    // Pro Giant Bundle ($997): Contractor DB + Recompete + MA Standard + Content Generator
    else if (bundle === 'pro' || bundle === 'pro-giant-bundle') {
      updates.access_contractor_db = true;
      updates.access_recompete = true;
      updates.access_assassin_standard = true;
      updates.access_content_standard = true;
    }
    // Ultimate GovCon Bundle ($1497): All products + MA Premium + Content Full Fix
    else if (bundle === 'ultimate' || bundle === 'ultimate-govcon-bundle' || bundle === 'complete') {
      updates.access_hunter_pro = true;
      updates.access_content_standard = true;
      updates.access_content_full_fix = true;
      updates.access_contractor_db = true;
      updates.access_recompete = true;
      updates.access_assassin_standard = true;
      updates.access_assassin_premium = true;
    }
  } else if (tier) {
    // Single tier access grants (only if no bundle)
    if (tier === 'hunter_pro') updates.access_hunter_pro = true;
    if (tier === 'content_standard') updates.access_content_standard = true;
    if (tier === 'content_full_fix') updates.access_content_full_fix = true;
    if (tier === 'assassin_standard') updates.access_assassin_standard = true;
    if (tier === 'assassin_premium') updates.access_assassin_premium = true;
    if (tier === 'recompete') updates.access_recompete = true;
    if (tier === 'contractor_db') updates.access_contractor_db = true;

    // Upgrade tiers - grant the higher tier (user already has standard)
    if (tier === 'assassin_premium_upgrade') {
      updates.access_assassin_premium = true;
      updates.access_assassin_standard = true; // Ensure standard is also set
    }
    if (tier === 'content_full_fix_upgrade') {
      updates.access_content_full_fix = true;
      updates.access_content_standard = true; // Ensure standard is also set
    }
  }

  if (Object.keys(updates).length === 0) return {};

  // Ensure profile exists
  await getOrCreateProfile(normalizedEmail);

  // Update access flags
  const { error } = await supabase
    .from('user_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('email', normalizedEmail);

  if (error) {
    console.error('Error updating access flags:', error);
    return {};
  }

  console.log(`Updated access flags for ${normalizedEmail}:`, Object.keys(updates));
  return updates;
}

/**
 * Grant bundle access (multiple products at once)
 */
export async function grantBundleAccess(
  email: string,
  bundle: 'starter' | 'govcon-starter-bundle' | 'pro' | 'pro-giant-bundle' | 'ultimate' | 'ultimate-govcon-bundle' | 'complete',
  options?: {
    name?: string;
    stripeCustomerId?: string;
  }
): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const normalizedEmail = email.toLowerCase().trim();

  // Get or create profile first
  const profile = await getOrCreateProfile(normalizedEmail, options?.name);
  if (!profile) return null;

  // Define what each bundle includes
  const bundleProducts: Record<string, Record<string, unknown>> = {
    // GovCon Starter Bundle ($697)
    'starter': {
      access_hunter_pro: true,
      access_recompete: true,
      access_contractor_db: true,
    },
    'govcon-starter-bundle': {
      access_hunter_pro: true,
      access_recompete: true,
      access_contractor_db: true,
    },
    // Pro Giant Bundle ($997)
    'pro': {
      access_contractor_db: true,
      access_recompete: true,
      access_assassin_standard: true,
      access_content_standard: true,
    },
    'pro-giant-bundle': {
      access_contractor_db: true,
      access_recompete: true,
      access_assassin_standard: true,
      access_content_standard: true,
    },
    // Ultimate GovCon Bundle ($1497)
    'ultimate': {
      access_hunter_pro: true,
      access_assassin_standard: true,
      access_assassin_premium: true,
      access_content_standard: true,
      access_content_full_fix: true,
      access_contractor_db: true,
      access_recompete: true,
    },
    'ultimate-govcon-bundle': {
      access_hunter_pro: true,
      access_assassin_standard: true,
      access_assassin_premium: true,
      access_content_standard: true,
      access_content_full_fix: true,
      access_contractor_db: true,
      access_recompete: true,
    },
    'complete': {
      access_hunter_pro: true,
      access_assassin_standard: true,
      access_assassin_premium: true,
      access_content_standard: true,
      access_content_full_fix: true,
      access_contractor_db: true,
      access_recompete: true,
    },
  };

  const updates = {
    ...bundleProducts[bundle],
    bundle,
    stripe_customer_id: options?.stripeCustomerId || profile.stripe_customer_id,
    name: options?.name || profile.name,
  };

  const { data, error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('email', normalizedEmail)
    .select()
    .single();

  if (error) {
    console.error('Error granting bundle access:', error);
    return null;
  }

  console.log(`Granted ${bundle} bundle to ${normalizedEmail}`);
  return data as UserProfile;
}

/**
 * Check if user has access to a specific product
 */
export async function hasAccess(email: string, accessFlag: ProductAccessFlag): Promise<boolean> {
  const profile = await getProfileByEmail(email);
  if (!profile) return false;
  return profile[accessFlag] === true;
}

/**
 * Activate a license and mark activation time
 */
export async function activateLicense(email: string): Promise<UserProfile | null> {
  const supabase = getAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('user_profiles')
    .update({
      license_activated_at: new Date().toISOString(),
    })
    .eq('email', email.toLowerCase().trim())
    .select()
    .single();

  if (error) {
    console.error('Error activating license:', error);
    return null;
  }

  return data as UserProfile;
}

/**
 * Get all user profiles (for admin)
 */
export async function getAllProfiles(options?: {
  limit?: number;
  offset?: number;
}): Promise<UserProfile[]> {
  const supabase = getAdminClient();
  if (!supabase) return [];

  let query = supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching profiles:', error);
    return [];
  }

  return (data || []) as UserProfile[];
}

/**
 * Map product_id from purchases to tier
 */
export function productIdToTier(productId: string, tier?: string): ProductTier | null {
  // Handle direct tier mapping
  if (tier) {
    const validTiers: ProductTier[] = [
      'hunter_pro', 'content_standard', 'content_full_fix',
      'assassin_standard', 'assassin_premium', 'recompete', 'contractor_db'
    ];
    if (validTiers.includes(tier as ProductTier)) {
      return tier as ProductTier;
    }
  }

  // Fallback mapping from product_id
  const mapping: Record<string, ProductTier> = {
    'market-assassin': 'assassin_standard',
    'content-generator': 'content_standard',
    'contractor-database': 'contractor_db',
    'opportunity-hunter-pro': 'hunter_pro',
    'recompete': 'recompete',
  };

  return mapping[productId] || null;
}
