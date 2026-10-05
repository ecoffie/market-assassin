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
  composeSearchAlertStatus,
  createSavedSearch,
  deleteSavedSearch,
  getSavedSearchDeliveryReadiness,
  listSavedSearches,
  probeFilterReach,
  readRecipientEvidence,
  updateSavedSearch,
  type DeliveryExecutionHealth,
  type DeliveryState,
  type FilterReach,
  type SavedSearchAlertStatus,
  type SavedSearchDeliveryReadiness,
  type SystemDeliveryStatus,
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
  alert_frequency?: SavedSearchAlertFrequency | string;
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
  /** SYSTEM-wide delivery (other customers' searches included). Never this search's own status. */
  system_delivery_status?: SystemDeliveryStatus;
  /** Last alert-job run with zero failures. A job-run time — NOT "last successful email send". */
  delivery_last_clean_run_at?: string | null;
  /** Last saved-search alert email the provider accepted, any account. */
  delivery_last_alert_sent_at?: string | null;
  /** Failure classes of the latest run (other searches), e.g. "email_send_rejected=3". */
  delivery_latest_run_failures?: string | null;
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
  /** What THIS search can do: saved/validated, filter reach, its own delivery, and system status. */
  alert_status?: SavedSearchAlertStatus;
  message: string;
  _meta: ScheduleDeliveryMeta;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string };
};

function scheduleMessage(opts: {
  idempotent: boolean;
  bboxOmitted: boolean;
  status: SavedSearchAlertStatus;
}): string {
  const parts: string[] = [
    opts.idempotent
      ? 'An identical schedule already exists for this account; returning the existing saved search.'
      : '',
    opts.status.summary,
  ];
  if (opts.bboxOmitted) {
    parts.push('Map viewport (bbox) was not stored — only the filter set is restored via map_url.');
  }
  return parts.filter(Boolean).join(' ');
}

/** Delivery fields shared by every schedule tool's _meta — named for what they measure. */
function deliveryMeta(delivery: SavedSearchDeliveryReadiness) {
  return {
    delivery_state: delivery.delivery_state,
    delivery_ready: delivery.delivery_ready,
    delivery_execution_health: delivery.execution_health,
    system_delivery_status: delivery.system_status,
    delivery_last_clean_run_at: delivery.last_clean_run_at,
    delivery_last_alert_sent_at: delivery.last_alert_sent_at,
    delivery_latest_run_failures: delivery.latest_run_failures,
  };
}

/**
 * `_meta.degraded` for a schedule: true only when THIS search is affected — a system problem that
 * is not a proven partial, or a failure specific to the search. Another customer's failure is not.
 */
function scheduleDegraded(status: SavedSearchAlertStatus): boolean {
  if (status.search_delivery === 'paused') return false;
  if (status.search_delivery === 'blocked' || status.search_delivery === 'failing') return true;
  return status.system_status === 'system_failure'
    || status.system_status === 'degraded_unconfirmed'
    || status.system_status === 'unknown';
}

async function statusFor(
  search: SavedSearchRow,
  delivery: SavedSearchDeliveryReadiness,
  reach?: FilterReach,
): Promise<SavedSearchAlertStatus> {
  const [recipient, filterReach] = await Promise.all([
    readRecipientEvidence(search.user_email),
    reach ? Promise.resolve(reach) : probeFilterReach(search.filters),
  ]);
  return composeSearchAlertStatus(search, delivery, recipient, filterReach);
}

function publicScheduleView(
  search: SavedSearchRow,
  idempotent: boolean,
  status: SavedSearchAlertStatus,
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
    alert_status: status,
    message: scheduleMessage({ idempotent, bboxOmitted, status }),
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
  const status = await statusFor(res.data.search, delivery);
  const body = publicScheduleView(res.data.search, res.data.idempotent, status, bboxOmitted);
  const result: ScheduleMarketSearchResult = {
    ...body,
    _meta: {
      grounded: true,
      degraded: scheduleDegraded(status),
      schedule_saved: true,
      ...deliveryMeta(delivery),
      idempotent: res.data.idempotent,
      bbox_omitted: bboxOmitted,
      bbox_restored: !bboxOmitted,
    },
  };
  if (mcpFlags.aiHint) result._ai_hint = buildScheduleHint(result);
  return result;
}

export type ListMarketSchedulesInput = { userEmail: string };

const LIST_REACH_PROBE_CAP = 25;

