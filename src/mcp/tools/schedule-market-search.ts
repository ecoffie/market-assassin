/**
 * MCP tools: schedule / list / update / delete saved market searches.
 *
 * Gold master: src/lib/saved-searches/service.ts (same rows + alert cron as the Map).
 * Identity from verified MCP caller only — never an agent-supplied recipient email.
 * Does NOT send email or query award spend APIs; the existing saved-search-alerts cron does delivery.
 */
import { mcpFlags } from '@/lib/mcp/flags';
import {
  buildSavedSearchMapUrl,
  canonicalizeSavedSearchFilters,
  createSavedSearch,
  deleteSavedSearch,
  getSavedSearchDeliveryReadiness,
  listSavedSearches,
  updateSavedSearch,
  type DeliveryExecutionHealth,
  type DeliveryState,
  type SavedSearchAlertFrequency,
  type SavedSearchMode,
  type SavedSearchRow,
} from '@/lib/saved-searches';

export type ScheduleMarketSearchInput = {
  /** Verified MCP caller (ctx.userEmail). Owns the schedule; alerts go to this account. */
  userEmail: string;
  name: string;
  filters: Record<string, unknown>;
  mode?: SavedSearchMode;
  alert_frequency?: SavedSearchAlertFrequency;
  alerts_enabled?: boolean;
  bbox?: { w: number; s: number; e: number; n: number } | null;
};

export type ScheduleDeliveryMeta = {
  grounded: boolean;
  degraded: boolean;
  schedule_saved: boolean;
  delivery_state: DeliveryState;
  delivery_ready: boolean;
  delivery_execution_health?: DeliveryExecutionHealth;
  delivery_last_success_at?: string | null;
  idempotent: boolean;
  bbox_omitted?: boolean;
  bbox_restored?: boolean;
  noop?: boolean;
};

export type ScheduleMarketSearchResult = {
  schedule_id: string;
  name: string;
  cadence: SavedSearchAlertFrequency;
  alerts_enabled: boolean;
  mode: SavedSearchMode;
  filters: Record<string, unknown>;
  map_url: string;
  idempotent: boolean;
  alert_destination: 'account_email';
  message: string;
  _meta: ScheduleDeliveryMeta;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string };
};

function scheduleMessage(opts: {
  idempotent: boolean;
  alertsEnabled: boolean;
  deliveryReady: boolean;
  deliveryState: DeliveryState;
  bboxOmitted: boolean;
}): string {
  if (opts.idempotent) {
    return 'An identical schedule already exists for this account; returning the existing saved search.';
  }

  const parts: string[] = ['Schedule saved.'];

  if (opts.bboxOmitted) {
    parts.push('Map viewport (bbox) was not stored — only the filter set is restored via map_url.');
  }

  if (!opts.alertsEnabled) {
    parts.push('Alerts are paused; no emails will be sent until alerts are re-enabled.');
    return parts.join(' ');
  }

  if (opts.deliveryReady) {
    parts.push('When new matches appear, Mindy will email your account on the selected cadence.');
    return parts.join(' ');
  }

  if (opts.deliveryState === 'scheduler_unavailable') {
    parts.push('Alert delivery infrastructure is unavailable — do not promise emails.');
  } else if (opts.deliveryState === 'delivery_configured') {
    parts.push(
      'Alert delivery is configured, but no recent successful execution has been observed — do not promise emails yet.',
    );
  } else {
    parts.push(
      'Alert delivery is degraded and not currently guaranteed — the cron is missing, disabled, stale, or recently failed.',
    );
  }

  return parts.join(' ');
}

function publicScheduleView(
  search: SavedSearchRow,
  idempotent: boolean,
  delivery: Awaited<ReturnType<typeof getSavedSearchDeliveryReadiness>>,
  bboxOmitted: boolean,
): Omit<ScheduleMarketSearchResult, '_meta' | '_ai_hint'> {
  return {
    schedule_id: search.id,
    name: search.name,
    cadence: search.alert_frequency,
    alerts_enabled: search.alerts_enabled,
    mode: search.mode,
    filters: canonicalizeSavedSearchFilters(search.filters),
    map_url: buildSavedSearchMapUrl(search.id, { src: 'mcp_schedule' }),
    idempotent,
    alert_destination: 'account_email',
    message: scheduleMessage({
      idempotent,
      alertsEnabled: search.alerts_enabled,
      deliveryReady: delivery.delivery_ready,
      deliveryState: delivery.delivery_state,
      bboxOmitted,
    }),
  };
}

