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

/**
 * A caller-supplied dedicated key (with its own salt) bypasses the shared fallback chain entirely.
 * `id` (optional): written into the ciphertext (`v2:<id>:...`) so a key can be rotated later; decrypt refuses a
 * ciphertext written under another key id instead of failing obscurely.
 */
export interface SecretKey { secret: string; salt: string; id?: string }

/**
 * scrypt is deliberately slow; derive each (secret, salt) once per process. Keyed by a hash, so the cache never
 * holds the secret itself as a map key.
 */
const derived = new Map<string, Buffer>();
function scryptOnce(secret: string, salt: string): Buffer {
  const k = crypto.createHash('sha256').update(salt).update('\0').update(secret).digest('hex');
  let v = derived.get(k);
  if (!v) { v = crypto.scryptSync(secret, salt, 32); derived.set(k, v); }
  return v;
}

function deriveKey(key?: SecretKey): Buffer {
  if (key) {
    if (!key.secret) throw new Error('secretbox: dedicated key is empty');
    return scryptOnce(key.secret, key.salt);
  }
  const secret =
    process.env.CRM_TOKEN_ENC_KEY || process.env.MCP_OAUTH_SIGNING_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('secretbox: set CRM_TOKEN_ENC_KEY (or MCP_OAUTH_SIGNING_SECRET / ADMIN_PASSWORD) to encrypt secrets');
  }
  return scryptOnce(secret, SALT);
}

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** Encrypt a UTF-8 string → `v1:<iv>:<tag>:<ciphertext>`, or `v2:<keyId>:<iv>:<tag>:<ciphertext>` with a key id. */
export function encryptSecret(plain: string, key?: SecretKey): string {
  if (key?.id !== undefined && !KEY_ID.test(key.id)) throw new Error('secretbox: invalid key id');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(key), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  return key?.id ? `v2:${key.id}:${body}` : `v1:${body}`;
}

/** The key id a ciphertext was written under (null for v1 / unrecognized). */
export function secretKeyId(blob: string): string | null {
  const parts = (blob || '').split(':');
  return parts.length === 5 && parts[0] === 'v2' ? parts[1] : null;
}

/** Decrypt a blob produced by encryptSecret. Throws on tamper / wrong key / bad format. */
export function decryptSecret(blob: string, key?: SecretKey): string {
  let parts = (blob || '').split(':');
  if (parts.length === 5 && parts[0] === 'v2') {
    if (!key?.id || parts[1] !== key.id) throw new Error('secretbox: ciphertext was written under another key id');
    parts = ['v1', parts[2], parts[3], parts[4]];
  }
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('secretbox: unrecognized ciphertext format');
  const [, ivB, tagB, dataB] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(key), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}
