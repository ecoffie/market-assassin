/**
 * Shared PDF/DOCX text extractor.
 *
 * pdf-parse 2.x internally uses Mozilla's pdf.js which assumes a
 * browser-ish environment with DOMMatrix / ImageData / Path2D
 * available. Node provides none of these by default. In a foreground
 * Vercel request the runtime sometimes has time to load enough
 * polyfills via the React server bundler, but in background contexts
 * (fire-and-forget after a parent route returns) the lambda starts
 * tearing down before pdf.js finishes initializing and we get the
 * dreaded 'DOMMatrix is not defined' error mid-parse.
 *
 * Fix: install minimal polyfills on the global scope BEFORE pdf-parse
 * loads. Pure shim — we don't actually need full DOM behavior, we just
 * need the symbols to exist so the pdf.js feature-detection branches
 * don't throw during module init.
 *
 * Belt-and-suspenders. The real root cause is lambda lifecycle (handled
 * via ctx.waitUntil() in the calling route), but the polyfill makes
 * extraction robust even if the lambda is under memory/time pressure.
 *
 * Built 2026-05-26 after the fetchPursuitDocs pipeline downloaded
 * Shadehill's PDF to Supabase Storage but failed to extract text
 * with 'DOMMatrix is not defined'.
 */

// --- Polyfills (must run BEFORE pdf-parse import) ----------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

if (typeof g.DOMMatrix === 'undefined') {
  // Minimal no-op class with the property surface pdf.js touches.
  // pdf.js uses DOMMatrix for transform math during text layer build;
  // returning identity matrices is fine for text-only extraction.
  g.DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_init?: any) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    multiply(_other: any) { return this; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translate(_x: number, _y: number) { return this; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scale(_x: number, _y?: number) { return this; }
    inverse() { return this; }
    toString() { return 'matrix(1, 0, 0, 1, 0, 0)'; }
  };
}

if (typeof g.ImageData === 'undefined') {
  g.ImageData = class ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}

if (typeof g.Path2D === 'undefined') {
  g.Path2D = class Path2D {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_init?: any) {}
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
    roundRect() {}
  };
}

// --- Extractors --------------------------------------------------
// (Polyfills must be installed above before pdf-parse imports.)

export interface ExtractResult {
  text: string;
  pageCount?: number;
}

export async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text || '', pageCount: result.total };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value || '' };
}

export function extractTxt(buffer: Buffer): ExtractResult {
  return { text: buffer.toString('utf-8') };
}
