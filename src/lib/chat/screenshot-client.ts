/**
 * Pasted screenshots in Ask Mindy — the browser half of the turn-scoped image contract
 * (Agent 1 + Agent 4, 2026-11-25):
 *
 *   images: [{ media_type: 'image/png' | 'image/jpeg' | 'image/webp', data: <base64, no data: prefix> }]
 *   at most 3 per turn, each ≤ 3.5 MB decoded; sent with ONE turn and never stored.
 *
 * Every image is decoded and redrawn on a canvas (longest edge ≤ 1568 px) and re-encoded, so camera/EXIF
 * metadata never leaves the browser and oversized captures shrink before upload. The server re-validates
 * type (magic bytes) and size; this file only keeps the customer from waiting on a request that would fail.
 * Screenshot content is customer input, never instructions — nothing here interprets it.
 */

export const SCREENSHOT_MAX_COUNT = 3;
export const SCREENSHOT_MAX_BYTES = 3.5 * 1024 * 1024;
/**
 * Vercel caps a request body at ~4.5 MB and the chat route caps the images' base64 at ~4 MB in total (Agent 4 /
 * Agent 1, 2026-11-25). So each image aims for ≤ 900 KB (1.2 MB of base64): three typical screenshots stay well under
 * the total, and the send-time check below refuses plainly if they still would not.
 */
export const SCREENSHOT_TARGET_BYTES = 900 * 1024;
export const SCREENSHOT_TOTAL_B64 = 3_800_000;
/** Tried in order until one fits the target: PNG (sharp text) for a PNG source, then JPEG at falling quality. */
const SHOT_QUALITIES = [0.82, 0.72, 0.62, 0.52];
export const SCREENSHOT_LONG_EDGE = 1568;
const SHOT_EDGES = [SCREENSHOT_LONG_EDGE, 1280, 1024];
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ScreenshotMediaType = (typeof SCREENSHOT_TYPES)[number];

/** Exactly what goes on the wire. */
export type ScreenshotPayload = { media_type: ScreenshotMediaType; data: string };
/** What the composer holds until Send: the payload plus a local preview url (revoke on remove/send). */
export type PreparedScreenshot = ScreenshotPayload & { id: string; previewUrl: string; bytes: number };

export type ScreenshotRefusal = 'type' | 'count' | 'size' | 'unreadable';

/** Plain-English messages — never a code, a byte count or a MIME type. */
export const SCREENSHOT_MESSAGES: Record<ScreenshotRefusal | 'server' | 'total', string> = {
  type: 'Mindy can read PNG, JPEG or WebP screenshots. That file isn’t one.',
  count: 'You can attach up to 3 screenshots to one message.',
  size: 'That screenshot is too large to send. Try a smaller capture.',
  total: 'These screenshots are too large to send together. Remove one, or try smaller captures.',
  unreadable: 'Mindy couldn’t open that image. Try taking the screenshot again.',
  server: 'Mindy couldn’t read that screenshot. Your message is still here — remove the screenshot or try another one.',
};

export function isScreenshotType(t: string): t is ScreenshotMediaType {
  return (SCREENSHOT_TYPES as readonly string[]).includes(t);
}

/** Image files from a paste or drop (non-images ignored; a pasted file with an unsupported type is reported). */
export function imageFilesFrom(list: DataTransfer | null | undefined): { files: File[]; rejectedType: boolean } {
  const files: File[] = [];
  let rejectedType = false;
  if (!list) return { files, rejectedType };
  const items = list.items ? Array.from(list.items) : [];
  const raw: File[] = items.length
    ? items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f)
    : Array.from(list.files || []);
  for (const f of raw) {
    if (isScreenshotType(f.type)) files.push(f);
    else if (f.type.startsWith('image/') || raw.length === 1) rejectedType = true;
  }
  return { files, rejectedType };
}

/** Target size: longest edge ≤ SCREENSHOT_LONG_EDGE, never upscaled. */
export function fitWithin(w: number, h: number, edge = SCREENSHOT_LONG_EDGE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (!long || long <= edge) return { w, h };
  const s = edge / long;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

function base64FromBytes(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

type Encoder = (canvas: HTMLCanvasElement, type: string, quality?: number) => Promise<Blob | null>;
const defaultEncoder: Encoder = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));

