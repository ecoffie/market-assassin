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
