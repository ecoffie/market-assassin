/**
 * The map's emitted scripts can't import TS, so the "(+N more)" PIID stripper and the recompete
 * pursuit source are written inline in two route files. This pins both to the shared definition in
 * src/lib/recompete/pursuit-key.ts, so the pursuit key cannot drift between the map's "Track this
 * recompete", the map's Saved page and the app's "Saved on the map" tab.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PIID_ROLLUP_SUFFIX_SOURCE, RECOMPETE_PURSUIT_SOURCE } from '@/lib/recompete/pursuit-key';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8').replace(/\\\\/g, '\\');

describe('recompete pursuit key parity', () => {
  for (const file of ['route.ts', 'favorites/route.ts']) {
    it(`${file} uses the shared PIID suffix regex and source`, () => {
      const src = read(file);
      expect(src).toContain(`/${PIID_ROLLUP_SUFFIX_SOURCE}/i`);
      expect(src).toContain(`'${RECOMPETE_PURSUIT_SOURCE}'`);
    });
  }
});
