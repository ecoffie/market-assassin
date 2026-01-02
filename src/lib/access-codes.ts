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
