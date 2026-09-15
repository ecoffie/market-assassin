/**
 * Contextual next-step suggestions on MCP tool results.
 *
 * A tool that returns good data is only half the experience — Mindy should guide
 * the next useful step. Each suggestion names the tool, credit cost, and any
 * missing input. Suggest one strong step (occasionally two), never a menu.
 *
 * Suggesting a paid call / watch / delivery change is NOT permission to run it —
 * `requires_confirmation: true` means the host agent must explain cost and wait.
 *
 * Attached centrally by `attachNextActions` inside `runMcpTool` so every hosted
 * path gets it without per-tool boilerplate. Tools that already set `_next` win.
 *
 * Credit amounts are duplicated from TOOL_CREDITS for the tools we suggest (not
 * imported from tool-registry — that would create a circular import). Keep in sync
 * when repricing those tools.
 */

/** Prices for tools that appear as `_next` targets — mirror TOOL_CREDITS. */
const NEXT_TOOL_CREDITS: Readonly<Record<string, number>> = {
  search_sam_opportunities: 5,
  evaluate_bid_decision: 5,
  get_agency_intel: 5,
  get_winning_playbook: 20,
  search_federal_contacts: 15,
  get_solicitation_incumbent: 20,
  extract_compliance_matrix: 20,
  build_proposal_structure: 10,
  build_pursuit_dossier: 100,
  schedule_market_search: 0,
  update_market_schedule: 0,
};

export type McpNextAction = {
  /** Plain-language offer for the agent to present. */
  prompt: string;
  /** Registry tool to call if the user accepts. */
  tool: string;
  /** Credit cost of that next tool (0 = free / write). */
  credits: number;
  /**
   * True for paid calls, creating a watch, or changing delivery — explain and
   * wait for an explicit user request before calling the tool.
   */
  requires_confirmation: boolean;
  /** Inputs the next tool still needs (from the user or a prior field). */
  missing_inputs?: string[];
  /** Args already known from this result — agent may pass these through. */
  suggested_args?: Record<string, unknown>;
};

export type McpNextBlock = {
  primary: McpNextAction;
  secondary?: McpNextAction;
};

function credits(tool: string): number {
  return NEXT_TOOL_CREDITS[tool] ?? 0;
}

function action(
  partial: Omit<McpNextAction, 'credits'> & { credits?: number },
): McpNextAction {
  return {
    ...partial,
    credits: partial.credits ?? credits(partial.tool),
  };
}

function grounded(result: Record<string, unknown>): boolean {
  const meta = result._meta as { grounded?: boolean } | undefined;
  if (meta && typeof meta.grounded === 'boolean') return meta.grounded;
  // Tier-1 search shape has no _meta — treat non-empty items as grounded.
  const items = result.items;
  if (Array.isArray(items)) return items.length > 0;
  const count = result.count;
  if (typeof count === 'number') return count > 0;
  return true;
}

