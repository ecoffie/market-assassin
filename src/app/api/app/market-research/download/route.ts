import { readFileSync } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { WORKSPACE_PROTOTYPE_BANNER } from '@/lib/mrr/run-phase1';
import {
  getMrrArtifact,
  type MrrArtifactKind,
} from '@/lib/mrr/run-store';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPE: Record<MrrArtifactKind, string> = {
  mrr: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  appendix: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  evidence: 'application/json; charset=utf-8',
};

function artifactKind(value: string | null): MrrArtifactKind | null {
  return value === 'mrr' || value === 'appendix' || value === 'evidence' ? value : null;
}

export async function GET(request: NextRequest) {
  const auth = requireMIAuthSession(request);
  if (!auth.ok) return auth.response;

  const id = request.nextUrl.searchParams.get('id')?.trim();
  const kind = artifactKind(request.nextUrl.searchParams.get('kind'));
  if (!id || !kind) {
    return NextResponse.json(
      {
        success: false,
        error: 'run id and kind (mrr, appendix, or evidence) are required',
        prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
      },
      { status: 400 },
    );
  }

  const artifact = getMrrArtifact(id, auth.session.email!, kind);
  if (!artifact) {
    return NextResponse.json(
      {
        success: false,
        error: 'Artifact not found or run is incomplete',
        prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
      },
      { status: 404 },
    );
  }

  try {
    const bytes = readFileSync(artifact.path);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPE[kind],
        'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-MRR-Run-Id': id,
        'X-MRR-Intake-Hash': artifact.intakeHash,
        'X-MRR-Artifact-Sha256': artifact.sha256,
      },
    });
  } catch (error) {
    console.error('[mrr-workspace] Artifact read failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Artifact is unavailable.',
        prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
      },
      { status: 500 },
    );
  }
}
