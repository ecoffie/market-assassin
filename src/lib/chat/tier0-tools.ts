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

import { loadVaultContext, ALL_VAULT_SECTIONS } from '@/lib/proposal/loaders';
import { vaultEmailFor, WORKSPACE_UNCONFIRMED_NOTE, type ChatActingScope } from '@/lib/chat/chat-acting-scope';
import { matchRequirementsToEvidence } from '@/lib/proposal/evidence-match';
import { parseRetrieveArgs, retrieveVault, RETRIEVAL_POOL_LIMITS, type VaultRetrievalDeps } from './vault-retrieval';

/** Production retrieval deps: the shared loader (all sections) + the shared hybrid matcher. */
const defaultVaultDeps: VaultRetrievalDeps = {
  loadVault: (email) => loadVaultContext(email, 'exec_summary', { sections: ALL_VAULT_SECTIONS, limits: RETRIEVAL_POOL_LIMITS }),
  matchEvidence: async (email, query) => {
    // useRerank:false keeps this a retrieval step (no LLM call). One "requirement" = the question.
    const [res] = await matchRequirementsToEvidence(email, [{ id: 'q', requirement: query }], { useRerank: false, topN: 12 });
    return res?.evidence ?? [];
  },
};

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
        "Retrieve records from the signed-in user's OWN Vault (company identity, past performance/CPARS, capability library, team and key personnel) that are relevant to the question. Pass `query` with what the user is asking about in their words (e.g. 'DLA spare parts', 'cybersecurity past performance', 'who is cleared'); only the matching records come back. Without `query` you get an overview (identity summary, counts and titles), not full records. If nothing matches, say so; never substitute unrelated records.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: "What the user is asking about, in their words. Used to pick the relevant Vault records.",
          },
          sections: {
            type: 'array',
            items: { type: 'string', enum: ['past_performance', 'capabilities', 'team'] },
            description: 'Optional: only these record sections.',
          },
        },
        required: [],
        additionalProperties: false,
      },
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
export function makeTier0Tools(
  db: Tier0Db,
  emailOrScope: string | ChatActingScope,
  vaultDeps: VaultRetrievalDeps = defaultVaultDeps,
) {
  // Closure — the model cannot reach or override any of this. A plain email is the
  // caller's own scope (unchanged behaviour). A coach acting in an authorized client
  // workspace gets that client's rows ONLY (see chat-acting-scope.ts).
  const scope: ChatActingScope =
    typeof emailOrScope === 'string' ? { kind: 'own', email: emailOrScope } : emailOrScope;
  const boundEmail = scope.email;
  const workspaceNote = scope.kind === 'client' ? { workspace: 'client' as const } : {};
  const unavailable = { ok: false, error: 'workspace_unavailable', count: 0, items: [],
    note: WORKSPACE_UNCONFIRMED_NOTE };

  async function getMyPipeline(args: { stage?: unknown }): Promise<Record<string, unknown>> {
    // Validate the ONLY model-supplied field. Anything unexpected is ignored.
    const stage =
      typeof args?.stage === 'string' && PIPELINE_STAGES.has(args.stage) ? args.stage : null;

    const cols =
      'title, agency, stage, response_deadline, value_estimate, naics_code, set_aside, priority, next_action';
    if (scope.kind === 'unavailable') return unavailable;
    // Client workspace: that workspace's pursuits only (pipeline GET's asClient branch).
    let q = scope.kind === 'client'
      ? db.from('user_pipeline').select(cols).eq('workspace_id', scope.workspaceId)
      : db.from('user_pipeline').select(cols).eq('user_email', boundEmail);
    // deadline-ascending so "due first" is row 0; nulls last.
    const base = q.order('response_deadline', { ascending: true, nullsFirst: false });
    const runnable = stage ? base.eq('stage', stage).order('response_deadline', { ascending: true, nullsFirst: false }) : base;
    const { data, error } = await runnable.limit(25);

    if (error) {
      return { ok: false, error: 'pipeline_unavailable', count: 0, items: [], ...workspaceNote };
    }
    const rows = (data || []) as PipelineRow[];
    if (rows.length === 0) {
      return {
        ok: true,
        count: 0,
        items: [],
        note: scope.kind === 'client'
          ? (stage ? `This client workspace has no pursuits in the "${stage}" stage.` : 'This client workspace has no pursuits yet.')
          : stage
            // Own scope reads only rows saved under the user's own email (team-workspace rows
            // are not searched here), so the note must not claim the user has nothing.
            ? `No pursuits in the "${stage}" stage are saved under your own account. Team-workspace pursuits aren't searched here.`
            : "No pursuits are saved under your own account. Team-workspace pursuits aren't searched here.",
        ...workspaceNote,
      };
    }
    return {
      ok: true,
      ...workspaceNote,
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

  async function searchMyVault(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Retrieval, not a dump: the whole Vault is loaded server-side as the pool, and
    // only the records relevant to `query` go back to the model (vault-retrieval.ts).
    // The Vault is the acting scope's: a coach in an authorized client workspace reads
    // the client's Vault (its synthetic owner email), never their own. Loader AND
    // matcher get the same email. Unresolved scope → read nothing.
    const vaultEmail = vaultEmailFor(scope);
    if (!vaultEmail) return unavailable;
    const out = await retrieveVault(vaultEmail, parseRetrieveArgs(args), vaultDeps, {
      owner: scope.kind === 'client' ? 'client' : 'own',
    });
    return { ...out, ...workspaceNote };
  }

  return {
    async execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      switch (name) {
        case 'get_my_pipeline':
          return getMyPipeline(args || {});
        case 'search_my_vault':
          return searchMyVault(args || {});
        default:
          // A name outside the Tier-0 set must never silently succeed.
          return { ok: false, error: `unknown_tool:${name}` };
      }
    },
  };
}
