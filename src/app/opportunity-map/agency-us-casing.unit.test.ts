import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shortAgencyName } from '@/lib/opportunities/agency-short-name';

// The agency title-caser (cleanAgency server-side + the client `clean()`) lowercased the tail of
// every word — which turned the dotted acronym "U.S." into "U.s." on the forecast drawer
// (Eric 2026-08-03). Both must now PRESERVE a dotted acronym while still title-casing normal words.
// 2026-08-13: forecast source_agency codes (DOJ, DHS) expand to Justice / Homeland Security so
// hover matches Open + Recompete (title-casing those codes produced "Doj" / "Dhs").
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

describe('Agency casing — dotted acronyms preserved', () => {
  it('"U.S." is NOT lowercased to "U.s." (the reported bug)', () => {
    expect(shortAgencyName('U.S. National Science Foundation')).toBe('U.S. National Science Foundation');
    expect(shortAgencyName('U.S. NATIONAL SCIENCE FOUNDATION')).toBe('U.S. National Science Foundation');
    expect(shortAgencyName('U.S. ARMY CORPS OF ENGINEERS')).toBe('U.S. Army Corps Of Engineers');
  });

  it('normal words still title-case (no over-preservation)', () => {
    expect(shortAgencyName('DEPARTMENT OF THE NAVY')).toBe('Navy');
    expect(shortAgencyName('GENERAL SERVICES ADMINISTRATION')).toBe('General Services Administration');
  });

  it('forecast DOJ/DHS match Open/Recompete short names (not Doj/Dhs)', () => {
    expect(shortAgencyName('DOJ')).toBe('Justice');
    expect(shortAgencyName('DHS')).toBe('Homeland Security');
    expect(shortAgencyName('DEPARTMENT OF JUSTICE')).toBe('Justice');
    expect(shortAgencyName('DEPARTMENT OF HOMELAND SECURITY')).toBe('Homeland Security');
  });

  it('BOTH the server cleanAgency AND the client clean() carry the dotted-acronym guard', () => {
    // the guard appears twice — once in cleanAgency / shortAgencyName (real regex `[A-Z]\.`) and once
    // in the client clean() inside a template literal (escaped `[A-Z]\\.`). Count both forms.
    const server = (route.match(/\(\?:\[A-Z\]\\\.\)\{2,\}/g) || []).length;   // [A-Z]\.
    const client = (route.match(/\(\?:\[A-Z\]\\\\\.\)\{2,\}/g) || []).length; // [A-Z]\\.
    expect(server + client).toBeGreaterThanOrEqual(1);
    expect(client).toBeGreaterThanOrEqual(1);
  });

  it('client clean() + shortAgency + pinPreview all expand DOJ/DHS', () => {
    expect(route).toContain("DOJ:'Justice'");
    expect(route).toContain("DHS:'Homeland Security'");
    expect(route).toContain("if(typeof shortAgency===\\'function\\')ag=shortAgency(ag);");
    expect(tmpl).toContain("DOJ:'Justice'");
    expect(tmpl).toContain("DHS:'Homeland Security'");
  });
});
