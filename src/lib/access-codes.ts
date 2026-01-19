import { kv } from '@vercel/kv';

export interface AccessCode {
  code: string;
  email: string;
  companyName?: string;
  createdAt: string;
  usedAt?: string;
  used: boolean;
}

// Generate a random access code
export function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create a new access code for a customer
export async function createAccessCode(email: string, companyName?: string): Promise<AccessCode> {
  const code = generateAccessCode();
  const accessCode: AccessCode = {
    code,
    email,
    companyName,
    createdAt: new Date().toISOString(),
    used: false,
  };

  // Store in KV with code as key
  await kv.set(`access:${code}`, accessCode);

  // Also add to list of all codes for admin
  await kv.lpush('access:all', code);

  console.log(`✅ Access code created and stored: ${code}`);
  return accessCode;
}

// Validate an access code
export async function validateAccessCode(code: string): Promise<{ valid: boolean; accessCode?: AccessCode; error?: string }> {
  const accessCode = await kv.get<AccessCode>(`access:${code.toUpperCase()}`);

  if (!accessCode) {
    return { valid: false, error: 'Invalid access code' };
  }

  if (accessCode.used) {
    return { valid: false, error: 'This access code has already been used', accessCode };
  }

  return { valid: true, accessCode };
}

// Mark an access code as used
export async function markCodeAsUsed(code: string): Promise<boolean> {
  const accessCode = await kv.get<AccessCode>(`access:${code.toUpperCase()}`);

  if (!accessCode) {
    return false;
  }

  accessCode.used = true;
  accessCode.usedAt = new Date().toISOString();

  await kv.set(`access:${code.toUpperCase()}`, accessCode);
  console.log(`✅ Access code marked as used: ${code}`);
  return true;
}

