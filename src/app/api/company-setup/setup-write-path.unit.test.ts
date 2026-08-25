/**
 * COMPANY SETUP — the route must not be able to write on skip.
 *
 * Source-level assertions on the ENFORCEMENT SHAPE. The write SEMANTICS are proven
 * behaviourally in company-setup-outcome.unit.test.ts; what matters here is that the route
 * delegates to that locked logic instead of deciding provenance itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/app/api/company-setup/route.ts', 'utf8');
/** Strip comments — a route that QUOTES a rule while explaining it must not self-satisfy. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
                .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('the route delegates, never decides', () => {
  it('uses the locked resolveSetupWrite for the Screen-2 outcome', () => {
    expect(code).toContain('resolveSetupWrite(action');
  });

  it('never assigns a provenance value itself', () => {
    // The only place naics_source may be chosen is company-setup-outcome.ts.
    expect(code).not.toMatch(/naics_source\s*[:=]\s*['"]/);
  });

  it('applies the outcome by SPREAD, so skip\'s empty object is a no-op', () => {
    expect(code).toContain('Object.assign(notif, outcome.profile)');
  });

  it('only writes when something is actually present', () => {
    expect(code).toMatch(/if \(Object\.keys\(notif\)\.length\)/);
  });
});

describe('destination never depends on completing setup', () => {
  it('resolves the destination BEFORE any write', () => {
    // Compare the CALL sites, not the imports — the first mention of each symbol is its
    // import line, which says nothing about execution order.
    const body = code.slice(code.indexOf('export async function POST'));
    expect(body.indexOf('resolvePostSignupDestination({')).toBeLessThan(body.indexOf('resolveSetupWrite(action'));
  });

  it('uses the one shared resolver, not a local default', () => {
    expect(code).toContain('resolvePostSignupDestination');
    expect(code).not.toMatch(/['"]\/app/);
  });
});

describe('auth and failure handling', () => {
  it('requires strong auth — a staff email alone is not a credential', () => {
    expect(code).toContain('requireStrongAuth: true');
  });

  it('checks the REAL AuthResult field', () => {
    expect(code).toContain('auth.authenticated');
  });

  it('surfaces a write failure rather than returning success', () => {
    // A silent failure would be indistinguishable from a skip.
    expect(code).toMatch(/profile update failed/);
    expect(code).toMatch(/status: 500/);
  });

  it('rejects an unknown action', () => {
    expect(code).toContain("ACTIONS.includes(action)");
  });
});

describe('the screens carry no legacy destinations', () => {
  const ui = readFileSync('src/app/welcome/company/page.tsx', 'utf8');
  const uiCode = ui.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
                   .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

  it('no /app link or fallback anywhere in the UI', () => {
    expect(uiCode).not.toMatch(/['"]\/app/);
    expect(uiCode).not.toMatch(/\/briefings/);
  });

  it('Skip is present on BOTH screens', () => {
    expect(uiCode).toContain('Skip for now →');                       // header, always visible
    expect(uiCode).toContain("Skip for now — don't save any of this"  // Screen 2, consequence stated
      .replace("'", '&apos;'));
  });

  it('no progress bar, step counter or percentage', () => {
    expect(uiCode).not.toMatch(/Step \d of \d|progress|% complete/i);
  });

  it('the two SAVE actions exist and are distinct', () => {
    expect(uiCode).toContain('Confirm selections');
    expect(uiCode).toContain("Use Mindy&apos;s suggestions");
    expect(uiCode).toContain("finish('confirm')");
    expect(uiCode).toContain("finish('accept_all')");
    expect(uiCode).toContain("finish('skip')");
  });

  it('suggestions are labelled as unsaved', () => {
    expect(uiCode).toMatch(/not saved yet/i);
  });

  it('Screen 1 asks for understanding, not profile completion', () => {
    expect(uiCode).toContain('Help Mindy understand your company');
    expect(uiCode).not.toMatch(/complete your profile/i);
  });

  it('the Screen 1 CTA is market-framed', () => {
    expect(uiCode).toContain('Show me my market');
  });
});
