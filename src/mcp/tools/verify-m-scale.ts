/**
 * MCP tool: verify_m_scale — independently re-verify the three branded Mindy numbers against their
 * authoritative oracle. Built so a 3rd-party QA tester (who has no prod credentials) can PROVE the
 * numbers are grounded the same way we do internally — just by calling the tool.
 *
 *   • M-Estimate™ — the opp_value_range RPC's low/median/high must EQUAL the 25th/50th/75th
 *     percentiles re-derived straight from the raw award table (recompete_opportunities). A NAICS with
 *     no comparables is an HONEST MISS (both null → "No estimate"), not a mismatch.
 *   • M-Win — a fixed profile+opp must produce the EXACT documented factor total (25+25+15+15+10+8=98),
 *     the no-profile fallback (30), and monotonicity.
 *   • M-Scale™ — the size tier flips exactly on fixed $ bands (Top ≥$100M · Mid $10M–$100M ·
 *     Emerging >$0 · none @ $0), boundary-tested.
 *
 * Reuses the SHARED oracle lib (src/lib/qa/m-scale-oracle.ts) that scripts/verify-m-scale.mjs also
 * calls — ONE source of truth, so the CLI, the predeploy gate, and this tool can never disagree. Every
 * figure is re-derived from real data or documented factor math; nothing is an LLM guess. Read-only.
 * credits: 0 (a QA/meta tool — never charge to prove your own numbers). `_meta` always ships.
 */
import { createClient } from '@supabase/supabase-js';
import { checkMEstimate, checkMWin, checkMScaleBoundaries, type OracleCheck } from '@/lib/qa/m-scale-oracle';

export interface VerifyMScaleInput {
  /** NAICS code to verify M-Estimate for (6-digit best). Defaults to 541512. */
  naics?: string;
}

export interface VerifyMScaleResult {
  naics: string;
  checks: OracleCheck[];
  summary: { total: number; passed: number; failed: number; all_grounded: boolean };
  _meta: { grounded: boolean; degraded: boolean; passed: number; failed: number };
}

export async function verifyMScale(input: VerifyMScaleInput): Promise<VerifyMScaleResult> {
  const naics = String(input.naics ?? '541512').replace(/\D/g, '').slice(0, 6) || '541512';

  const checks: OracleCheck[] = [];
  let degraded = false;

  // M-Estimate needs the DB (RPC + raw-table re-derivation). Degrade honestly on a DB error.
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    checks.push(...(await checkMEstimate(db, naics)));
  } catch (err) {
    degraded = true;
    console.error('[verify_m_scale] M-Estimate DB error:', err);
    checks.push({
      name: `M-Estimate ${naics}`,
      pass: false,
      detail: `DB unavailable — could not re-derive the oracle (this is a transient infra error, not a wrong number)`,
    });
  }

  // M-Win + M-Scale are pure (no DB) — deterministic factor / band math.
  checks.push(...checkMWin());
  checks.push(...checkMScaleBoundaries());

  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;

  return {
    naics,
    checks,
    summary: { total: checks.length, passed, failed, all_grounded: failed === 0 },
    // grounded = we actually produced verdicts; degraded = a DB hiccup prevented the M-Estimate re-derive.
    _meta: { grounded: checks.length > 0, degraded, passed, failed },
  };
}