export type ListMarketSchedulesResult = {
  schedules: Array<{
    schedule_id: string;
    name: string;
    cadence: SavedSearchAlertFrequency;
    alerts_enabled: boolean;
    mode: SavedSearchMode;
    filters: Record<string, unknown>;
    map_url: string;
    alert_status?: SavedSearchAlertStatus;
  }>;
  count: number;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    delivery_state: DeliveryState;
    delivery_ready: boolean;
    delivery_execution_health: DeliveryExecutionHealth;
    system_delivery_status: SystemDeliveryStatus;
    delivery_last_clean_run_at: string | null;
    delivery_last_alert_sent_at: string | null;
    delivery_latest_run_failures: string | null;
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
        ...deliveryMeta(delivery),
        delivery_state: res.code === 'scheduler_unavailable' ? 'scheduler_unavailable' : delivery.delivery_state,
        delivery_ready: false,
        count: 0,
      },
    };
  }

  // Every schedule belongs to the caller, so recipient evidence is read once. Filter reach is
  // probed per search (bounded); beyond the cap it is reported as unknown, never guessed.
  const searches = res.data.searches;
  const recipient = searches.length ? await readRecipientEvidence(input.userEmail) : null;
  const reaches = await Promise.all(
    searches.map((s, i) => (i < LIST_REACH_PROBE_CAP ? probeFilterReach(s.filters) : Promise.resolve<FilterReach>('unknown'))),
  );
  const statuses = searches.map((s, i) => composeSearchAlertStatus(s, delivery, recipient!, reaches[i]));

  const schedules = searches.map((s, i) => ({
    schedule_id: s.id,
    name: s.name,
    cadence: s.alert_frequency,
    alerts_enabled: s.alerts_enabled,
    mode: s.mode,
    filters: canonicalizeSavedSearchFilters(s.filters),
    map_url: buildSavedSearchMapUrl(s.id, { src: 'mcp_schedule' }),
    alert_status: statuses[i],
  }));

  return {
    schedules,
    count: schedules.length,
    _meta: {
      grounded: true,
      degraded: statuses.some(scheduleDegraded),
      ...deliveryMeta(delivery),
      count: schedules.length,
    },
  };
}

export type UpdateMarketScheduleInput = {
  userEmail: string;
  schedule_id: string;
  name?: string;
  alert_frequency?: SavedSearchAlertFrequency | string;
  alerts_enabled?: boolean;
};

export type UpdateMarketScheduleResult = {
  schedule_id: string;
  cadence: SavedSearchAlertFrequency;
  alerts_enabled: boolean;
  name: string;
  map_url: string;
  alert_status?: SavedSearchAlertStatus;
  message: string;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    schedule_saved: boolean;
    delivery_state: DeliveryState;
    delivery_ready: boolean;
    delivery_execution_health: DeliveryExecutionHealth;
    system_delivery_status: SystemDeliveryStatus;
    delivery_last_clean_run_at: string | null;
    delivery_last_alert_sent_at: string | null;
    delivery_latest_run_failures: string | null;
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
        ...deliveryMeta(delivery),
        delivery_state: res.code === 'scheduler_unavailable' ? 'scheduler_unavailable' : delivery.delivery_state,
        delivery_ready: false,
      },
    };
  }

  const s = res.data.search;
  const status = await statusFor(s, delivery);
  const message = res.data.noop
    ? `No changes — schedule already matches the requested update. ${status.summary}`
    : s.alerts_enabled
      ? `Schedule updated. ${status.summary}`
      : 'Schedule updated. Alerts are paused — prefer this over delete when stopping emails.';

  return {
    schedule_id: s.id,
    cadence: s.alert_frequency,
    alerts_enabled: s.alerts_enabled,
    name: s.name,
    map_url: buildSavedSearchMapUrl(s.id, { src: 'mcp_schedule' }),
    alert_status: status,
    message,
    _meta: {
      grounded: true,
      degraded: scheduleDegraded(status),
      schedule_saved: true,
      ...deliveryMeta(delivery),
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
  const st = r.alert_status;
  const deliveryNote = st
    ? `${st.summary} (headline=${st.headline}, search_delivery=${st.search_delivery}, system=${st.system_status}).`
    : `Delivery state is ${r._meta.delivery_state}.`;
  return {
    summary: r.idempotent
      ? `Existing schedule "${r.name}" (${r.cadence}) is already saved for this filter set. ${deliveryNote}`
      : `Saved schedule "${r.name}" (${r.cadence}). ${deliveryNote}`,
    how_to_use: `Share map_url for the saved Map view. Email links from Mindy will use the same ?ss= id with optional ?opp= per opportunity.`,
    key_caveats:
      'Do not quote or invent the user email address. alert_destination=account_email only. ' +
      'Relay alert_status.summary; do not restate system status as this search failing. ' +
      'delivery_last_clean_run_at is the last job run with ZERO failures across all customers — never call it "last successful send"; ' +
      'delivery_last_alert_sent_at is the last alert email actually sent. ' +
      (r._meta.bbox_omitted ? 'bbox was omitted — viewport is NOT restored.' : ''),
  };
}
