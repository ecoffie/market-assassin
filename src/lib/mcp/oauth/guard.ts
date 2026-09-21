/**
 * OAuth endpoint gate. When MCP_OAUTH_ENABLED is off (default), every OAuth
 * route 404s — so the feature can land on prod exposing nothing until we flip it
 * on for the live Claude Desktop test.
 */
import { NextResponse } from 'next/server';
import { mcpFlags } from '@/lib/mcp/flags';

export function oauthGate(): NextResponse | null {
  return mcpFlags.oauth ? null : new NextResponse('Not found', { status: 404 });
}