function firstItem(result: Record<string, unknown>): Record<string, unknown> | null {
  const items = result.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const row = items[0];
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Build the `_next` block for a tool result, or null when nothing useful to suggest. */
export function suggestNextActions(
  toolName: string,
  result: Record<string, unknown>,
  args: Record<string, unknown> = {},
): McpNextBlock | null {
  switch (toolName) {
    case 'search_sam_opportunities':
      return nextAfterOppSearch(result, args);
    case 'schedule_market_search':
      return nextAfterWatchCreated(result);
    case 'list_market_schedules':
      return nextAfterScheduleList(result);
    case 'get_solicitation_incumbent':
      return nextAfterIncumbent(result, args);
    case 'evaluate_bid_decision':
      return nextAfterBid(result, args);
    case 'build_pursuit_dossier':
      return nextAfterDossier(result, args);
    case 'generate_market_report':
      return nextAfterMarketReport(result);
    case 'extract_compliance_matrix':
      return nextAfterComplianceMatrix(result, args);
    default:
      return null;
  }
}

/**
 * Attach `_next` onto a successful tool result. Idempotent: preserves a tool's
 * own `_next` if already present. Never fabricates suggestions on empty/ungrounded
 * results unless the tool-specific helper opts in.
 */
export function attachNextActions(
  toolName: string,
  result: Record<string, unknown>,
  args: Record<string, unknown> = {},
): Record<string, unknown> {
  if (result && typeof result === 'object' && result._next != null) {
    return result;
  }
  const next = suggestNextActions(toolName, result, args);
  if (!next) return result;
  return { ...result, _next: next };
}

// ── Per-tool workflows ──────────────────────────────────────────────────────

function nextAfterOppSearch(
  result: Record<string, unknown>,
  args: Record<string, unknown>,
): McpNextBlock | null {
  if (!grounded(result)) return null;

  const filters: Record<string, unknown> = {};
  const keyword = str(args.keyword);
  const naics = str(args.naics);
  const state = str(args.state);
  const setAside = str(args.set_aside);
  if (keyword) filters.keyword = keyword;
  if (naics) filters.naics = naics;
  if (state) filters.state = state;
  if (setAside) filters.set_aside = setAside;

  const nameBits = [keyword, naics, state].filter(Boolean);
  const scheduleName = (nameBits.join(' · ') || 'My market search').slice(0, 80);

  const primary = action({
    prompt: 'Want me to monitor this search for new matches?',
    tool: 'schedule_market_search',
    requires_confirmation: true,
    missing_inputs: Object.keys(filters).length ? undefined : ['filters'],
    suggested_args: {
      name: scheduleName,
      filters,
      alert_frequency: 'daily',
      alerts_enabled: true,
    },
  });

  const top = firstItem(result);
  const sol = str(top?.solicitation_number) || str(top?.notice_id);
  if (!sol) return { primary };

  return {
    primary,
    secondary: action({
      prompt: 'Or I can check bid-fit / the likely incumbent on the top match.',
      tool: 'get_solicitation_incumbent',
      requires_confirmation: true,
      suggested_args: { solicitation_number: sol },
    }),
  };
}

function nextAfterWatchCreated(result: Record<string, unknown>): McpNextBlock | null {
  const scheduleId = str(result.schedule_id);
  if (!scheduleId) return null;

  const cadence = str(result.cadence) || 'daily';
  const destination =
    str(result.alert_destination) === 'account_email'
      ? 'your Mindy account email'
      : 'your account email';

  return {
    primary: action({
      prompt: `Watch is set — ${cadence} alerts to ${destination}. Want to change delivery preferences (cadence, pause, or name)?`,
      tool: 'update_market_schedule',
      requires_confirmation: true,
      suggested_args: { schedule_id: scheduleId },
      missing_inputs: ['alert_frequency or alerts_enabled'],
    }),
  };
}

function nextAfterScheduleList(result: Record<string, unknown>): McpNextBlock | null {
  const schedules = result.schedules;
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return {
      primary: action({
        prompt: 'No watches yet — want me to search open opportunities and set one up?',
        tool: 'search_sam_opportunities',
        requires_confirmation: false,
        missing_inputs: ['keyword'],
      }),
    };
  }
  const first = schedules[0] as Record<string, unknown>;
  const id = str(first?.schedule_id) || str(first?.id);
  if (!id) return null;
  return {
    primary: action({
      prompt: 'Want to change cadence or pause alerts on one of these watches?',
      tool: 'update_market_schedule',
      requires_confirmation: true,
      suggested_args: { schedule_id: id },
      missing_inputs: ['alert_frequency or alerts_enabled'],
    }),
  };
}

function nextAfterIncumbent(
  result: Record<string, unknown>,
  args: Record<string, unknown>,
): McpNextBlock | null {
  if (!grounded(result)) return null;
  const sol =
    str(args.solicitation_number) ||
    str(args.notice_id) ||
    str((result.notice as Record<string, unknown> | undefined)?.solicitation_number) ||
    str((result._meta as { solicitation?: string } | undefined)?.solicitation);

  return {
    primary: action({
      prompt: 'Want a bid-fit assessment on this opportunity?',
      tool: 'evaluate_bid_decision',
      requires_confirmation: true,
      missing_inputs: ['gates', 'ratings'],
    }),
    secondary: sol
      ? action({
          prompt: 'Or I can assemble a full pursuit dossier (incumbent, competition, contacts, docs).',
          tool: 'build_pursuit_dossier',
          requires_confirmation: true,
          suggested_args: { solicitation_number: sol },
        })
      : undefined,
  };
}

