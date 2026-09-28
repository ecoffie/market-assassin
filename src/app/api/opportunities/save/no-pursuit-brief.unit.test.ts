/**
 * Pursuit Briefs were retired by product decision (2026-09-28).
 * Saving an opportunity — from the app (POST /api/opportunities/save) or from an
 * email link (GET /api/opportunities/save-redirect) — must never silently request
 * or email a brief, whatever the caller sends.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const save = strip(readFileSync(join(__dirname, 'route.ts'), 'utf8'));
const redirect = strip(readFileSync(join(__dirname, '../save-redirect/route.ts'), 'utf8'));

describe('saving an opportunity does not request a Pursuit Brief', () => {
  for (const [name, src] of [['save', save], ['save-redirect', redirect]] as const) {
    it(`${name} never calls the pursuit-brief endpoint`, () => {
      expect(src).not.toMatch(/\/api\/opportunities\/pursuit-brief/);
    });
    it(`${name} records pursuit_brief_requested as false`, () => {
      expect(src).toMatch(/pursuit_brief_requested:\s*false/);
      expect(src).not.toMatch(/pursuit_brief_requested:\s*(true|requestPursuitBrief)/);
    });
  }

  it('save ignores a caller-supplied requestPursuitBrief and never promises an email', () => {
    expect(save).not.toMatch(/requestPursuitBrief\s*=\s*true/);
    expect(save).not.toMatch(/will be emailed/i);
  });
});
