/**
 * The three PRD reproductions, as behavioural tests against the DEPLOYED MCP.
 *
 * RED-FIRST: these are expected to FAIL against current production. That failure is the
 * point — it proves the harness can detect the defects the old source-text tests could not.
 * Do not "fix" a test to make it pass. Fix the product until the SAME test goes red → green.
 *
 * No mocks. This layer IS the PRD's "confirmed live signal".
 *
 *   npm run test:chain:live
 *
 * Skips (does not fail) when MCP_LIVE_URL is unset, so PR CI stays deterministic.
 */
import { describe, it, expect } from 'vitest';

const LIVE = process.env.MCP_LIVE_URL;
const d = LIVE ? describe : describe.skip;

/** Minimal MCP JSON-RPC tool call. No product imports — this must exercise the real wire. */
async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(LIVE!, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.MCP_LIVE_TOKEN ? { authorization: `Bearer ${process.env.MCP_LIVE_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call', params: { name, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${name}: ${json.error.message}`);
  const text = json.result?.content?.[0]?.text;
  return typeof text === 'string' ? JSON.parse(text) : json.result;
}

d('PRD reproductions — live', () => {
  // ── P0-1 ────────────────────────────────────────────────────────────────────
  // Observed 2026-08-23: lead keyword "small" → NAICS 332993 Ammunition Mfg,
  // vocabulary "small diameter bomb"/"JDAM", competitors SMALL DOG ELECTRONICS.
  // Removing "small" landed on 333244 Printing Machinery via "made-to-print".
  it('P0-1 · a machine shop resolves to 332710, not munitions or printing', async () => {
    const r = await callTool('capability_market_match', {
      description:
        'We are a small machine shop. We do precision CNC machining, turning, milling, and ' +
        'fabrication of metal parts to customer drawings. Family owned, about 12 employees, one facility.',
      capabilities: ['CNC machining', 'precision turning and milling', 'metal fabrication', 'made-to-print parts'],
    });

    const codes: string[] = (r?.market?.top_naics ?? []).map((n: any) => String(n.code));
    expect(codes, 'machine shop market must contain 332710 Machine Shops').toContain('332710');

    // A single generic token must never anchor the market.
    expect(String(r?.market?.lead_keyword ?? '').trim().toLowerCase())
      .not.toBe('small');

    // Sector sanity: the anchor must not be a different 2-digit sector than the capability.
    expect(['332993', '333244'], 'known wrong anchors from the 2026-08-23 repro')
      .not.toContain(String(r?._meta?.lead_naics ?? ''));
  });

  // ── P0-2 ────────────────────────────────────────────────────────────────────
  // Observed: found:true with uei + $58.1M + 1278 awards, but both arrays empty.
  it('P0-2 · a contractor with awards returns agencies and awards', async () => {
    const profile = await callTool('get_contractor_profile', { company_name: 'FLUIDYNE CORPORATION' });
    expect(profile?.found, 'Fluidyne must resolve').toBe(true);
    expect(profile?.company?.award_count, 'index reports awards').toBeGreaterThan(0);

    // The invariant: a populated header may not sit on empty bodies.
    expect(profile?.top_agencies?.length, 'award_count > 0 ⇒ top_agencies must not be empty')
      .toBeGreaterThan(0);
    expect(profile?.recent_awards?.length, 'award_count > 0 ⇒ recent_awards must not be empty')
      .toBeGreaterThan(0);
  });

  // ── P0-3 ────────────────────────────────────────────────────────────────────
  // Observed: capable_depth 0 where TLS JV, Dynamic-HHS JV and Titan hold ~$63M.
  it('P0-3 · Rule of Two does not report zero where performers exist', async () => {
    const depth = await callTool('assess_market_depth', {
      naics: '561720', set_aside: 'Small Business',
    });
    // Reconcile against the authoritative population, not a hardcoded fixture.
    const awards = await callTool('search_past_contracts', {
      naics: '561720', limit: 50, date_from: '2024-10-01', date_to: '2025-09-30',
    });
    const performers = new Set(
      (awards?.awards ?? awards?.results ?? [])
        .map((a: any) => a['Recipient Name'] ?? a.recipient_name).filter(Boolean),
    );
    if (performers.size >= 2) {
      expect(depth?._meta?.capable_depth,
        `award data shows ${performers.size} performers — depth cannot be 0`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  // ── P1-1 ────────────────────────────────────────────────────────────────────
  // Observed: generate_market_report emits "…TOOL &amp; DESIGN"; feeding that back → found:false.
  it('P1-1 · a name emitted by one tool resolves in the next', async () => {
    const report = await callTool('generate_market_report', { naics: '332710' });
    const names: string[] = (report?.sections?.competition?.contractors ?? [])
      .map((c: any) => c.recipient_name).filter(Boolean).slice(0, 5);
    expect(names.length, 'report must emit competitor names to round-trip').toBeGreaterThan(0);

    for (const name of names) {
      const p = await callTool('get_contractor_profile', { company_name: name });
      expect(p?.found, `round-trip failed for emitted name: ${name}`).toBe(true);
    }
  });
});