export type PrepareDeps = {
  decode?: (file: File) => Promise<{ width: number; height: number; source: CanvasImageSource; close?: () => void }>;
  encode?: Encoder;
  makeCanvas?: () => HTMLCanvasElement;
  previewUrl?: (b: Blob) => string;
};

/**
 * Decode → redraw (≤ 1568 px) → re-encode until it fits SCREENSHOT_TARGET_BYTES: PNG first for a PNG source
 * (screenshots are text; JPEG blurs it), then JPEG at 0.82 → 0.52, then a smaller edge (1280, 1024). A canvas encode
 * never carries the source file's metadata.
 */
export async function prepareScreenshot(file: File, deps: PrepareDeps = {}): Promise<{ ok: true; shot: PreparedScreenshot } | { ok: false; reason: ScreenshotRefusal }> {
  if (!isScreenshotType(file.type)) return { ok: false, reason: 'type' };
  const decode = deps.decode ?? (async (f: File) => {
    const bmp = await createImageBitmap(f);
    return { width: bmp.width, height: bmp.height, source: bmp, close: () => bmp.close() };
  });
  const encode = deps.encode ?? defaultEncoder;
  const makeCanvas = deps.makeCanvas ?? (() => document.createElement('canvas'));
  const previewUrl = deps.previewUrl ?? ((b: Blob) => URL.createObjectURL(b));

  let img;
  try { img = await decode(file); } catch { return { ok: false, reason: 'unreadable' }; }
  try {
    if (!img.width || !img.height) return { ok: false, reason: 'unreadable' };
    const canvas = makeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'unreadable' };
    let blob: Blob | null = null;
    let type: ScreenshotMediaType = 'image/jpeg';
    let encodedAny = false;
    search: for (const edge of SHOT_EDGES) {
      const { w, h } = fitWithin(img.width, img.height, edge);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img.source, 0, 0, w, h);
      const tries: Array<[ScreenshotMediaType, number | undefined]> = [
        ...(file.type === 'image/png' ? [['image/png', undefined] as [ScreenshotMediaType, undefined]] : []),
        ...SHOT_QUALITIES.map((q) => ['image/jpeg', q] as [ScreenshotMediaType, number]),
      ];
      for (const [t, q] of tries) {
        const b = await encode(canvas, t, q);
        if (!b) continue;
        encodedAny = true;
        if (b.size <= SCREENSHOT_TARGET_BYTES) { blob = b; type = t; break search; }
      }
      if (Math.max(img.width, img.height) <= edge) break; // a smaller edge would not shrink it further
    }
    if (!blob) return { ok: false, reason: encodedAny ? 'size' : 'unreadable' };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      ok: true,
      shot: {
        id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        media_type: type,
        data: base64FromBytes(bytes),
        previewUrl: previewUrl(blob),
        bytes: blob.size,
      },
    };
  } finally {
    img.close?.();
  }
}

/** The wire field — only {media_type, data}; the preview url and ids never leave the browser. */
export function screenshotsField(shots: PreparedScreenshot[]): { images?: ScreenshotPayload[] } {
  if (!shots.length) return {};
  return { images: shots.slice(0, SCREENSHOT_MAX_COUNT).map((s) => ({ media_type: s.media_type, data: s.data })) };
}

/** The send-time total check: all images' base64 together must fit the route's budget. */
export function screenshotsFit(shots: Array<{ data: string }>): boolean {
  return shots.reduce((n, s) => n + s.data.length, 0) <= SCREENSHOT_TOTAL_B64;
}

/** What the transcript shows for the customer's turn (no bytes; mirrors the server's stored marker). */
export function screenshotMarker(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '[screenshot attached]' : `[${count} screenshots attached]`;
}

/**
 * The note shown when the server refuses a screenshot (400 images_invalid · 413 image_too_large · 415 image_type, as
 * JSON {error, message} before any stream). The server's message is customer-safe by contract (Agent 1, RM-4); it is
 * shown as plain text, bounded, and our own wording is used if it is missing or not a short string.
 */
export function screenshotRefusalNote(body: unknown): string {
  const m = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
  const text = typeof m === 'string' ? m.replace(/\s+/g, ' ').trim() : '';
  return text && text.length <= 300 ? text : SCREENSHOT_MESSAGES.server;
}

/** Sent when the customer pastes a screenshot and presses Send without typing. */
export const SCREENSHOT_DEFAULT_PROMPT = 'Who or what is in this screenshot? Research it for me.';
