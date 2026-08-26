/**
 * Regression tests built from REAL Microsoft Entra error payloads.
 *
 * The shape below is what Entra actually appends to the redirect URI on a denial —
 * `error=access_denied` plus an `error_description` whose first token is the AADSTS
 * code, URL-encoded with `+` for spaces. Tests assert on that real shape rather than a
 * tidied-up version, because the `access_denied`-alongside-AADSTS65001 case is exactly
 * where a naive reading misfiles an admin-consent denial as a user cancellation.
 *
 * Descriptions transcribed from:
 *   https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes
 */
import { describe, it, expect } from 'vitest';
import {
  classifyOAuthFailure,
  requiresAdminApproval,
  extractAadstsCode,
  AADSTS_CODES,
  COPILOT_OBSERVED,
} from './oauth-failure';

/** A real Entra denial redirect: ?error=...&error_description=AADSTSxxxxx:+... */
function entra(code: string, description: string, error = 'access_denied') {
  return {
    provider: 'azure',
    error,
    errorDescription: `${code}: ${description}`,
  };
}

describe('extractAadstsCode', () => {
  it('pulls the code out of a real error_description', () => {
    expect(
      extractAadstsCode(
        "AADSTS65001: The user or administrator hasn't consented to use the application with ID 'abc'."
      )
    ).toBe('AADSTS65001');
  });

  it('handles the URL-decoded plus-separated form', () => {
    expect(extractAadstsCode('AADSTS90094:+Administrator+consent+is+required.')).toBe('AADSTS90094');
  });

  it('returns null when there is no code — never a partial guess', () => {
    expect(extractAadstsCode('something went wrong')).toBeNull();
    expect(extractAadstsCode(null)).toBeNull();
    expect(extractAadstsCode('')).toBeNull();
  });

  it('does not match a bare AADSTS with no digits', () => {
    expect(extractAadstsCode('AADSTS: nope')).toBeNull();
  });
});

describe('tenant policy — the org must act', () => {
  const cases: Array<[string, string]> = [
    ['AADSTS65001', "The user or administrator hasn't consented to use the application with ID 'x'."],
    ['AADSTS90094', 'Administrator consent is required.'],
    ['AADSTS90095', 'In the Admin Consent Workflow experience, an interrupt appears.'],
    ['AADSTS53003', 'Access has been blocked by Conditional Access policies.'],
    ['AADSTS50105', "The signed in user isn't assigned to a role for the signed in app."],
    ['AADSTS700016', "The application wasn't found in the directory/tenant."],
    ['AADSTS50020', 'User account from identity provider does not exist in tenant.'],
  ];

  it.each(cases)('%s is tenant_policy, resolved by the tenant admin', (code, desc) => {
    const f = classifyOAuthFailure(entra(code, desc));
    expect(f.kind).toBe('tenant_policy');
    expect(f.resolver).toBe('tenant_admin');
    expect(f.code).toBe(code);
    expect(requiresAdminApproval(f)).toBe(true);
  });

  it('THE REGRESSION: access_denied alongside AADSTS65001 is NOT a user cancellation', () => {
    // Entra sends error=access_denied WITH the admin-consent code. Reading only the
    // `error` param files a real org-policy denial as "user changed their mind" and the
    // user never learns to ask their admin. The code must win.
    const f = classifyOAuthFailure(
      entra('AADSTS65001', "The user or administrator hasn't consented.", 'access_denied')
    );
    expect(f.kind).toBe('tenant_policy');
    expect(f.kind).not.toBe('user_cancelled');
    expect(requiresAdminApproval(f)).toBe(true);
  });

  it('never reports a tenant-policy denial as generic', () => {
    const f = classifyOAuthFailure(entra('AADSTS90094', 'Administrator consent is required.'));
    expect(f.kind).not.toBe('generic');
  });
});