function failureResult(
  code: string,
  message: string,
  opts?: { degraded?: boolean; deliveryState?: DeliveryState },
): ScheduleMarketSearchResult {
  const deliveryState: DeliveryState =
    opts?.deliveryState ?? (code === 'scheduler_unavailable' ? 'scheduler_unavailable' : 'delivery_degraded');

  return {
    schedule_id: '',
    name: '',
    cadence: 'daily',
    alerts_enabled: false,
    mode: 'open',
    filters: {},
    map_url: '',
    idempotent: false,
    alert_destination: 'account_email',
    message,
    _meta: {
      grounded: false,
      degraded: opts?.degraded ?? code === 'scheduler_unavailable',
      schedule_saved: false,
      delivery_state: deliveryState,
      delivery_ready: false,
      idempotent: false,
    },
  };
}

export async function scheduleMarketSearch(input: ScheduleMarketSearchInput): Promise<ScheduleMarketSearchResult> {
  const delivery = await getSavedSearchDeliveryReadiness();

  const res = await createSavedSearch({
    userEmail: input.userEmail,
    name: input.name,
    mode: input.mode,
    filters: input.filters,
    bbox: input.bbox,
    alertsEnabled: input.alerts_enabled,
    alertFrequency: input.alert_frequency,
  });

  if (!res.ok) {
    const degraded = res.code === 'scheduler_unavailable';
    const out = failureResult(res.code, res.message, {
      degraded,
      deliveryState: degraded ? 'scheduler_unavailable' : delivery.delivery_state,
    });
    if (mcpFlags.aiHint) out._ai_hint = buildScheduleHint(out);
    return out;
  }

  const bboxOmitted = res.data.bbox_omitted;
  const body = publicScheduleView(res.data.search, res.data.idempotent, delivery, bboxOmitted);
  const alertsActive = res.data.search.alerts_enabled;
  const result: ScheduleMarketSearchResult = {
    ...body,
    _meta: {
      grounded: true,
      degraded: delivery.delivery_state === 'delivery_degraded' && alertsActive,
      schedule_saved: true,
      delivery_state: delivery.delivery_state,
      delivery_ready: delivery.delivery_ready,
      delivery_execution_health: delivery.execution_health,
      delivery_last_success_at: delivery.last_success_at,
      idempotent: res.data.idempotent,
      bbox_omitted: bboxOmitted,
      bbox_restored: !bboxOmitted,
    },
  };
  if (mcpFlags.aiHint) result._ai_hint = buildScheduleHint(result);
  return result;
}

export type ListMarketSchedulesInput = { userEmail: string };

export type ListMarketSchedulesResult = {
  schedules: Array<{
    schedule_id: string;
    name: string;
    cadence: SavedSearchAlertFrequency;
    alerts_enabled: boolean;
    mode: SavedSearchMode;
    filters: Record<string, unknown>;
    map_url: string;
  }>;
  count: number;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    delivery_state: DeliveryState;
    delivery_ready: boolean;
    delivery_execution_health: DeliveryExecutionHealth;
    delivery_last_success_at: string | null;
    count: number;
  };
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string };
};

export async function listMarketSchedules(input: ListMarketSchedulesInput): Promise<ListMarketSchedulesResult> {
  const delivery = await getSavedSearchDeliveryReadiness();
  const res = await listSavedSearches(input.userEmail);
  if (!res.ok) {
    return {
      schedules: [],
      count: 0,
      _meta: {
        grounded: false,
        degraded: res.code === 'scheduler_unavailable',
        delivery_state: res.code === 'scheduler_unavailable' ? 'scheduler_unavailable' : delivery.delivery_state,
        delivery_ready: false,
        delivery_execution_health: delivery.execution_health,
        delivery_last_success_at: delivery.last_success_at,
        count: 0,
      },
    };
  }

  const schedules = res.data.searches.map((s) => ({
    schedule_id: s.id,
    name: s.name,
    cadence: s.alert_frequency,
    alerts_enabled: s.alerts_enabled,
    mode: s.mode,
    filters: canonicalizeSavedSearchFilters(s.filters),
    map_url: buildSavedSearchMapUrl(s.id, { src: 'mcp_schedule' }),
  }));

  return {
    schedules,
    count: schedules.length,
    _meta: {
      grounded: true,
      degraded: delivery.delivery_state === 'delivery_degraded',
      delivery_state: delivery.delivery_state,
      delivery_ready: delivery.delivery_ready,
      delivery_execution_health: delivery.execution_health,
      delivery_last_success_at: delivery.last_success_at,
      count: schedules.length,
    },
  };
}

export type UpdateMarketScheduleInput = {
  userEmail: string;
  schedule_id: string;
  name?: string;
  alert_frequency?: SavedSearchAlertFrequency;
  alerts_enabled?: boolean;
};

export type UpdateMarketScheduleResult = {
  schedule_id: string;
  cadence: SavedSearchAlertFrequency;
  alerts_enabled: boolean;
  name: string;
  map_url: string;
  message: string;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    schedule_saved: boolean;
    delivery_state: DeliveryState;
    delivery_ready: boolean;
    delivery_execution_health: DeliveryExecutionHealth;
    delivery_last_success_at: string | null;
    noop?: boolean;
  };
};

