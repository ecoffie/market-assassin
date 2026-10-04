/**
 * Identify a Google service-account credential WITHOUT revealing it.
 *
 * Returns only non-secret identifiers: the service-account email, the key id (the same id the
 * Cloud console lists under IAM → Service accounts → Keys), the credential type and project. The
 * private key is never returned, logged or included in an error message — a parse failure says
 * only that the value is not a service-account credential.
 *
 * Accepts the two encodings in use: raw JSON, or base64-encoded JSON (as stored in Vercel and the
 * GitHub secret today). A JSON value whose private_key newlines were escaped once more is tolerated.
 */

/** @param {string | undefined | null} raw */
export function identifyCredential(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, reason: 'credential is empty or not set' };
  let parsed = null;
  const attempts = value.startsWith('{')
    ? [value, value.replace(/\\n/g, '\n')]
    : [Buffer.from(value, 'base64').toString('utf8')];
  for (const text of attempts) {
    try {
      parsed = JSON.parse(text);
      break;
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'value is not parseable as a service-account credential (value not shown)' };
  }
  const { type, client_email: clientEmail, private_key_id: keyId, project_id: projectId } = parsed;
  if (type !== 'service_account' || typeof clientEmail !== 'string' || typeof keyId !== 'string' || !keyId) {
    return { ok: false, reason: 'value parsed but is not a service-account key (missing type, client_email or private_key_id)' };
  }
  return { ok: true, type, clientEmail, keyId, projectId: typeof projectId === 'string' ? projectId : null };
}

/**
 * Compare a key id against an expected prefix (e.g. the exposed key "814e6f"). Prefix only, so a
 * full key id never has to be typed into a workflow input.
 * @param {string} keyId
 * @param {string | undefined | null} prefix
 */
export function matchesKeyPrefix(keyId, prefix) {
  const p = String(prefix ?? '').trim().toLowerCase();
  if (!p) return null;
  if (!/^[0-9a-f]{4,40}$/.test(p)) throw new Error('expected key id prefix must be 4-40 hex characters');
  return keyId.toLowerCase().startsWith(p);
}
