import { describe, it, expect } from 'vitest';
import { INTER_LATIN_400_WOFF2_BASE64, INTER_LATIN_600_WOFF2_BASE64, INTER_LATIN_800_WOFF2_BASE64, INTER_LATIN_FONT_FACE } from './inter-latin-embedded';

describe('embedded Inter latin subset (report PDF font)', () => {
  it('holds three real woff2 files', () => {
    for (const b64 of [INTER_LATIN_400_WOFF2_BASE64, INTER_LATIN_600_WOFF2_BASE64, INTER_LATIN_800_WOFF2_BASE64]) {
      const buf = Buffer.from(b64, 'base64');
      expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
      expect(buf.length).toBeGreaterThan(10_000);
    }
  });

  it('stays under the ~100 KB page-weight budget and declares exactly the 400, 600 and 800 faces', () => {
    expect(INTER_LATIN_FONT_FACE.length).toBeLessThan(100 * 1024);
    expect(INTER_LATIN_FONT_FACE.match(/@font-face/g)).toHaveLength(3);
    expect(INTER_LATIN_FONT_FACE).toContain("font-weight:400");
    expect(INTER_LATIN_FONT_FACE).toContain("font-weight:600");
    expect(INTER_LATIN_FONT_FACE).toContain("font-weight:800");
    expect(INTER_LATIN_FONT_FACE).not.toMatch(/font-weight:\d+ \d+/); // static faces, never a variable range
  });
});