export async function updateMarketSchedule(input: UpdateMarketScheduleInput): Promise<UpdateMarketScheduleResult> {
  const delivery = await getSavedSearchDeliveryReadiness();
  const res = await updateSavedSearch({
    userEmail: input.userEmail,
    id: input.schedule_id,
    name: input.name,
    alertFrequency: input.alert_frequency,
    alertsEnabled: input.alerts_enabled,
  });

  if (!res.ok) {
    return {
      schedule_id: input.schedule_id || '',
      cadence: 'daily',
      alerts_enabled: false,
      name: '',
      map_url: '',
      message: res.message,
      _meta: {
        grounded: false,
        degraded: res.code === 'scheduler_unavailable',
        schedule_saved: false,
        delivery_state: res.code === 'scheduler_unavailable' ? 'scheduler_unavailable' : delivery.delivery_state,
        delivery_ready: false,
        delivery_execution_health: delivery.execution_health,
        delivery_last_success_at: delivery.last_success_at,
      },
    };
  }

  const s = res.data.search;
  const message = res.data.noop
    ? 'No changes — schedule already matches the requested update.'
    : s.alerts_enabled
      ? delivery.delivery_ready
        ? 'Schedule updated. Alert emails will continue on the selected cadence when delivery infrastructure is healthy.'
        : 'Schedule updated, but alert delivery is not currently guaranteed.'
      : 'Schedule updated. Alerts are paused — prefer this over delete when stopping emails.';

  return {
    schedule_id: s.id,
    cadence: s.alert_frequency,
    alerts_enabled: s.alerts_enabled,
    name: s.name,
    map_url: buildSavedSearchMapUrl(s.id, { src: 'mcp_schedule' }),
    message,
    _meta: {
      grounded: true,
      degraded: delivery.delivery_state === 'delivery_degraded' && s.alerts_enabled,
      schedule_saved: true,
      delivery_state: delivery.delivery_state,
      delivery_ready: delivery.delivery_ready,
      delivery_execution_health: delivery.execution_health,
      delivery_last_success_at: delivery.last_success_at,
      noop: res.data.noop,
    },
  };
}

export type DeleteMarketScheduleInput = {
  userEmail: string;
  schedule_id: string;
  confirm?: boolean;
};

export type DeleteMarketScheduleResult = {
  deleted: boolean;
  schedule_id: string;
  message: string;
  _meta: { grounded: boolean; degraded: boolean; noop?: boolean };
};

export async function deleteMarketSchedule(input: DeleteMarketScheduleInput): Promise<DeleteMarketScheduleResult> {
  const res = await deleteSavedSearch(input.userEmail, input.schedule_id, {
    confirm: input.confirm,
    requireConfirm: true,
  });
  if (!res.ok) {
    return {
      deleted: false,
      schedule_id: input.schedule_id,
      message: res.message,
      _meta: { grounded: false, degraded: res.code === 'scheduler_unavailable' },
    };
  }

  if (res.data.noop) {
    return {
      deleted: false,
      schedule_id: input.schedule_id,
      message: 'Schedule not found or already deleted — no-op (uncharged).',
      _meta: { grounded: true, degraded: false, noop: true },
    };
  }

  return {
    deleted: true,
    schedule_id: input.schedule_id,
    message: 'Schedule deleted. No further alert emails will be sent for this saved search.',
    _meta: { grounded: true, degraded: false },
  };
}

function buildScheduleHint(r: ScheduleMarketSearchResult): NonNullable<ScheduleMarketSearchResult['_ai_hint']> {
  if (r._meta.degraded && !r._meta.grounded) {
    return {
      summary: 'Scheduling is unavailable or errored — no new schedule was created.',
      how_to_use: 'Report the message to the user. Do not claim a schedule exists or that alerts are active.',
      key_caveats: 'Degraded path. Do not invent a schedule_id or map_url.',
    };
  }
  if (!r._meta.grounded) {
    return {
      summary: 'Schedule was rejected (invalid filters, unsupported scope, or unsigned identity).',
      how_to_use: 'Fix the filters or ask the user to authenticate. Do not fabricate a schedule.',
      key_caveats: 'No row was created.',
    };
  }
  const deliveryNote = r._meta.delivery_ready
    ? 'Delivery is enabled and a recent successful saved-search-alerts run was observed.'
    : `Delivery state is ${r._meta.delivery_state} — do not promise email until delivery_ready is true.`;
  return {
    summary: r.idempotent
      ? `Existing schedule "${r.name}" (${r.cadence}) is already saved for this filter set.`
      : `Saved schedule "${r.name}" (${r.cadence}). ${deliveryNote}`,
    how_to_use: `Share map_url for the saved Map view. Email links from Mindy will use the same ?ss= id with optional ?opp= per opportunity.`,
    key_caveats:
      'Do not quote or invent the user email address. alert_destination=account_email only. ' +
      (r._meta.bbox_omitted ? 'bbox was omitted — viewport is NOT restored.' : ''),
  };
}
