/**
 * Mindy Chat v2 — Tier-0 (PRIVATE) chat tools.
 *
 * Tier 0 = the crown jewels: the caller's OWN pipeline + Vault (CPARS,
 * references, clearances, contract values, teaming). See
 * tasks/PRD-mindy-chat-data-core.md §5a.
 *
 * ISOLATION CONTRACT (the whole point of this file):
 *   - `email` is bound ONCE, from the authenticated session, when the toolset is
 *     constructed. It is a CLOSURE variable, NOT a tool parameter.
 *   - The JSON Schema handed to the model exposes ZERO email/user/workspace
 *     argument. The model literally cannot ask for another user's data — there is
 *     no field to put it in.
 *   - Every query filters `.eq('user_email', email)` with that bound value.
 *   - Empty result => an honest "you have none" payload. Never fabricate (Rule #1);
 *     the fabrication guard is enforced by returning explicit `count: 0` + `items: []`
 *     so the model has nothing to embellish.
 *
 * This module has NO knowledge of HTTP, the request, or the model. It is a pure
 * data layer so it can be unit-tested with a stub Supabase client, and so the
 * isolation guarantee is auditable in one place.
 */

import { loadVaultContext } from '@/lib/proposal/loaders';

// The subset of the Supabase client surface these tools use. Kept structural so
// tests can pass a stub without importing the real client.
export interface Tier0Db {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        order(
          col: string,
          opts: { ascending: boolean; nullsFirst?: boolean },
        ): {
          limit(n: number): Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
          eq(col: string, val: string): {
            order(
              col: string,
              opts: { ascending: boolean; nullsFirst?: boolean },
            ): { limit(n: number): Promise<{ data: unknown[] | null; error: { message?: string } | null }> };
          };
        };
      };
    };
  };
}

// OpenAI/Groq-compatible tool (function) definitions. NOTE: `parameters` never
// contains an email/user field — caller identity is server-side only.
export const TIER0_TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_my_pipeline',
      description:
        "Return the signed-in user's OWN tracked pursuits (their pipeline). Call this whenever they ask about their pipeline, their pursuits, their deadlines, what they're bidding/tracking, or 'which of mine is due first'. Returns their real rows only.",
      parameters: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            enum: ['tracking', 'pursuing', 'bidding', 'submitted', 'won', 'lost'],
            description: 'Optional: only return pursuits in this stage.',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_my_vault',
      description:
        "Return the signed-in user's OWN Vault: their company identity, past performance (contracts/CPARS), and capability library. Call this when they ask about their own experience, past performance, capabilities, or want you to reference their real record when drafting.",
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
];

export const TIER0_TOOL_NAMES = new Set(TIER0_TOOL_DEFS.map((t) => t.function.name));

const PIPELINE_STAGES = new Set(['tracking', 'pursuing', 'bidding', 'submitted', 'won', 'lost']);

interface PipelineRow {
  title?: string;
  agency?: string;
  stage?: string;
  response_deadline?: string | null;
  value_estimate?: string | null;
  naics_code?: string | null;
  set_aside?: string | null;
  priority?: string | null;
  next_action?: string | null;
}

/**
 * Build a Tier-0 toolset bound to ONE authenticated email. The returned
 * `execute(name, args)` runs the named tool; `args` is whatever the model
 * supplied and is treated as UNTRUSTED — only whitelisted, validated fields are
 * ever used, and NEVER an identity field.
 */
export function makeTier0Tools(db: Tier0Db, email: string) {
  const boundEmail = email; // closure — the model cannot reach or override this

  async function getMyPipeline(args: { stage?: unknown }): Promise<Record<string, unknown>> {
    // Validate the ONLY model-supplied field. Anything unexpected is ignored.
    const stage =
      typeof args?.stage === 'string' && PIPELINE_STAGES.has(args.stage) ? args.stage : null;

    const cols =
      'title, agency, stage, response_deadline, value_estimate, naics_code, set_aside, priority, next_action';
    let q = db.from('user_pipeline').select(cols).eq('user_email', boundEmail);
    // deadline-ascending so "due first" is row 0; nulls last.
    const base = q.order('response_deadline', { ascending: true, nullsFirst: false });
    const runnable = stage ? base.eq('stage', stage).order('response_deadline', { ascending: true, nullsFirst: false }) : base;
    const { data, error } = await runnable.limit(25);

    if (error) {
      return { ok: false, error: 'pipeline_unavailable', count: 0, items: [] };
    }
    const rows = (data || []) as PipelineRow[];
    if (rows.length === 0) {
      return {
        ok: true,
        count: 0,
        items: [],
        note: stage
          ? `You have no pursuits in the "${stage}" stage.`
          : 'You have no pursuits in your pipeline yet.',
      };
    }
    return {
      ok: true,
      count: rows.length,
      items: rows.map((r) => ({
        title: r.title ?? null,
        agency: r.agency ?? null,
        stage: r.stage ?? null,
        deadline: r.response_deadline ?? null,
        value: r.value_estimate ?? null,
        naics: r.naics_code ?? null,
        set_aside: r.set_aside ?? null,
        priority: r.priority ?? null,
        next_action: r.next_action ?? null,
      })),
    };
  }

  async function searchMyVault(): Promise<Record<string, unknown>> {
    // Reuse the proposal loader — already email-scoped, already the safe pattern.
    // 'exec_summary' pulls identity + past performance + capabilities (the broad set).
    const vault = await loadVaultContext(boundEmail, 'exec_summary');
    if (!vault.has_any) {
      return { ok: true, has_any: false, note: 'Your Vault is empty — no identity, past performance, or capabilities saved yet.' };
    }
    return {
      ok: true,
      has_any: true,
      identity: vault.identity ?? null,
      past_performance: vault.past_performance ?? [],
      capabilities: vault.capabilities ?? [],
    };
  }

  return {
    async execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      switch (name) {
        case 'get_my_pipeline':
          return getMyPipeline(args || {});
        case 'search_my_vault':
          return searchMyVault();
        default:
          // A name outside the Tier-0 set must never silently succeed.
          return { ok: false, error: `unknown_tool:${name}` };
      }
    },
  };
}
