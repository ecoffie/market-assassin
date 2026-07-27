/**
 * The "Awarded Contracts" dataset is named "Contract Vehicles" across nav + dropdown + header
 * (Eric 2026-07-27: "Awarded Contracts is not the right name — it should be Contract Vehicles,
 * which covers the broad overview"). The corpus is IDIQs, task orders, and expiring awards up for
 * recompete — "vehicles" is the broad frame; "Awarded Contracts" read too narrow.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('recompete dataset is named "Contract Vehicles", not "Awarded Contracts"', () => {
  it('the MODES header title is "Contract Vehicles"', () => {
    expect(route).toContain("recompete:{ ep:'/api/app/recompete-map', title:'Contract Vehicles'");
  });
  it('no user-facing "Awarded Contracts" label survives (nav/dropdown/header)', () => {
    expect(route).not.toContain("title:'Awarded Contracts'");
    expect(route).not.toContain('<option value="recompete">Awarded</option>');
  });
  it('the dropdown option + top nav both read "Vehicles"', () => {
    expect(route).toContain('<option value="recompete">Vehicles</option>');
    expect(route).toContain(">Vehicles</a>");
  });
});
