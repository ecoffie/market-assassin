/**
 * Tiny symmetric secret box (AES-256-GCM) for encrypting third-party credentials
 * at rest — currently the user's GoHighLevel Private Integration Token stored in
 * `user_crm_connections` (add_contacts_to_crm). Authenticated encryption: tampering
 * with the ciphertext fails decryption (GCM auth tag).
 *
 * Key derivation: scrypt(secret, fixed salt) → 32 bytes. The secret is
 * CRM_TOKEN_ENC_KEY, falling back to MCP_OAUTH_SIGNING_SECRET / ADMIN_PASSWORD so it
 * works without a new env var (a dedicated CRM_TOKEN_ENC_KEY is the recommended
 * production setup). Server-only (node:crypto).
 */
import crypto from 'node:crypto';

const SALT = 'mindy-secretbox-v1';

/** A caller-supplied dedicated key (with its own salt) bypasses the shared fallback chain entirely. */
export interface SecretKey { secret: string; salt: string }

function deriveKey(key?: SecretKey): Buffer {
  if (key) {
    if (!key.secret) throw new Error('secretbox: dedicated key is empty');
    return crypto.scryptSync(key.secret, key.salt, 32);
  }
  const secret =
    process.env.CRM_TOKEN_ENC_KEY || process.env.MCP_OAUTH_SIGNING_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('secretbox: set CRM_TOKEN_ENC_KEY (or MCP_OAUTH_SIGNING_SECRET / ADMIN_PASSWORD) to encrypt secrets');
  }
  return crypto.scryptSync(secret, SALT, 32);
}

/** Encrypt a UTF-8 string → `v1:<iv>:<tag>:<ciphertext>` (all base64). */
export function encryptSecret(plain: string, key?: SecretKey): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Decrypt a blob produced by encryptSecret. Throws on tamper / wrong key / bad format. */
export function decryptSecret(blob: string, key?: SecretKey): string {
  const parts = (blob || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('secretbox: unrecognized ciphertext format');
  const [, ivB, tagB, dataB] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(key), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}
