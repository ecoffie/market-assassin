/**
 * Guards that office labels come from the DISPLAY VIEW, not the raw table.
 *
 * dodaac_directory holds TWO names per office: office_name (historical FPDS)
 * and sam_office_name (current buyer, 1,247 rows). The dodaac_directory_display
 * view resolves which to show. If a loader silently reverts to selecting
 * office_name, every panel in the app quietly shows historical names again and
 * nothing fails — so the source of the read is asserted here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(process.cwd(), 'src/lib/gov-contacts/dodaac-directory.ts'),
  'utf8',
);

function bodyOf(fnName: string): string {
  const start = SRC.indexOf(`export async function ${fnName}`);
  expect(start, `${fnName} not found`).toBeGreaterThan(-1);
  // Up to the next top-level export, or end of file.
  const rest = SRC.slice(start + 10);
  const next = rest.indexOf('\nexport ');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('office-name loaders read the display view', () => {
  for (const fn of ['loadDodaacNames', 'loadDodaacDirectory']) {
    it(`${fn} selects from dodaac_directory_display first`, () => {
      const body = bodyOf(fn);
      expect(body).toContain('dodaac_directory_display');
      // The view must be the FIRST read; the base table only appears after it
      // as the fallback path.
      const viewIdx = body.indexOf('dodaac_directory_display');
      const tableIdx = body.indexOf(".from('dodaac_directory')");
      if (tableIdx !== -1) {
        expect(viewIdx, `${fn} reads the base table before the view`).toBeLessThan(tableIdx);
      }
    });

    it(`${fn} keeps a fallback to the base table`, () => {
      // A missing view (fresh DB, migration not run) must not blank every
      // office label — an unnamed office is worse than a stale one.
      const body = bodyOf(fn);
      expect(body).toContain(".from('dodaac_directory')");
    });

    it(`${fn} maps display_name, not office_name`, () => {
      const body = bodyOf(fn);
      expect(body).toContain('display_name');
    });
  }
});
