/**
 * Google Search Console API client for getmindy.ai.
 *
 * Auth: reuses the BigQuery service account (GCP_SA_JSON, base64 or raw
 * JSON), same `mindy-bq-reader@market-assasin.iam.gserviceaccount.com`.
 *
 * Manual prerequisite (one time, GSC web UI): add that SA email as a
 * Restricted user on the getmindy.ai property.
 *
 * Property type is auto-detected: we try the Domain property
 * (`sc-domain:getmindy.ai`) first, then fall back to the URL-prefix
 * property (`https://getmindy.ai/`). resolveSiteUrl() caches the winner.
 */
import { GoogleAuth } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

// Candidate property strings, in preference order.
const CANDIDATE_SITE_URLS = ['sc-domain:getmindy.ai', 'https://getmindy.ai/'];

let _auth: GoogleAuth | null = null;
let _resolvedSiteUrl: string | null = null;

function parseSaJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return JSON.parse(trimmed.replace(/\\n/g, '\n'));
    }
  }
  return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
}

export function getServiceAccountEmail(): string {
  const raw = process.env.GCP_SA_JSON;
  if (!raw) return 'ADC (no GCP_SA_JSON)';
  try {
    return (parseSaJson(raw) as { client_email?: string }).client_email || 'no client_email';
  } catch (e) {
    return `parse failed: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

function getAuth(): GoogleAuth {
  if (_auth) return _auth;
  const raw = process.env.GCP_SA_JSON;
  if (raw) {
    _auth = new GoogleAuth({ credentials: parseSaJson(raw) as never, scopes: SCOPES });
  } else {
    _auth = new GoogleAuth({ scopes: SCOPES });
  }
  return _auth;
}

async function getToken(): Promise<string> {
  const token = await getAuth().getAccessToken();
  if (!token) throw new Error('GSC auth: could not obtain access token');
  return token;
}

/**
 * Determine which property string the SA actually has access to, by
 * listing the SA's properties once and matching a candidate. Cached.
 */
export async function resolveSiteUrl(): Promise<string> {
  if (_resolvedSiteUrl) return _resolvedSiteUrl;
  const token = await getToken();
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GSC list sites ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { siteEntry?: Array<{ siteUrl: string }> };
  const owned = new Set((data.siteEntry ?? []).map((s) => s.siteUrl));
  const match = CANDIDATE_SITE_URLS.find((c) => owned.has(c));
  if (!match) {
    throw new Error(
      `GSC: service account ${getServiceAccountEmail()} has access to none of ` +
        `[${CANDIDATE_SITE_URLS.join(', ')}]. It can see: [${[...owned].join(', ') || 'nothing'}]. ` +
        `Add the SA as a user on the getmindy.ai property.`
    );
  }
  _resolvedSiteUrl = match;
  return match;
}

export async function gscQuery<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const token = await getToken();
  const siteUrl = await resolveSiteUrl();
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GSC API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  return (await res.json()) as T;
}
