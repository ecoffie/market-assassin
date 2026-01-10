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

  // Store in KV with token as key (no expiry - lifetime access)
  await kv.set(`dbtoken:${token}`, dbToken);

  // Also store by email for lookup
  await kv.set(`dbaccess:${email.toLowerCase()}`, { token, createdAt: dbToken.createdAt });

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

// ============================================
// Opportunity Scout Pro Access
// ============================================

export interface OpportunityScoutProAccess {
  email: string;
  customerName?: string;
  createdAt: string;
  productId: string;
}

// Grant Opportunity Scout Pro access to a customer
export async function grantOpportunityScoutProAccess(email: string, customerName?: string): Promise<OpportunityScoutProAccess> {
  const access: OpportunityScoutProAccess = {
    email: email.toLowerCase(),
    customerName,
    createdAt: new Date().toISOString(),
    productId: 'opportunity-scout-pro',
  };

  // Store by email (lowercase for consistent lookup)
  await kv.set(`ospro:${email.toLowerCase()}`, access);

  // Add to list for admin tracking
  await kv.lpush('ospro:all', email.toLowerCase());

  console.log(`✅ Opportunity Scout Pro access granted to: ${email}`);
  return access;
}

// Check if an email has Opportunity Scout Pro access
export async function hasOpportunityScoutProAccess(email: string): Promise<boolean> {
  const access = await kv.get(`ospro:${email.toLowerCase()}`);
  return !!access;
}

// Get Opportunity Scout Pro access details
export async function getOpportunityScoutProAccess(email: string): Promise<OpportunityScoutProAccess | null> {
  const access = await kv.get<OpportunityScoutProAccess>(`ospro:${email.toLowerCase()}`);
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

  const accessRecords: MarketAssassinAccess[] = [];
  for (const email of allEmails) {
    const access = await kv.get<MarketAssassinAccess>(`ma:${email}`);
    if (access) {
      accessRecords.push(access);
    }
  }

  return accessRecords.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
