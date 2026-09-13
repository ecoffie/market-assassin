import { NextRequest } from 'next/server';
import { handleOAuthCallbackRequest } from '@/lib/mindy/oauth-callback-handler';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleOAuthCallbackRequest(request);
}
