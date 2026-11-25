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
export const SCREENSHOT_LONG_EDGE = 1568;
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ScreenshotMediaType = (typeof SCREENSHOT_TYPES)[number];

/** Exactly what goes on the wire. */
export type ScreenshotPayload = { media_type: ScreenshotMediaType; data: string };
/** What the composer holds until Send: the payload plus a local preview url (revoke on remove/send). */
export type PreparedScreenshot = ScreenshotPayload & { id: string; previewUrl: string; bytes: number };

export type ScreenshotRefusal = 'type' | 'count' | 'size' | 'unreadable';

/** Plain-English messages — never a code, a byte count or a MIME type. */
export const SCREENSHOT_MESSAGES: Record<ScreenshotRefusal | 'server', string> = {
  type: 'Mindy can read PNG, JPEG or WebP screenshots. That file isn’t one.',
  count: 'You can attach up to 3 screenshots to one message.',
  size: 'That screenshot is too large to send. Try a smaller capture.',
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
 * Decode → redraw (≤ 1568 px) → re-encode. PNG stays PNG (screenshots are text; JPEG blurs it) unless it is
 * still over the size limit, then JPEG 0.85. A canvas encode never carries the source file's metadata.
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
    const { w, h } = fitWithin(img.width, img.height);
    const canvas = makeCanvas();
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'unreadable' };
    ctx.drawImage(img.source, 0, 0, w, h);

    const firstType: ScreenshotMediaType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    let type: ScreenshotMediaType = firstType;
    let blob = await encode(canvas, type, type === 'image/jpeg' ? 0.9 : undefined);
    if (blob && blob.size > SCREENSHOT_MAX_BYTES && type === 'image/png') {
      type = 'image/jpeg';
      blob = await encode(canvas, type, 0.85);
    }
    if (!blob) return { ok: false, reason: 'unreadable' };
    if (blob.size > SCREENSHOT_MAX_BYTES) return { ok: false, reason: 'size' };
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

/** What the transcript shows for the customer's turn (no bytes; mirrors the server's stored marker). */
export function screenshotMarker(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '[screenshot attached]' : `[${count} screenshots attached]`;
}

/** Sent when the customer pastes a screenshot and presses Send without typing. */
export const SCREENSHOT_DEFAULT_PROMPT = 'Who or what is in this screenshot? Research it for me.';
