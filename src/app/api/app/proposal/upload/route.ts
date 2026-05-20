import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

type ExtractResult = {
  text: string;
  pageCount?: number;
};

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text || '', pageCount: result.total };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value || '' };
}

function inferKind(name: string, mime: string): 'pdf' | 'docx' | 'txt' | null {
  const lower = name.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (mime === 'text/plain' || lower.endsWith('.txt')) return 'txt';
  return null;
}

export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Expected multipart/form-data with a "file" field' },
      { status: 400 }
    );
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ success: false, error: 'No file uploaded under "file" field' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { success: false, error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
      { status: 413 }
    );
  }

  const kind = inferKind(file.name, file.type);
  if (!kind) {
    return NextResponse.json(
      { success: false, error: 'Unsupported file type. Upload PDF, DOCX, or TXT.' },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let extract: ExtractResult;
    if (kind === 'pdf') extract = await extractPdf(buffer);
    else if (kind === 'docx') extract = await extractDocx(buffer);
    else extract = { text: buffer.toString('utf-8') };

    const text = (extract.text || '').trim();
    return NextResponse.json({
      success: true,
      file: {
        name: file.name,
        size: file.size,
        type: file.type || kind,
      },
      text,
      charCount: text.length,
      pageCount: extract.pageCount,
    });
  } catch (err) {
    console.error('[proposal/upload] parse failed:', err);
    return NextResponse.json(
      { success: false, error: 'Could not extract text from the file. Try a different export.' },
      { status: 500 }
    );
  }
}
