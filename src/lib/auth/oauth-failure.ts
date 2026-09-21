/**
 * ENTERPRISE OAUTH FAILURE CLASSIFICATION
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────
 * A user at a Microsoft 365 tenant clicks "Continue with Microsoft" and is refused by
 * their OWN organization's policy. Nothing is broken — an admin simply has not approved
 * the app. Rendering that as "Failed to connect with Microsoft" is actively harmful: the
 * user retries, blames us, and never learns the one thing that would resolve it (ask
 * their IT admin to grant consent).
 *
 * These are three DIFFERENT products of a failure, and conflating them is the bug:
 *
 *   tenant policy    -> the org must act.   Show admin instructions. NOT our bug.
 *   our misconfig    -> WE must act.        Never tell an org to call their admin.
 *   ordinary failure -> the user may retry. Generic message is correct here.
 *
 * ── SOURCE OF TRUTH ─────────────────────────────────────────────────────────────────
 * Every code and description below is transcribed from Microsoft's official reference,
 * NOT inferred from a symptom or a blog post:
 *   https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes
 *
 * ⚠️ AADSTS900971 is deliberately classified as OUR misconfiguration, not admin consent.
 * It reads "No reply address provided" — a redirect-URI problem on our side. Community
 * write-ups group it with the "need admin approval" family because it surfaces during
 * consent; that is wrong, and acting on it would send an entire org to their IT
 * department over a bug we introduced.
 *
 * ── COPILOT ─────────────────────────────────────────────────────────────────────────
 * Microsoft Copilot connector denials are tracked as a SEPARATE observed case and are
 * NOT classified here. Their error payload has not been traced, and guessing its shape
 * would produce exactly the confident-but-wrong classification this module exists to
 * prevent. See `COPILOT_OBSERVED` at the bottom.
 */

export type OAuthFailureKind =
  /** The user's own tenant refuses the app until an admin acts. THE ORG must act. */
  | 'tenant_policy'
  /** Our app registration is wrong (redirect URI, disabled app). WE must act. */
  | 'app_misconfigured'
  /** The person cancelled at the consent screen. Not an error. */
  | 'user_cancelled'
  /** Anything else — genuine transient/unknown failure. */
  | 'generic';

/** Which party can actually resolve the failure. Drives the UI and the on-call routing. */
export type OAuthResolver = 'tenant_admin' | 'mindy' | 'end_user' | 'unknown';

export interface OAuthFailure {
  kind: OAuthFailureKind;
  resolver: OAuthResolver;
  /** The AADSTS code when one was present, e.g. "AADSTS65001". */
  code: string | null;
  provider: 'microsoft' | 'google' | 'apple' | 'unknown';
  /** Raw OAuth `error` param, kept for the structured log. */
  rawError: string | null;
  /** Raw `error_description`, kept for the structured log. Never rendered verbatim. */
  rawDescription: string | null;
  /** Stable slug for logging/aggregation, e.g. "microsoft.tenant_policy.AADSTS65001". */
  reason: string;
}

interface CodeSpec {
  kind: OAuthFailureKind;
  resolver: OAuthResolver;
  /** Verbatim Microsoft description — for the log and for support, not for the user. */
  microsoft: string;
}

/**
 * AADSTS codes we classify. Verbatim descriptions from Microsoft's reference.
 * Anything absent falls through to `generic` — an unknown code must NOT be guessed
 * into a tenant-policy state.
 */
export const AADSTS_CODES: Record<string, CodeSpec> = {
  // ── THE ORG MUST ACT ───────────────────────────────────────────────────────────────
  AADSTS65001: {
    kind: 'tenant_policy',
    resolver: 'tenant_admin',
    microsoft:
      "DelegationDoesNotExist - The user or administrator hasn't consented to use the application with ID X.",
  },
  AADSTS90094: {
    kind: 'tenant_policy',
    resolver: 'tenant_admin',
    microsoft: 'AdminConsentRequired - Administrator consent is required.',
  },
  AADSTS90095: {
    kind: 'tenant_policy',
    resolver: 'tenant_admin',
    microsoft:
      'AdminConsentRequiredRequestAccess - In the Admin Consent Workflow experience, an interrupt that appears when the user is told they need to ask the admin for consent.',
  },
  AADSTS53003: {
    kind: 'tenant_policy',
    resolver: 'tenant_admin',
    microsoft:
      'BlockedByConditionalAccess - Access has been blocked by Conditional Access policies. The access policy does not allow token issuance.',
  },
  AADSTS50105: {
    kind: 'tenant_policy',
    resolver: 'tenant_admin',
    microsoft:
      "EntitlementGrantsNotFound - The signed in user isn't assigned to a role for the signed in app.",
  },
  AADSTS700016: {
    kind: 'tenant_policy',
    resolver: 'tenant_admin',
    microsoft:
      "UnauthorizedClient_DoesNotMatchRequest - The application wasn't found in the directory/tenant. This can happen if the application has not been installed by the administrator of the tenant or consented to by any user in the tenant.",
  },
  AADSTS50020: {
    kind: 'tenant_policy',
    resolver: 'tenant_admin',
    microsoft:
      'UserUnauthorized - User account from identity provider does not exist in tenant and cannot access the application in that tenant.',
  },

  // ── WE MUST ACT (never route these to a customer's IT department) ─────────────────
  AADSTS900971: {
    kind: 'app_misconfigured',
    resolver: 'mindy',
    microsoft: 'No reply address provided.',
  },
  AADSTS50011: {
    kind: 'app_misconfigured',
    resolver: 'mindy',
    microsoft:
      "RedirectUriMismatch - The redirect URI specified in the request does not match the redirect URIs configured for the application.",
  },
  AADSTS7000112: {
    kind: 'app_misconfigured',
    resolver: 'mindy',
    microsoft: 'UnauthorizedClientApplicationDisabled - The application is disabled.',
  },
};

