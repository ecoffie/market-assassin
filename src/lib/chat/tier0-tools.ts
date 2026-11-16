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
import { selectPursuitDocExcerpts, type PursuitDocText } from '@/lib/proposal/pursuit-doc-excerpts';

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
  {
    type: 'function' as const,
    function: {
      name: 'search_my_pursuit_documents',
      description:
        "Read the stored documents of ONE of the user's tracked pursuits (the RFP, SOW/PWS, Q&A, amendments, instructions, evaluation factors, and files they uploaded) and return the passages relevant to their question — never whole files. Identify the pursuit by its pursuit_id (from get_my_pipeline) or by words from its title as the user said them. Use when they ask what a pursuit's documents say (page limits, evaluation criteria, due dates, required certifications, a clause). Quote only what is returned; if no passage matches, say so. If several pursuits match, ask which one.",
      parameters: {
        type: 'object',
        properties: {
          pursuit: { type: 'string', description: "The pursuit_id from get_my_pipeline, or words from the pursuit's title (e.g. 'Fort Bragg janitorial')." },
          question: { type: 'string', description: "The user's question, in their words (used to pick relevant passages)." },
        },
        required: ['pursuit', 'question'],
        additionalProperties: false,
      },
    },
  },
];

/**
 * Reads a pursuit's stored documents for Ask Mindy. Built by the chat route with the
 * service-role client, the request (for x-active-workspace) and the VERIFIED email:
 * `authorize` MUST be authorizePursuitRead (owner, or a member/authorized coach of the
 * pursuit's workspace); `load` runs only after it allows.
 */
export interface PursuitDocsReader {
  authorize(pipelineId: string): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'error' }>;
  load(pipelineId: string): Promise<{ data: PursuitDocText[] | null; error: { message?: string } | null }>;
}

export interface Tier0Options {
  /** Present only when the chat route can read pursuit documents. */
  pursuitDocs?: PursuitDocsReader;
  /** True only when the caller passed the same strong authentication the Vault routes require. */
  strongAuth?: boolean;
}

export const TIER0_TOOL_NAMES = new Set(TIER0_TOOL_DEFS.map((t) => t.function.name));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PIPELINE_STAGES = new Set(['tracking', 'pursuing', 'bidding', 'submitted', 'won', 'lost']);

interface PipelineRow {
  id?: string;
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
  options: Tier0Options = {},
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
      'id, title, agency, stage, response_deadline, value_estimate, naics_code, set_aside, priority, next_action';
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
        pursuit_id: r.id ?? null,
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

  type TitlePick =
    | { kind: 'one'; id: string }
    | { kind: 'ambiguous'; candidates: Array<{ pursuit_id: string; title: string | null; agency: string | null }> }
    | { kind: 'none' }
    | { kind: 'error' };

  async function resolvePursuitByTitle(ref: string): Promise<TitlePick> {
    if (scope.kind === 'unavailable') return { kind: 'error' };
    const cols = 'id, title, agency, notice_id';
    const base = scope.kind === 'client'
      ? db.from('user_pipeline').select(cols).eq('workspace_id', scope.workspaceId)
      : db.from('user_pipeline').select(cols).eq('user_email', boundEmail);
    const { data, error } = await base.order('response_deadline', { ascending: true, nullsFirst: false }).limit(200);
    if (error) return { kind: 'error' };
    const words = ref.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (words.length === 0) return { kind: 'none' };
    const rows = (data || []) as Array<{ id?: string; title?: string | null; agency?: string | null; notice_id?: string | null }>;
    const scored = rows
      .map((r) => {
        const hay = `${r.title || ''} ${r.agency || ''} ${r.notice_id || ''}`.toLowerCase();
        return { r, hits: words.filter((w) => hay.includes(w)).length };
      })
      .filter((x) => x.hits > 0 && x.r.id)
      .sort((a, b) => b.hits - a.hits);
    if (scored.length === 0) return { kind: 'none' };
    const top = scored.filter((x) => x.hits === scored[0].hits);
    if (top.length === 1) return { kind: 'one', id: top[0].r.id! };
    return {
      kind: 'ambiguous',
      candidates: top.slice(0, 8).map((x) => ({ pursuit_id: x.r.id!, title: x.r.title ?? null, agency: x.r.agency ?? null })),
    };
  }