// Get all access codes (for admin)
export async function getAllAccessCodes(): Promise<AccessCode[]> {
  const allCodes = await kv.lrange('access:all', 0, -1) as string[];

  if (!allCodes || allCodes.length === 0) {
    return [];
  }

  const accessCodes: AccessCode[] = [];
  for (const code of allCodes) {
    const accessCode = await kv.get<AccessCode>(`access:${code}`);
    if (accessCode) {
      accessCodes.push(accessCode);
    }
  }

  return accessCodes.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Delete an access code (for admin)
export async function deleteAccessCode(code: string): Promise<boolean> {
  const deleted = await kv.del(`access:${code.toUpperCase()}`);
  if (deleted) {
    await kv.lrem('access:all', 1, code.toUpperCase());
  }
  return deleted > 0;
}

// ============================================
// Database Access Tokens (for Federal Contractor Database)
// ============================================

export interface DatabaseAccessToken {
  token: string;
  email: string;
  customerName?: string;
  createdAt: string;
  expiresAt?: string; // Optional expiry
}

// Generate a random database access token
export function generateDatabaseToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Create a new database access token for a customer
export async function createDatabaseToken(email: string, customerName?: string): Promise<DatabaseAccessToken> {
  const token = generateDatabaseToken();
  const dbToken: DatabaseAccessToken = {
    token,
    email,
    customerName,
    createdAt: new Date().toISOString(),
  };

  // Check if user already has access (for admin tracking list)
  const existingAccess = await kv.get(`dbaccess:${email.toLowerCase()}`);

  // Store in KV with token as key (no expiry - lifetime access)
  await kv.set(`dbtoken:${token}`, dbToken);

  // Also store by email for lookup
  await kv.set(`dbaccess:${email.toLowerCase()}`, { token, createdAt: dbToken.createdAt, customerName });

  // Add to list for admin tracking (if not already present)
  if (!existingAccess) {
    await kv.lpush('db:all', email.toLowerCase());
  }

  console.log(`✅ Database access token created: ${token} for ${email}`);
  return dbToken;
}

// Validate a database access token
export async function validateDatabaseToken(token: string): Promise<{ valid: boolean; tokenData?: DatabaseAccessToken; error?: string }> {
  const tokenData = await kv.get<DatabaseAccessToken>(`dbtoken:${token}`);

  if (!tokenData) {
    return { valid: false, error: 'Invalid access token' };
  }

  return { valid: true, tokenData };
}

// Check if an email has database access
export async function hasEmailDatabaseAccess(email: string): Promise<boolean> {
  const access = await kv.get(`dbaccess:${email.toLowerCase()}`);
  return !!access;
}

// Get all database access records for admin
export interface DatabaseAccessRecord {
  email: string;
  customerName?: string;
  createdAt: string;
  token: string;
}

export async function getAllDatabaseAccess(): Promise<DatabaseAccessRecord[]> {
  const allEmails = await kv.lrange('db:all', 0, -1) as string[];

  if (!allEmails || allEmails.length === 0) {
    return [];
  }

  // Deduplicate emails
  const uniqueEmails = [...new Set(allEmails)];

  const records: DatabaseAccessRecord[] = [];

  for (const email of uniqueEmails) {
    const access = await kv.get<{ token: string; createdAt: string; customerName?: string }>(`dbaccess:${email}`);
    if (access) {
      records.push({
        email,
        customerName: access.customerName,
        createdAt: access.createdAt,
        token: access.token,
      });
    }
  }

  return records;
}

// Revoke database access
export async function revokeDatabaseAccess(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();

  // Get the access record to find the token
  const access = await kv.get<{ token: string }>(`dbaccess:${normalizedEmail}`);

  if (access?.token) {
    // Delete the token
    await kv.del(`dbtoken:${access.token}`);
  }

  // Delete the access record
  await kv.del(`dbaccess:${normalizedEmail}`);

  // Remove from tracking list
  await kv.lrem('db:all', 0, normalizedEmail);

  console.log(`🗑️ Database access revoked for: ${email}`);
  return true;
}

// ============================================
// Opportunity Hunter Pro Access
// ============================================

export interface OpportunityHunterProAccess {
  email: string;
  customerName?: string;
  createdAt: string;
  productId: string;
}

// Grant Opportunity Hunter Pro access to a customer
export async function grantOpportunityHunterProAccess(email: string, customerName?: string): Promise<OpportunityHunterProAccess> {
  // Check if user already has access
  const existingAccess = await kv.get(`ospro:${email.toLowerCase()}`);

  const access: OpportunityHunterProAccess = {
    email: email.toLowerCase(),
    customerName: customerName || (existingAccess as OpportunityHunterProAccess)?.customerName,
    createdAt: (existingAccess as OpportunityHunterProAccess)?.createdAt || new Date().toISOString(),
    productId: 'opportunity-hunter-pro',
  };

  // Store by email (lowercase for consistent lookup)
  await kv.set(`ospro:${email.toLowerCase()}`, access);

  // Add to list for admin tracking (only if new)
  if (!existingAccess) {
    await kv.lpush('ospro:all', email.toLowerCase());
  }

  console.log(`✅ Opportunity Hunter Pro access granted to: ${email}`);
  return access;
}

// Check if an email has Opportunity Hunter Pro access
export async function hasOpportunityHunterProAccess(email: string): Promise<boolean> {
  const access = await kv.get(`ospro:${email.toLowerCase()}`);
  return !!access;
}

// Get Opportunity Hunter Pro access details
export async function getOpportunityHunterProAccess(email: string): Promise<OpportunityHunterProAccess | null> {
  const access = await kv.get<OpportunityHunterProAccess>(`ospro:${email.toLowerCase()}`);
  return access;
}

// ============================================
// Market Assassin Tiered Access (Standard/Premium)
// ============================================

export type MarketAssassinTier = 'standard' | 'premium';

export interface MarketAssassinAccess {
  email: string;
  customerName?: string;
  tier: MarketAssassinTier;
  createdAt: string;
  upgradedAt?: string; // If upgraded from standard to premium
}

// Features available per tier
export const MARKET_ASSASSIN_TIER_FEATURES: Record<MarketAssassinTier, {
  price: number;
  features: string[];
  blockedSections: string[];
}> = {
  standard: {
    price: 297,
    features: [
      'Standard Report',
      'Analytics',
      'Government Buyers',
      'OSBP Contacts',
      'PDF/Print Export',
    ],
    blockedSections: ['idvContracts', 'december', 'subcontracting', 'tribal'],
  },
  premium: {
    price: 497,
    features: [
      'Standard Report',
      'Analytics',
      'Government Buyers',
      'OSBP Contacts',
      'PDF/Print Export',
      'IDV Contracts',
      'Similar Awards',
      'Subcontracting Opportunities',
      'Tribal Contracting',
    ],
    blockedSections: [],
  },
};

// Grant Market Assassin access to a customer
export async function grantMarketAssassinAccess(
  email: string,
  tier: MarketAssassinTier,
  customerName?: string
): Promise<MarketAssassinAccess> {
  // Check if user already has access (for upgrades)
  const existingAccess = await getMarketAssassinAccess(email);

  const access: MarketAssassinAccess = {
    email: email.toLowerCase(),
    customerName: customerName || existingAccess?.customerName,
    tier,
    createdAt: existingAccess?.createdAt || new Date().toISOString(),
    upgradedAt: existingAccess && tier === 'premium' ? new Date().toISOString() : undefined,
  };

  // Store by email (lowercase for consistent lookup)
  await kv.set(`ma:${email.toLowerCase()}`, access);

  // Add to list for admin tracking (only if new)
  if (!existingAccess) {
    await kv.lpush('ma:all', email.toLowerCase());
  }

  console.log(`✅ Market Assassin ${tier} access granted to: ${email}`);
  return access;
}

// Check if an email has Market Assassin access
export async function hasMarketAssassinAccess(email: string): Promise<boolean> {
  const access = await kv.get(`ma:${email.toLowerCase()}`);
  return !!access;
}

// Get Market Assassin access details
export async function getMarketAssassinAccess(email: string): Promise<MarketAssassinAccess | null> {
  const access = await kv.get<MarketAssassinAccess>(`ma:${email.toLowerCase()}`);
  return access;
}

// Get Market Assassin tier for an email
export async function getMarketAssassinTier(email: string): Promise<MarketAssassinTier | null> {
  const access = await getMarketAssassinAccess(email);
  return access?.tier || null;
}

// Check if a section is accessible for a given tier
export function isSectionAccessible(tier: MarketAssassinTier, sectionId: string): boolean {
  const blockedSections = MARKET_ASSASSIN_TIER_FEATURES[tier].blockedSections;
  return !blockedSections.includes(sectionId);
}

// Upgrade from standard to premium
export async function upgradeToMarketAssassinPremium(email: string): Promise<MarketAssassinAccess | null> {
  const existingAccess = await getMarketAssassinAccess(email);

  if (!existingAccess) {
    return null; // No existing access to upgrade
  }

  if (existingAccess.tier === 'premium') {
    return existingAccess; // Already premium
  }

  return grantMarketAssassinAccess(email, 'premium', existingAccess.customerName);
}

// Get all Market Assassin access records (for admin)
export async function getAllMarketAssassinAccess(): Promise<MarketAssassinAccess[]> {
  const allEmails = await kv.lrange('ma:all', 0, -1) as string[];

  if (!allEmails || allEmails.length === 0) {
    return [];
  }

  // Deduplicate emails
  const uniqueEmails = [...new Set(allEmails)];

  const accessRecords: MarketAssassinAccess[] = [];
  for (const email of uniqueEmails) {
    const access = await kv.get<MarketAssassinAccess>(`ma:${email}`);
    if (access) {
      accessRecords.push(access);
    }
  }

  return accessRecords.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// ============================================
// Market Assassin Usage Tracking (Monthly Limits)
// ============================================

export interface MonthlyUsage {
  email: string;
  month: string; // Format: YYYY-MM
  reportCount: number;
  lastReportAt: string;
}

// Monthly report limits per tier
export const MONTHLY_REPORT_LIMITS: Record<MarketAssassinTier, number> = {
  standard: 30,
  premium: Infinity, // Unlimited for premium
};

// Get the current month key (YYYY-MM format)
function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Get monthly usage for a user
export async function getMonthlyUsage(email: string): Promise<MonthlyUsage | null> {
  const monthKey = getCurrentMonthKey();
  const usage = await kv.get<MonthlyUsage>(`ma:usage:${email.toLowerCase()}:${monthKey}`);
  return usage;
}

// Increment report usage for a user
export async function incrementReportUsage(email: string): Promise<MonthlyUsage> {
  const monthKey = getCurrentMonthKey();
  const kvKey = `ma:usage:${email.toLowerCase()}:${monthKey}`;

  const existingUsage = await kv.get<MonthlyUsage>(kvKey);

  const usage: MonthlyUsage = {
    email: email.toLowerCase(),
    month: monthKey,
    reportCount: (existingUsage?.reportCount || 0) + 1,
    lastReportAt: new Date().toISOString(),
  };

  // Store with 45-day expiry (so old months clean up automatically)
  await kv.set(kvKey, usage, { ex: 45 * 24 * 60 * 60 });

  return usage;
}

// Check if user can generate a report (based on tier limits)
export async function canGenerateReport(email: string): Promise<{
  allowed: boolean;
  currentUsage: number;
  limit: number;
  remaining: number;
  tier: MarketAssassinTier;
}> {
  const access = await getMarketAssassinAccess(email);

  if (!access) {
    return {
      allowed: false,
      currentUsage: 0,
      limit: 0,
      remaining: 0,
      tier: 'standard',
    };
  }

  const tier = access.tier;
  const limit = MONTHLY_REPORT_LIMITS[tier];

  // Premium users have unlimited access
  if (tier === 'premium') {
    return {
      allowed: true,
      currentUsage: 0,
      limit: Infinity,
      remaining: Infinity,
      tier,
    };
  }

  // Check standard tier usage
  const usage = await getMonthlyUsage(email);
  const currentUsage = usage?.reportCount || 0;
  const remaining = Math.max(0, limit - currentUsage);

  return {
    allowed: currentUsage < limit,
    currentUsage,
    limit,
    remaining,
    tier,
  };
}

// Get usage stats for admin
export async function getUsageStats(email: string): Promise<{
  currentMonth: MonthlyUsage | null;
  tier: MarketAssassinTier | null;
  limit: number;
}> {
  const access = await getMarketAssassinAccess(email);
  const usage = await getMonthlyUsage(email);

  return {
    currentMonth: usage,
    tier: access?.tier || null,
    limit: access ? MONTHLY_REPORT_LIMITS[access.tier] : 0,
  };
}

// ============================================
// GovCon Content Generator Access (Tiered)
// ============================================

export type ContentGeneratorTier = 'content-engine' | 'full-fix';

export interface ContentGeneratorAccess {
  email: string;
  customerName?: string;
  tier: ContentGeneratorTier;
  createdAt: string;
  upgradedAt?: string;
  productId: string;
}

// Features available per tier
export const CONTENT_GENERATOR_TIER_FEATURES: Record<ContentGeneratorTier, {
  price: number;
  name: string;
  features: string[];
}> = {
  'content-engine': {
    price: 197,
    name: 'Content Engine',
    features: [
      'Unlimited LinkedIn post generation',
      'Real-time agency spending data',
      '15 content templates & structures',
      'Company personalization',
      'Hashtag optimization',
    ],
  },
  'full-fix': {
    price: 297,
    name: 'Full Fix',
    features: [
      'Everything in Content Engine',
      'AI Quote Card Graphics',
      '6 professional visual styles',
      'Complementary quote generation',
      'One-click image download',
      'Company branding on graphics',
    ],
  },
};

// Grant GovCon Content Generator access to a customer
export async function grantContentGeneratorAccess(
  email: string,
  tier: ContentGeneratorTier = 'content-engine',
  customerName?: string
): Promise<ContentGeneratorAccess> {
  // Check if user already has access (for upgrades)
  const existingAccess = await getContentGeneratorAccess(email);

  const access: ContentGeneratorAccess = {
    email: email.toLowerCase(),
    customerName: customerName || existingAccess?.customerName,
    tier,
    createdAt: existingAccess?.createdAt || new Date().toISOString(),
    upgradedAt: existingAccess && tier === 'full-fix' ? new Date().toISOString() : undefined,
    productId: 'govcon-content-generator',
  };

  // Store by email (lowercase for consistent lookup)
  await kv.set(`contentgen:${email.toLowerCase()}`, access);

  // Add to list for admin tracking (only if new)
  if (!existingAccess) {
    await kv.lpush('contentgen:all', email.toLowerCase());
  }

  console.log(`✅ GovCon Content Generator ${tier} access granted to: ${email}`);
  return access;
}

// Check if an email has Content Generator access
export async function hasContentGeneratorAccess(email: string): Promise<boolean> {
  const access = await kv.get(`contentgen:${email.toLowerCase()}`);
  return !!access;
}

// Get Content Generator access details
export async function getContentGeneratorAccess(email: string): Promise<ContentGeneratorAccess | null> {
  const access = await kv.get<ContentGeneratorAccess>(`contentgen:${email.toLowerCase()}`);
  return access;
}

// Get all Content Generator access records (for admin)
export async function getAllContentGeneratorAccess(): Promise<ContentGeneratorAccess[]> {
  const allEmails = await kv.lrange('contentgen:all', 0, -1) as string[];

  if (!allEmails || allEmails.length === 0) {
    return [];
  }

  // Deduplicate emails
  const uniqueEmails = [...new Set(allEmails)];

  const accessRecords: ContentGeneratorAccess[] = [];
  for (const email of uniqueEmails) {
    const access = await kv.get<ContentGeneratorAccess>(`contentgen:${email}`);
    if (access) {
      accessRecords.push(access);
    }
  }

  return accessRecords.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Revoke Content Generator access
export async function revokeContentGeneratorAccess(email: string): Promise<boolean> {
  const deleted = await kv.del(`contentgen:${email.toLowerCase()}`);
  if (deleted) {
    await kv.lrem('contentgen:all', 1, email.toLowerCase());
  }
  return deleted > 0;
}

// ============================================
// Recompete Contracts Tracker Access
// ============================================

export interface RecompeteAccess {
  email: string;
  customerName?: string;
  createdAt: string;
}

// Grant Recompete Contracts Tracker access to a customer
export async function grantRecompeteAccess(
  email: string,
  customerName?: string | null
): Promise<RecompeteAccess> {
  // Check for existing access BEFORE setting new access
  const existingAccess = await kv.get(`recompete:${email.toLowerCase()}`);

  // Ensure customerName is properly set (convert null to undefined for storage)
  const finalCustomerName = customerName || undefined;

  console.log('grantRecompeteAccess called with:', { email, customerName, finalCustomerName });

  const access: RecompeteAccess = {
    email: email.toLowerCase(),
    customerName: finalCustomerName,
    createdAt: existingAccess ? (existingAccess as RecompeteAccess).createdAt : new Date().toISOString(),
  };

  console.log('Storing recompete access object:', JSON.stringify(access));

  // Store by email (lowercase for consistent lookup)
  await kv.set(`recompete:${email.toLowerCase()}`, access);

  // Verify it was stored correctly
  const verifyAccess = await kv.get(`recompete:${email.toLowerCase()}`);
  console.log('Verified stored access:', JSON.stringify(verifyAccess));

  // Add to list for admin tracking (only if new)
  if (!existingAccess) {
    await kv.lpush('recompete:all', email.toLowerCase());
  }

  console.log(`✅ Recompete Contracts Tracker access granted to: ${email}`);
  return access;
}

// Check if an email has Recompete access
export async function hasRecompeteAccess(email: string): Promise<boolean> {
  const access = await kv.get(`recompete:${email.toLowerCase()}`);
  return !!access;
}

// Get Recompete access details
export async function getRecompeteAccess(email: string): Promise<RecompeteAccess | null> {
  const access = await kv.get<RecompeteAccess>(`recompete:${email.toLowerCase()}`);
  return access;
}

// Get all Recompete access records (for admin)
export async function getAllRecompeteAccess(): Promise<RecompeteAccess[]> {
  const allEmails = await kv.lrange('recompete:all', 0, -1) as string[];

  if (!allEmails || allEmails.length === 0) {
    return [];
  }

  // Deduplicate emails
  const uniqueEmails = [...new Set(allEmails)];

  const accessRecords: RecompeteAccess[] = [];
  for (const email of uniqueEmails) {
    const access = await kv.get<RecompeteAccess>(`recompete:${email}`);
    if (access) {
      accessRecords.push(access);
    }
  }

  return accessRecords.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Revoke Recompete access
export async function revokeRecompeteAccess(email: string): Promise<boolean> {
  const deleted = await kv.del(`recompete:${email.toLowerCase()}`);
  if (deleted) {
    await kv.lrem('recompete:all', 1, email.toLowerCase());
  }
  return deleted > 0;
}
