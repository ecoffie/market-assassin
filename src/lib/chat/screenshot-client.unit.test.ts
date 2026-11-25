/**
 * The browser half of the screenshot contract: every image is redrawn on a canvas (≤ 1568 px longest edge)
 * and re-encoded, so source-file metadata (EXIF, GPS, camera) can never be sent; type, count and size are
 * checked before upload; and the wire field is exactly {media_type, data}.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  fitWithin, prepareScreenshot, screenshotsField, screenshotMarker, imageFilesFrom, screenshotRefusalNote, SCREENSHOT_MESSAGES, screenshotsFit, SCREENSHOT_TARGET_BYTES, SCREENSHOT_TOTAL_B64,
  SCREENSHOT_MAX_BYTES, type PrepareDeps, type PreparedScreenshot,
} from './screenshot-client';

function deps(opts: { w?: number; h?: number; sizes?: Record<string, number>; decodeFails?: boolean } = {}) {
  const drawn: number[][] = [];
  const encoded: string[] = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (_s: unknown, x: number, y: number, w: number, h: number) => drawn.push([x, y, w, h]) }),
  } as unknown as HTMLCanvasElement;
  const d: PrepareDeps = {
    decode: async () => { if (opts.decodeFails) throw new Error('bad'); return { width: opts.w ?? 800, height: opts.h ?? 600, source: {} as CanvasImageSource, close: vi.fn() }; },
    makeCanvas: () => canvas,
    encode: async (_c, type) => {
      encoded.push(type);
      const n = opts.sizes?.[type] ?? 10;
      // The encoded blob is canvas output only — a fixed marker, never the source file's bytes.
      return new Blob([new Uint8Array(n).fill(65)], { type });
    },
    previewUrl: () => 'blob:local/x',
  };
  return { d, drawn, encoded, canvas };
}
const file = (type: string, bytes: number[] = [1, 2, 3]) => new File([new Uint8Array(bytes)], 'f', { type });

describe('screenshot-client', () => {
  it('fitWithin keeps the longest edge ≤ 1568 and never upscales', () => {
    expect(fitWithin(3136, 1000)).toEqual({ w: 1568, h: 500 });
    expect(fitWithin(1000, 4704)).toEqual({ w: 333, h: 1568 });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });

  it('redraws on a canvas at the downscaled size and sends only the re-encoded bytes', async () => {
    const { d, drawn, canvas } = deps({ w: 3000, h: 2000 });
    // A JPEG whose bytes carry an EXIF block: none of it may reach the payload.
    const exif = [0xff, 0xd8, 0xff, 0xe1, ...Array.from('Exif\0\0GPS-SECRET').map((c) => c.charCodeAt(0))];
    const r = await prepareScreenshot(file('image/jpeg', exif), d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([canvas.width, canvas.height]).toEqual([1568, 1045]);
    expect(drawn[0]).toEqual([0, 0, 1568, 1045]);
    expect(r.shot.media_type).toBe('image/jpeg');
    expect(atob(r.shot.data)).toBe('A'.repeat(10));
    expect(atob(r.shot.data)).not.toContain('GPS-SECRET');
  });

  it('PNG stays PNG; a PNG still over the limit falls back to JPEG', async () => {
    const a = deps();
    const r1 = await prepareScreenshot(file('image/png'), a.d);
    expect(r1.ok && r1.shot.media_type).toBe('image/png');
    const b = deps({ sizes: { 'image/png': SCREENSHOT_MAX_BYTES + 1, 'image/jpeg': 50 } });
    const r2 = await prepareScreenshot(file('image/png'), b.d);
    expect(b.encoded).toEqual(['image/png', 'image/jpeg']);
    expect(r2.ok && r2.shot.media_type).toBe('image/jpeg');
  });

  it('refuses: unsupported type, unreadable image, still too large', async () => {
    expect(await prepareScreenshot(file('image/gif'), deps().d)).toEqual({ ok: false, reason: 'type' });
    expect(await prepareScreenshot(file('image/png'), deps({ decodeFails: true }).d)).toEqual({ ok: false, reason: 'unreadable' });
    const big = deps({ sizes: { 'image/jpeg': SCREENSHOT_MAX_BYTES + 1 } });
    expect(await prepareScreenshot(file('image/webp'), big.d)).toEqual({ ok: false, reason: 'size' });
  });

  it('the wire field is exactly {media_type, data}, at most 3, absent when empty', () => {
    const s = (i: number): PreparedScreenshot => ({ id: `s${i}`, media_type: 'image/png', data: `D${i}`, previewUrl: 'blob:x', bytes: 1 });
    expect(screenshotsField([])).toEqual({});
    const f = screenshotsField([s(1), s(2), s(3), s(4)]);
    expect(f.images).toEqual([1, 2, 3].map((i) => ({ media_type: 'image/png', data: `D${i}` })));
  });

  it('marker text and file picking', () => {
    expect(screenshotMarker(1)).toBe('[screenshot attached]');
    expect(screenshotMarker(2)).toBe('[2 screenshots attached]');
    const dt = { items: [
      { kind: 'file', getAsFile: () => file('image/png') },
      { kind: 'file', getAsFile: () => file('image/gif') },
      { kind: 'string', getAsFile: () => null },
    ] } as unknown as DataTransfer;
    const r = imageFilesFrom(dt);
    expect(r.files.map((f) => f.type)).toEqual(['image/png']);
    expect(r.rejectedType).toBe(true);
  });

  it('refusal note: the server message when it is a short string, ours otherwise', () => {
    expect(screenshotRefusalNote({ error: 'image_too_large', message: '  That screenshot is   too large. ' })).toBe('That screenshot is too large.');
    expect(screenshotRefusalNote(null)).toBe(SCREENSHOT_MESSAGES.server);
    expect(screenshotRefusalNote({ message: 42 })).toBe(SCREENSHOT_MESSAGES.server);
    expect(screenshotRefusalNote({ message: 'x'.repeat(301) })).toBe(SCREENSHOT_MESSAGES.server);
  });

  it('steps JPEG quality down, then the edge, until an image fits the per-image target', async () => {
    const qs: Array<[string, number | undefined, number]> = [];
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) } as unknown as HTMLCanvasElement;
    const d: PrepareDeps = {
      decode: async () => ({ width: 3000, height: 2000, source: {} as CanvasImageSource }),
      makeCanvas: () => canvas,
      previewUrl: () => 'blob:x',
      encode: async (c, type, q) => {
        qs.push([type, q, c.width]);
        // Only JPEG 0.62 at the 1280 edge fits.
        const fits = type === 'image/jpeg' && q === 0.62 && c.width === 1280;
        return new Blob([new Uint8Array(fits ? 100 : SCREENSHOT_TARGET_BYTES + 1)], { type });
      },
    };
    const r = await prepareScreenshot(new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }), d);
    expect(r.ok && r.shot.media_type).toBe('image/jpeg');
    expect(qs.slice(0, 5)).toEqual([['image/png', undefined, 1568], ['image/jpeg', 0.82, 1568], ['image/jpeg', 0.72, 1568], ['image/jpeg', 0.62, 1568], ['image/jpeg', 0.52, 1568]]);
    expect(qs[qs.length - 1]).toEqual(['image/jpeg', 0.62, 1280]);
  });

  it('three images at the per-image target fit the route total; more than the total does not', () => {
    const b64PerImage = Math.ceil(SCREENSHOT_TARGET_BYTES / 3) * 4;
    expect(3 * b64PerImage).toBeLessThanOrEqual(SCREENSHOT_TOTAL_B64);
    expect(SCREENSHOT_TOTAL_B64).toBeLessThan(4 * 1024 * 1024); // under the route's ~4 MB cap (Vercel ~4.5 MB body)
    expect(screenshotsFit([{ data: 'x'.repeat(b64PerImage) }, { data: 'x'.repeat(b64PerImage) }, { data: 'x'.repeat(b64PerImage) }])).toBe(true);
    expect(screenshotsFit([{ data: 'x'.repeat(SCREENSHOT_TOTAL_B64 + 1) }])).toBe(false);
  });
});