describe('our misconfiguration — never send the org to their IT admin', () => {
  const cases: Array<[string, string]> = [
    ['AADSTS900971', 'No reply address provided.'],
    ['AADSTS50011', 'The redirect URI specified in the request does not match.'],
    ['AADSTS7000112', 'The application is disabled.'],
  ];

  it.each(cases)('%s is app_misconfigured, resolved by us', (code, desc) => {
    const f = classifyOAuthFailure(entra(code, desc));
    expect(f.kind).toBe('app_misconfigured');
    expect(f.resolver).toBe('mindy');
    expect(requiresAdminApproval(f)).toBe(false);
  });

  it('AADSTS900971 is NOT admin-consent despite surfacing during consent', () => {
    // Community write-ups group this with "need admin approval". Microsoft's reference
    // says "No reply address provided" — a redirect-URI bug on OUR side. Misclassifying
    // it sends a whole org to their IT department over our own defect.
    const f = classifyOAuthFailure(entra('AADSTS900971', 'No reply address provided.'));
    expect(f.kind).toBe('app_misconfigured');
    expect(f.resolver).not.toBe('tenant_admin');
  });
});

describe('user cancellation', () => {
  it('access_denied with no AADSTS code is a cancellation', () => {
    const f = classifyOAuthFailure({
      provider: 'azure',
      error: 'access_denied',
      errorDescription: 'The user denied the request.',
    });
    expect(f.kind).toBe('user_cancelled');
    expect(f.resolver).toBe('end_user');
    expect(requiresAdminApproval(f)).toBe(false);
  });
});

describe('unknown codes stay generic — no guessing', () => {
  it('an unmapped AADSTS code does not become tenant_policy', () => {
    const f = classifyOAuthFailure(entra('AADSTS12345', 'Some future error nobody has seen.'));
    expect(f.kind).toBe('generic');
    expect(requiresAdminApproval(f)).toBe(false);
    // The code is still captured so the log can tell us what to add next.
    expect(f.code).toBe('AADSTS12345');
  });

  it('an empty failure is generic, not a crash', () => {
    const f = classifyOAuthFailure({});
    expect(f.kind).toBe('generic');
    expect(f.code).toBeNull();
    expect(f.provider).toBe('unknown');
  });
});

describe('provider normalization', () => {
  it.each([
    ['azure', 'microsoft'],
    ['microsoft', 'microsoft'],
    ['entra', 'microsoft'],
    ['google', 'google'],
    ['apple', 'apple'],
    ['whatever', 'unknown'],
  ])('%s -> %s', (input, expected) => {
    expect(classifyOAuthFailure({ provider: input }).provider).toBe(expected);
  });
});

describe('structured reason slug', () => {
  it('is stable and aggregatable', () => {
    const f = classifyOAuthFailure(entra('AADSTS65001', "hasn't consented"));
    expect(f.reason).toBe('microsoft.tenant_policy.AADSTS65001');
  });

  it('omits the code when there is none', () => {
    expect(
      classifyOAuthFailure({ provider: 'google', error: 'access_denied' }).reason
    ).toBe('google.user_cancelled');
  });

  it('preserves the raw payload for support, without rendering it', () => {
    const f = classifyOAuthFailure(entra('AADSTS90094', 'Administrator consent is required.'));
    expect(f.rawError).toBe('access_denied');
    expect(f.rawDescription).toContain('AADSTS90094');
  });
});

describe('the classification table itself', () => {
  it('every entry carries a verbatim Microsoft description', () => {
    for (const [code, spec] of Object.entries(AADSTS_CODES)) {
      expect(spec.microsoft.length, `${code} needs a real description`).toBeGreaterThan(10);
    }
  });

  it('only tenant_policy entries route to a tenant admin', () => {
    for (const [code, spec] of Object.entries(AADSTS_CODES)) {
      if (spec.resolver === 'tenant_admin') {
        expect(spec.kind, `${code} routes to an admin so must be tenant_policy`).toBe('tenant_policy');
      }
    }
  });
});

describe('Copilot stays an observed case', () => {
  it('is not classified until its payload is traced', () => {
    expect(COPILOT_OBSERVED.status).toBe('observed_untraced');
  });

  it('a Copilot-flavoured denial with no known code is NOT tenant_policy', () => {
    const f = classifyOAuthFailure({
      provider: 'microsoft',
      error: 'access_denied',
      errorDescription: 'Copilot connector blocked by organization policy.',
    });
    // No AADSTS code -> falls to cancellation/generic. We do NOT pattern-match "Copilot"
    // or the word "policy" into an admin-approval screen on a guess.
    expect(f.kind).not.toBe('tenant_policy');
    expect(requiresAdminApproval(f)).toBe(false);
  });
});
