/**
 * Admin: Direct Vercel KV Inspector
 *
 * GET  /api/admin/kv?password=...&action=get&key=ma:user@example.com
 * GET  /api/admin/kv?password=...&action=keys&pattern=ma:*
 * GET  /api/admin/kv?password=...&action=set&key=briefings:user@example.com&value=true
 * GET  /api/admin/kv?password=...&action=del&key=briefings:user@example.com
 * GET  /api/admin/kv?password=...&action=scan&pattern=briefings:*  (list all matching keys with values)
 *
 * Replaces the need for a KV MCP server — direct browser access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const action = searchParams.get('action');
  const key = searchParams.get('key');
  const pattern = searchParams.get('pattern');
  const value = searchParams.get('value');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!action) {
    return NextResponse.json({
      usage: {
        get: '?action=get&key=ma:user@example.com',
        set: '?action=set&key=ma:user@example.com&value=true',
        del: '?action=del&key=ma:user@example.com',
        keys: '?action=keys&pattern=ma:*',
        scan: '?action=scan&pattern=briefings:* (keys + values)',
      },
    });
  }

  try {
    switch (action) {
      case 'get': {
        if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
        const val = await kv.get(key);
        return NextResponse.json({ key, value: val, exists: val !== null });
      }

      case 'set': {
        if (!key || !value) return NextResponse.json({ error: 'key and value required' }, { status: 400 });
        await kv.set(key, value);
        return NextResponse.json({ success: true, key, value });
      }

      case 'del': {
        if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
        const deleted = await kv.del(key);
        return NextResponse.json({ success: true, key, deleted: deleted > 0 });
      }

      case 'keys': {
        if (!pattern) return NextResponse.json({ error: 'pattern required (e.g., ma:*)' }, { status: 400 });
        const keys = await kv.keys(pattern);
        return NextResponse.json({ pattern, count: keys.length, keys });
      }

      case 'scan': {
        if (!pattern) return NextResponse.json({ error: 'pattern required (e.g., briefings:*)' }, { status: 400 });
        const matchedKeys = await kv.keys(pattern);
        const results: Record<string, unknown> = {};
        for (const k of matchedKeys.slice(0, 100)) {
          results[k as string] = await kv.get(k as string);
        }
        return NextResponse.json({
          pattern,
          count: matchedKeys.length,
          results,
          truncated: matchedKeys.length > 100,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