/** OAuth 2.0 `error` values that mean the person declined. Not a failure to fix. */
const CANCELLED_ERRORS = new Set(['access_denied', 'user_cancelled_login', 'consent_required']);

/** Extract the first AADSTS code from free text. Entra puts it in `error_description`. */
export function extractAadstsCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /\bAADSTS(\d{4,7})\b/i.exec(text);
  return m ? `AADSTS${m[1]}` : null;
}

export interface ClassifyInput {
  provider?: string | null;
  /** OAuth `error` query param. */
  error?: string | null;
  /** OAuth `error_description` query param — where the AADSTS code lives. */
  errorDescription?: string | null;
  /** Optional explicit subcode (some flows surface `error_subcode`). */
  errorSubcode?: string | null;
}

function normalizeProvider(p: string | null | undefined): OAuthFailure['provider'] {
  const v = (p || '').toLowerCase();
  if (v === 'azure' || v === 'microsoft' || v === 'entra' || v === 'azuread') return 'microsoft';
  if (v === 'google') return 'google';
  if (v === 'apple') return 'apple';
  return 'unknown';
}

/**
 * Classify an OAuth failure into an actionable kind.
 *
 * Deliberately conservative: an unrecognized code is `generic`, never a guessed
 * tenant-policy state. Telling an org "your admin must approve this" when that is not
 * the real cause sends them to their IT department for nothing and costs us their trust.
 */
export function classifyOAuthFailure(input: ClassifyInput): OAuthFailure {
  const provider = normalizeProvider(input.provider);
  const rawError = input.error ?? null;
  const rawDescription = input.errorDescription ?? null;

  const code =
    extractAadstsCode(input.errorDescription) ||
    extractAadstsCode(input.errorSubcode) ||
    extractAadstsCode(input.error);

  const spec = code ? AADSTS_CODES[code] : undefined;

  let kind: OAuthFailureKind;
  let resolver: OAuthResolver;

  if (spec) {
    // A KNOWN code always wins over the generic `error` param: Entra returns
    // `error=access_denied` alongside AADSTS65001, and reading only the param would
    // misfile a real admin-consent denial as "the user changed their mind".
    kind = spec.kind;
    resolver = spec.resolver;
  } else if (code) {
    // An AADSTS code we do not recognize. Entra refused for a server-side reason, so
    // this is NOT a user cancellation even though `error=access_denied` rides along —
    // that param accompanies genuine policy denials too. Leave it `generic` (never a
    // guessed admin-approval screen) and let the structured log surface the code so we
    // can classify it deliberately.
    kind = 'generic';
    resolver = 'unknown';
  } else if (rawError && CANCELLED_ERRORS.has(rawError.toLowerCase())) {
    kind = 'user_cancelled';
    resolver = 'end_user';
  } else {
    kind = 'generic';
    resolver = 'unknown';
  }

  return {
    kind,
    resolver,
    code,
    provider,
    rawError,
    rawDescription,
    reason: `${provider}.${kind}${code ? `.${code}` : ''}`,
  };
}

/** True when the org — not the user and not us — has to act. Gates the dedicated UI. */
export function requiresAdminApproval(f: OAuthFailure): boolean {
  return f.kind === 'tenant_policy';
}

/**
 * Microsoft Copilot connector denials — OBSERVED, NOT CLASSIFIED.
 *
 * Copilot surfaces its own refusal when a tenant blocks a connector, but we have not
 * traced its error payload, so we do not know whether it carries an AADSTS code, a
 * different code namespace, or no machine-readable code at all. Pattern-matching on the
 * word "Copilot" would be a guess, and a wrong "your admin must approve" is exactly the
 * failure this module prevents.
 *
 * TO CLOSE: capture one real denial (full callback URL + error/error_description), add
 * the codes to AADSTS_CODES if they are AADSTS-shaped, or give it its own table if not,
 * and add a regression case from the captured payload.
 */
export const COPILOT_OBSERVED = {
  status: 'observed_untraced' as const,
  note: 'Copilot connector denial: error payload not yet captured. Do not classify by name.',
};
