/**
 * POST /api/app/voice/transcribe — voice capture step 1 (#119)
 *
 * Takes a multipart audio blob from the browser's MediaRecorder,
 * forwards it to OpenAI Whisper-1, returns the plain-text transcript.
 *
 * v1 design choices:
 * - OpenAI Whisper (already paid + working from podcast batch). Groq
 *   Free's 12K TPM cap would force chunking; this is dead-simple.
 * - 25 MB upload cap on OpenAI matches typical voice clip sizes
 *   (~500 KB for a 30-second clip), so no downsample logic needed.
 * - Body shape is multipart/form-data with one `audio` field — same
 *   pattern as the OpenAI SDK uses internally.
 * - Step 2 (LLM extraction) is a separate endpoint so the UI can
 *   show "Transcribing… → Extracting…" as distinct stages.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024;            // OpenAI Whisper upload cap
const MAX_DURATION_SECONDS = 120;              // 2 min hard cap — v1 is for quick captures
const WHISPER_MODEL = 'whisper-1';

export async function POST(request: NextRequest) {
  // Auth via email field on the multipart form (since requireUserAuth
  // clones+json-parses by default; multipart bodies need a slightly
  // different read path)
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const email = String(formData.get('email') || '').toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  // multipart bodies can't be cloned + re-parsed by the auth helper's
  // default body-reader, so call verifyUserOwnsEmail directly with the
  // email we've already extracted from formData. Auth still validates
  // session token, MI 2FA token, signed query token, etc.
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const audio = formData.get('audio');
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: 'audio file required' }, { status: 400 });
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: 'audio is empty' }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `audio too large (${Math.round(audio.size / 1024 / 1024)}MB > 25MB)` },
      { status: 413 },
    );
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: 'Server misconfigured: OPENAI_API_KEY missing' }, { status: 500 });
  }

  // Whisper wants a `file` field with an explicit filename + extension.
  // Browsers give us `audio/webm` or `audio/mp4` depending on platform;
  // both are accepted by Whisper. We pass through whatever MIME the
  // recorder produced.
  const inferredExt = inferExt(audio.type);
  const filename = `capture-${Date.now()}.${inferredExt}`;
  const file = new File([audio], filename, { type: audio.type || 'audio/webm' });

  const upload = new FormData();
  upload.append('file', file);
  upload.append('model', WHISPER_MODEL);
  upload.append('response_format', 'text');
  // Light hint to help with federal-contracting jargon recognition.
  upload.append('prompt', 'Federal contracting interview. Possible terms: GSA, NAVFAC, SAM, NAICS, 8(a), HUBZone, sources sought, IDIQ, RFP, contracting officer.');

  const startedAt = Date.now();
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: upload,
  });
  const transcribeMs = Date.now() - startedAt;

  if (!res.ok) {
    const errText = await res.text().catch(() => '(no body)');
    console.error('[voice/transcribe] OpenAI', res.status, errText.slice(0, 300));
    return NextResponse.json(
      { error: `Transcription failed (${res.status})`, detail: errText.slice(0, 200) },
      { status: 502 },
    );
  }

  const transcript = (await res.text()).trim();
  if (!transcript || transcript.length < 3) {
    return NextResponse.json(
      { error: "Couldn't hear anything — try again, closer to the mic." },
      { status: 422 },
    );
  }

  return NextResponse.json({
    success: true,
    transcript,
    transcribeMs,
    audioSizeBytes: audio.size,
  });
}

function inferExt(mimeType: string): string {
  if (!mimeType) return 'webm';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('m4a')) return 'm4a';
  return 'webm';
}

// MAX_DURATION_SECONDS is enforced client-side. Surfacing it here so
// the constant lives next to the OpenAI cost knob — Whisper bills per
// minute, so cap is also our cost ceiling per request.
void MAX_DURATION_SECONDS;