  async function searchMyPursuitDocuments(args: { pursuit?: unknown; question?: unknown }): Promise<Record<string, unknown>> {
    const denied = (error: string, note: string) => ({ ok: false, error, count: 0, excerpts: [], note });
    // Private documents: the Vault routes' strong authentication, then an ownership check.
    if (!options.strongAuth || !options.pursuitDocs) {
      return denied('strong_auth_required', 'Reading pursuit documents requires a full sign-in. Ask the user to sign in again.');
    }
    if (scope.kind === 'unavailable') return unavailable;
    const pursuitRef = typeof args?.pursuit === 'string' ? args.pursuit.trim().slice(0, 200) : '';
    const question = typeof args?.question === 'string' ? args.question.slice(0, 500) : '';
    if (!pursuitRef) return denied('pursuit_required', "Name the pursuit (its title words, or the pursuit_id from get_my_pipeline).");
    if (!question.trim()) return denied('question_required', 'Pass the question so the relevant passages can be chosen.');

    // Resolve a title reference within THIS workspace's pipeline (the same rows get_my_pipeline
    // returns). An id is used as given; either way authorize() below is the access decision.
    let pursuitId = pursuitRef;
    if (!UUID_RE.test(pursuitRef)) {
      const pick = await resolvePursuitByTitle(pursuitRef);
      if (pick.kind === 'error') return denied('pipeline_unavailable', 'Your pursuits could not be read right now.');
      if (pick.kind === 'none') return denied('pursuit_not_found', 'No tracked pursuit matches that name in this workspace. Call get_my_pipeline to list them.');
      if (pick.kind === 'ambiguous') {
        return { ok: false, error: 'pursuit_ambiguous', count: 0, excerpts: [], ...workspaceNote,
          candidates: pick.candidates, note: 'Several pursuits match. Ask the user which one (by title), then call again with its pursuit_id.' };
      }
      pursuitId = pick.id;
    }

    const access = await options.pursuitDocs.authorize(pursuitId);
    if (!access.ok) {
      // Not found and not yours are deliberately the same answer (no id probing).
      return access.reason === 'error'
        ? denied('pursuit_unavailable', 'The pursuit could not be checked right now. Do not treat this as "no documents".')
        : denied('pursuit_not_found', 'No pursuit with that id in this workspace. Use a pursuit_id from get_my_pipeline.');
    }
    const { data, error } = await options.pursuitDocs.load(pursuitId);
    if (error) {
      return denied('documents_unavailable', 'The documents could not be read right now. Do not treat this as "no documents".');
    }
    const docs = (data || []).filter((d) => (d.extracted_text || '').trim().length > 0);
    if (docs.length === 0) {
      return { ok: true, ...workspaceNote, document_count: 0, count: 0, excerpts: [],
        note: 'This pursuit has no readable documents stored yet (none fetched, or text could not be extracted).' };
    }
    const { excerpts, terms, truncated } = selectPursuitDocExcerpts(docs, question);
    return {
      ok: true,
      ...workspaceNote,
      document_count: docs.length,
      documents: docs.map((d) => ({ filename: d.filename, doc_kind: d.doc_kind ?? null })),
      searched_terms: terms,
      count: excerpts.length,
      excerpts,
      more_matches: truncated,
      ...(excerpts.length === 0
        ? { note: 'No passage in these documents matched the question. Say so; do not guess what they contain. Ask the user which section or term to look for.' }
        : {}),
    };
  }

  return {
    async execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      switch (name) {
        case 'get_my_pipeline':
          return getMyPipeline(args || {});
        case 'search_my_vault':
          return searchMyVault(args || {});
        case 'search_my_pursuit_documents':
          return searchMyPursuitDocuments(args || {});
        default:
          // A name outside the Tier-0 set must never silently succeed.
          return { ok: false, error: `unknown_tool:${name}` };
      }
    },
  };
}