function nextAfterBid(
  result: Record<string, unknown>,
  args: Record<string, unknown>,
): McpNextBlock | null {
  const meta = result._meta as {
    scored?: boolean;
    blocked?: boolean;
    recommendation?: string | null;
  } | undefined;

  if (!meta?.scored) {
    return {
      primary: action({
        prompt:
          'I have the bid/no-bid framework. Want me to score this opportunity once you answer the 5 gates and rate the 10 factors?',
        tool: 'evaluate_bid_decision',
        requires_confirmation: false,
        missing_inputs: ['gates', 'ratings'],
        suggested_args: args.gates || args.ratings ? { gates: args.gates, ratings: args.ratings } : undefined,
      }),
    };
  }

  if (meta.blocked || meta.recommendation === 'skip') {
    return {
      primary: action({
        prompt: 'Want coaching on how to win a similar opportunity next time?',
        tool: 'get_winning_playbook',
        requires_confirmation: true,
        missing_inputs: ['topic'],
      }),
    };
  }

  const sol = str(args.solicitation_number) || str(args.notice_id);
  return {
    primary: action({
      prompt: 'Want a pursuit dossier on this opportunity (incumbent, competition, contacts, docs)?',
      tool: 'build_pursuit_dossier',
      requires_confirmation: true,
      missing_inputs: sol ? undefined : ['solicitation_number'],
      suggested_args: sol ? { solicitation_number: sol } : undefined,
    }),
    secondary: action({
      prompt: 'Or I can start a compliance checklist from the solicitation.',
      tool: 'extract_compliance_matrix',
      requires_confirmation: true,
      missing_inputs: sol ? undefined : ['notice_id or rfp_text'],
      suggested_args: sol ? { notice_id: sol } : undefined,
    }),
  };
}

function nextAfterDossier(
  result: Record<string, unknown>,
  args: Record<string, unknown>,
): McpNextBlock | null {
  if (!grounded(result)) return null;
  const sol =
    str(args.solicitation_number) ||
    str(args.notice_id) ||
    str((result._meta as { solicitation?: string } | undefined)?.solicitation);

  return {
    primary: action({
      prompt: 'Ready for a compliance checklist from this solicitation?',
      tool: 'extract_compliance_matrix',
      requires_confirmation: true,
      missing_inputs: sol ? undefined : ['notice_id or rfp_text'],
      suggested_args: sol ? { notice_id: sol } : undefined,
    }),
    secondary: action({
      prompt: 'Or score this opportunity with the bid/no-bid framework.',
      tool: 'evaluate_bid_decision',
      requires_confirmation: true,
      missing_inputs: ['gates', 'ratings'],
    }),
  };
}

function nextAfterMarketReport(result: Record<string, unknown>): McpNextBlock | null {
  if (!grounded(result)) return null;

  const sections = result.sections as
    | { top_agencies?: Array<{ name?: string }> | null }
    | undefined;
  const agencies = sections?.top_agencies;
  const topAgency =
    Array.isArray(agencies) && agencies[0] && typeof agencies[0] === 'object'
      ? str(agencies[0].name)
      : undefined;

  return {
    primary: action({
      prompt: topAgency
        ? `Want me to investigate ${topAgency} — the top buyer in this report?`
        : 'Want me to investigate the most relevant buyers from this report?',
      tool: 'get_agency_intel',
      requires_confirmation: true,
      missing_inputs: topAgency ? undefined : ['agency'],
      suggested_args: topAgency ? { agency: topAgency } : undefined,
    }),
    secondary: topAgency
      ? action({
          prompt: `Or find contracting contacts at ${topAgency}.`,
          tool: 'search_federal_contacts',
          requires_confirmation: true,
          suggested_args: { agency: topAgency },
        })
      : undefined,
  };
}

function nextAfterComplianceMatrix(
  result: Record<string, unknown>,
  args: Record<string, unknown>,
): McpNextBlock | null {
  if (!grounded(result)) return null;
  return {
    primary: action({
      prompt: 'Want me to draft the proposal structure from these requirements?',
      tool: 'build_proposal_structure',
      requires_confirmation: true,
      suggested_args: args.notice_id ? { notice_id: args.notice_id } : undefined,
      missing_inputs: ['requirements or notice context'],
    }),
  };
}
