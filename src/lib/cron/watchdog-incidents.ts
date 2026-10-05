/**
 * Incident-based notifications for the cron watchdog.
 *
 * WHY
 * dispatcher-watchdog posts to Slack on every 3-hourly pass whenever a problem exists,
 * with no memory. An unchanged failure therefore re-notified ~8x/day. Replaying its FAILING
 * check over cron_job_runs (2026-10-01 09:00 -> 10-05 06:00) gives 32 posts, 31 of them the
 * same saved-search-alerts failure. A channel that repeats itself is a channel nobody reads
 * when the real outage lands.
 *
 * RULES
 *   - Notify ONCE when an incident opens.
 *   - Identical repeats are silent (run history stays in cron_job_runs; observations++ here).
 *   - Notify again when the failure is MATERIALLY different (new signature) or WORSE
 *     (a customer-impacting class count rises above what was last notified).
 *   - ONE recovery message when it clears.
 *   - Persistent unchanged incidents go into ONE daily summary.
 *
 * SUPPRESSION IS NOT AN OUTAGE
 * saved-search `email_send_rejected` comes only from sendEmail's send guard (suppressed
 * recipient / suppression-check failure / synthetic address). It is listed as an actionable
 * suppression item — never as a fresh outage, and a growing count does not re-page. A
 * processing failure alongside it (e.g. a malformed customer search) still opens an incident.
 *
 * OVERLAPPING RUNS
 * A notification is sent only by the run that CLAIMED it: INSERT ... ON CONFLICT DO NOTHING
 * for a new incident, compare-and-set on `version` for an existing one. The loser of the race
 * sends nothing. A claimed-but-unconfirmed post stays in notify_pending and is retried by a
 * later run once PENDING_RETRY_LEASE_MS has passed (so a concurrent run never retries an
 * in-flight post).
 */

export type Counts = Record<string, number>;

export type IncidentKind = 'failing' | 'stuck' | 'overdue' | 'dispatcher_down';

export type WatchdogObservation = {
  key: string;
  kind: IncidentKind;
  jobName?: string | null;
  /** cron_job_runs.status of the newest failed run (failing only). */
  status?: string | null;
  /** cron_job_runs.error of the newest failed run (failing only). */
  error?: string | null;
  /** Human detail for the message (e.g. "last run 2026-10-04T11:00Z"). */
  detail?: string | null;
};

export type IncidentEvent = 'opened' | 'suppression_opened' | 'changed' | 'worsened' | 'recovered';

export type IncidentRow = {
  incident_key: string;
  source: string;
  kind: string;
  job_name: string | null;
  status: 'open' | 'resolved';
  signature: string | null;
  processing_counts: Counts;
  notified_counts: Counts;
  suppression_counts: Counts;
  last_detail: string | null;
  opened_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  observations: number;
  last_notified_at: string | null;
  last_notified_event: string | null;
  notify_pending: string | null;
  version: number;
};

export interface IncidentStore {
  /** Every row for this source. Throws (or rejects) when the store is unavailable. */
  list(source: string): Promise<IncidentRow[]>;
  /** INSERT ... ON CONFLICT DO NOTHING. true = this caller inserted the row. */
  insertIfAbsent(row: IncidentRow): Promise<boolean>;
  /** UPDATE ... WHERE incident_key = key AND version = expectedVersion. true = exactly one row. */
  compareAndSet(key: string, expectedVersion: number, patch: Partial<IncidentRow>): Promise<boolean>;
}

/** Recipient-suppression classes: visible + actionable, never an outage. */
export const SUPPRESSION_CLASSES = new Set(['email_send_rejected']);
/** Volatile metrics carried in summaries but excluded from identity and impact. */
const VOLATILE_CLASSES = new Set(['backlog']);
/** UTC hour from which the first watchdog pass posts the daily summary. */
export const DAILY_SUMMARY_HOUR_UTC = 12;
/** A claimed post that was never confirmed is retried only after this long. */
export const PENDING_RETRY_LEASE_MS = 10 * 60_000;
export const DAILY_SUMMARY_KEY_PREFIX = 'daily-summary:';

export type Classified = {
  signature: string;
  processing: Counts;
  suppression: Counts;
  /** True when the only failures are recipient suppressions. */
  suppressionOnly: boolean;
  label: string;
};

const CLASS_LIST = /^\s*[a-z][a-z0-9_]*=\d+(\s*,\s*[a-z][a-z0-9_]*=\d+)*\s*$/i;

/** Strip volatile parts so the same failure keeps one identity across runs. */
export function normalizeErrorMessage(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}t[\d:.]+z?\b/g, '<ts>')
    .replace(/\d+(\.\d+)?\s*(ms|s|sec|seconds|min|minutes)\b/g, '<dur>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function classifyObservation(o: WatchdogObservation): Classified {
  if (o.kind !== 'failing') {
    return { signature: o.kind, processing: {}, suppression: {}, suppressionOnly: false, label: o.kind };
  }
  const status = (o.status || 'error').toLowerCase();
  const err = (o.error || '').trim();
  if (err && CLASS_LIST.test(err)) {
    const processing: Counts = {};
    const suppression: Counts = {};
    for (const part of err.split(',')) {
      const [rawName, rawN] = part.split('=');
      const name = rawName.trim();
      const n = Number(rawN);
      if (VOLATILE_CLASSES.has(name)) continue;
      if (SUPPRESSION_CLASSES.has(name)) suppression[name] = n;
      else processing[name] = n;
    }
    const procNames = Object.keys(processing).sort();
    const suppressionOnly = procNames.length === 0 && Object.keys(suppression).length > 0;
    return {
      signature: `${status}|${suppressionOnly ? 'suppression-only' : procNames.join(',')}`,
      processing,
      suppression,
      suppressionOnly,
      label: procNames.length ? procNames.map((k) => `${k}=${processing[k]}`).join(', ') : 'recipient suppression only',
    };
  }
  const norm = err ? normalizeErrorMessage(err) : '(no error text)';
  return {
    signature: `${status}|msg:${norm}`,
    processing: {},
    suppression: {},
    suppressionOnly: false,
    label: `${status}: ${err || '(no error text)'}`.slice(0, 200),
  };
}

/** Which processing classes rose above the counts at the last notification. */
export function worsenedClasses(notified: Counts, current: Counts): string[] {
  return Object.keys(current)
    .filter((k) => (current[k] ?? 0) > (notified[k] ?? 0))
    .sort();
}

export type Decision = {
  event: IncidentEvent | null;
  /** Full next row state (without version — the caller manages that). */
  next: Omit<IncidentRow, 'version'>;
};

/**
 * Pure decision for one incident key. `prev` is the stored row (or null), `obs` the current
 * observation (or null = not observed this pass → recovery if it was open).
 */
export function decideIncident(
  source: string,
  key: string,
  prev: IncidentRow | null,
  obs: WatchdogObservation | null,
  nowIso: string,
): Decision | null {
  if (!obs) {
    if (!prev || prev.status !== 'open') return null;
    const { version: _v, ...rest } = prev;
    return {
      event: 'recovered',
      next: { ...rest, status: 'resolved', resolved_at: nowIso, last_seen_at: prev.last_seen_at },
    };
  }

  const c = classifyObservation(obs);
  const base = {
    incident_key: key,
    source,
    kind: obs.kind,
    job_name: obs.jobName ?? null,
    status: 'open' as const,
    signature: c.signature,
    processing_counts: c.processing,
    suppression_counts: c.suppression,
    last_detail: obs.detail ?? null,
    last_seen_at: nowIso,
    resolved_at: null,
  };

  if (!prev || prev.status !== 'open') {
    return {
      event: c.suppressionOnly ? 'suppression_opened' : 'opened',
      next: {
        ...base,
        notified_counts: c.processing,
        opened_at: nowIso,
        observations: 1,
        last_notified_at: prev?.last_notified_at ?? null,
        last_notified_event: prev?.last_notified_event ?? null,
        notify_pending: prev?.notify_pending ?? null,
      },
    };
  }

  const carry = {
    opened_at: prev.opened_at,
    observations: (prev.observations || 0) + 1,
    last_notified_at: prev.last_notified_at,
    last_notified_event: prev.last_notified_event,
    notify_pending: prev.notify_pending,
  };
  if (prev.signature !== c.signature) {
    return { event: 'changed', next: { ...base, ...carry, notified_counts: c.processing } };
  }
  if (worsenedClasses(prev.notified_counts || {}, c.processing).length > 0) {
    return { event: 'worsened', next: { ...base, ...carry, notified_counts: c.processing } };
  }
  // Identical repeat: record it, say nothing.
  return { event: null, next: { ...base, ...carry, notified_counts: prev.notified_counts || {} } };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

export type ClaimedEvent = { event: IncidentEvent; row: Omit<IncidentRow, 'version'>; prev: IncidentRow | null };

function counts(c: Counts): string {
  const ks = Object.keys(c).sort();
  return ks.length ? ks.map((k) => `${k}=${c[k]}`).join(', ') : 'none';
}

function subject(row: { kind: string; job_name: string | null; incident_key: string }): string {
  if (row.kind === 'dispatcher_down') return 'cron dispatcher';
  return row.job_name || row.incident_key;
}

function suppressionLine(s: Counts): string | null {
  const n = Object.values(s).reduce((a, b) => a + b, 0);
  if (!n) return null;
  return `🛡️ Recipient suppression (not an outage): ${n} email(s) blocked by the send guard (${counts(s)}). Action: review email_suppressions for this job's recipients.`;
}

function hoursBetween(a: string, b: string): number {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 36e5));
}

const KIND_LABEL: Record<string, string> = {
  failing: 'failing (consecutive failed runs)',
  stuck: 'stuck (lock never released)',
  overdue: 'overdue (scheduled run missed)',
  dispatcher_down: 'DISPATCHER LIKELY DOWN',
};

export function renderEventLines(e: ClaimedEvent, nowIso: string): string[] {
  const r = e.row;
  const who = subject(r);
  const detail = r.last_detail ? ` — ${r.last_detail}` : '';
  const sup = suppressionLine(r.suppression_counts || {});
  const procText = r.signature?.endsWith('|suppression-only')
    ? 'processing failures cleared; only recipient suppression remains'
    : r.kind === 'failing' && Object.keys(r.processing_counts || {}).length
      ? `processing failures: ${counts(r.processing_counts)}`
      : (r.signature?.includes('|msg:') ? r.signature.split('|msg:')[1] : KIND_LABEL[r.kind] || r.kind);
  switch (e.event) {
    case 'opened':
      return [`🔴 OPENED ${who} — ${procText}${detail}`, ...(sup ? [sup] : [])];
    case 'suppression_opened':
      return [`🛡️ SUPPRESSION ${who} — no processing failure; the job's only errors are blocked sends${detail}`, ...(sup ? [sup] : [])];
    case 'changed': {
      const was = e.prev?.signature?.split('|').slice(1).join('|') || 'unknown';
      return [`🔁 CHANGED ${who} — was [${was}], now ${procText}${detail}`, ...(sup ? [sup] : [])];
    }
    case 'worsened': {
      const prevN = e.prev?.notified_counts || {};
      const up = worsenedClasses(prevN, r.processing_counts || {}).map((k) => `${k} ${prevN[k] ?? 0}→${r.processing_counts[k]}`);
      return [`📈 WORSENED ${who} — ${up.join(', ')}${detail}`, ...(sup ? [sup] : [])];
    }
    case 'recovered':
      return [`✅ RECOVERED ${who} — cleared after ${r.observations} watchdog pass(es) over ${hoursBetween(r.opened_at, nowIso)}h (opened ${r.opened_at.slice(0, 16)}Z)`];
  }
}

export function renderEventsMessage(events: ClaimedEvent[], nowIso: string): { subject: string; html: string; text: string } {
  const tally: Record<string, number> = {};
  for (const e of events) tally[e.event] = (tally[e.event] || 0) + 1;
  const parts = Object.entries(tally).map(([k, n]) => `${n} ${k.replace('_', ' ')}`);
  const lines = events.flatMap((e) => renderEventLines(e, nowIso));
  return {
    subject: `Cron watchdog: ${parts.join(', ')}`,
    html: lines.map((l) => `<p>${l}</p>`).join('') + `<p style="color:#888">Run history: cron_job_runs. Checked ${nowIso}.</p>`,
    text: lines.join('\n'),
  };
}

export function renderDailySummary(open: IncidentRow[], nowIso: string): { subject: string; html: string; text: string } {
  const lines = open
    .slice()
    .sort((a, b) => a.opened_at.localeCompare(b.opened_at))
    .map((r) => {
      const proc = r.kind === 'failing' && Object.keys(r.processing_counts || {}).length
        ? counts(r.processing_counts)
        : (r.signature?.includes('|msg:') ? r.signature.split('|msg:')[1] : r.signature === 'error|suppression-only' ? 'recipient suppression only' : KIND_LABEL[r.kind] || r.kind);
      const sup = suppressionLine(r.suppression_counts || {});
      return `• ${subject(r)} — open ${hoursBetween(r.opened_at, nowIso)}h, ${r.observations} pass(es), ${proc}${r.last_detail ? ` — ${r.last_detail}` : ''}${sup ? `\n   ${sup}` : ''}`;
    });
  return {
    subject: `Cron watchdog daily summary: ${open.length} open incident(s), unchanged`,
    html: lines.map((l) => `<p>${l.replace('\n', '<br/>')}</p>`).join('') + `<p style="color:#888">Unchanged since last notified. ${nowIso}.</p>`,
    text: lines.join('\n'),
  };
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export type SendFn = (msg: { subject: string; html: string; text: string }) => Promise<{ ok: boolean }>;

export type IncidentRunResult = {
  storeAvailable: boolean;
  claimed: { key: string; event: IncidentEvent }[];
  silentRepeats: string[];
  lostRaces: string[];
  sent: boolean;
  summarySent: boolean;
  messages: { subject: string; text: string }[];
  error?: string;
};

function emptyRow(source: string, key: string, nowIso: string): IncidentRow {
  return {
    incident_key: key, source, kind: 'daily_summary', job_name: null, status: 'open', signature: null,
    processing_counts: {}, notified_counts: {}, suppression_counts: {}, last_detail: null,
    opened_at: nowIso, last_seen_at: nowIso, resolved_at: null, observations: 0,
    last_notified_at: null, last_notified_event: null, notify_pending: null, version: 0,
  };
}

/**
 * One watchdog pass. Never throws for store problems: a failed list returns
 * storeAvailable=false so the caller falls back to its legacy alert (monitoring must never
 * go silent because its dedupe store is down).
 */
export async function runWatchdogIncidents(opts: {
  store: IncidentStore;
  source: string;
  observations: WatchdogObservation[];
  now: Date;
  send: SendFn;
  /** Decide + render only; no writes, no send. */
  preview?: boolean;
}): Promise<IncidentRunResult> {
  const { store, source, now, send, preview } = opts;
  const nowIso = now.toISOString();
  const result: IncidentRunResult = {
    storeAvailable: true, claimed: [], silentRepeats: [], lostRaces: [], sent: false, summarySent: false, messages: [],
  };

  let rows: IncidentRow[];
  try {
    rows = await store.list(source);
  } catch (e) {
    return { ...result, storeAvailable: false, error: (e as Error).message };
  }
  const byKey = new Map(rows.map((r) => [r.incident_key, r]));
  const obsByKey = new Map(opts.observations.map((o) => [o.key, o]));

  const claimed: (ClaimedEvent & { version: number })[] = [];
  const keys = new Set<string>([...obsByKey.keys(), ...rows.filter((r) => r.status === 'open' && r.kind !== 'daily_summary').map((r) => r.incident_key)]);

  for (const key of keys) {
    const prev = byKey.get(key) ?? null;
    const d = decideIncident(source, key, prev, obsByKey.get(key) ?? null, nowIso);
    if (!d) continue;

    // A previously claimed post that never confirmed is re-emitted once its lease expires.
    let event = d.event;
    if (!event && prev?.notify_pending && prev.last_notified_at
      && now.getTime() - new Date(prev.last_notified_at).getTime() >= PENDING_RETRY_LEASE_MS) {
      event = prev.notify_pending as IncidentEvent;
    }

    const next = event
      ? { ...d.next, last_notified_at: nowIso, last_notified_event: event, notify_pending: event }
      : d.next;

    if (preview) {
      if (event) claimed.push({ event, row: next, prev, version: (prev?.version ?? -1) + 1 });
      else result.silentRepeats.push(key);
      continue;
    }

    let won: boolean;
    let newVersion: number;
    if (!prev) {
      newVersion = 0;
      won = await store.insertIfAbsent({ ...next, version: 0 });
    } else {
      newVersion = prev.version + 1;
      won = await store.compareAndSet(key, prev.version, { ...next, version: newVersion });
    }
    if (!won) { result.lostRaces.push(key); continue; }
    if (event) claimed.push({ event, row: next, prev, version: newVersion });
    else result.silentRepeats.push(key);
  }

  if (claimed.length) {
    const msg = renderEventsMessage(claimed, nowIso);
    result.messages.push({ subject: msg.subject, text: msg.text });
    result.claimed = claimed.map((c) => ({ key: c.row.incident_key, event: c.event }));
    if (!preview) {
      const r = await send(msg).catch(() => ({ ok: false }));
      result.sent = r.ok;
      if (r.ok) {
        for (const c of claimed) {
          // Confirm the post. If another run has since moved the row, its own state wins.
          await store.compareAndSet(c.row.incident_key, c.version, { notify_pending: null, version: c.version + 1 }).catch(() => false);
        }
      }
    }
  }

  // Daily summary — persistent incidents NOT already notified today, one post per UTC day.
  if (now.getUTCHours() >= DAILY_SUMMARY_HOUR_UTC) {
    const today = nowIso.slice(0, 10);
    const sKey = `${DAILY_SUMMARY_KEY_PREFIX}${source}`;
    const sRow = byKey.get(sKey) ?? null;
    if (sRow?.signature !== today) {
      const notifiedNow = new Set(claimed.map((c) => c.row.incident_key));
      const persistent = rows.filter((r) => r.kind !== 'daily_summary' && r.status === 'open'
        && obsByKey.has(r.incident_key) && !notifiedNow.has(r.incident_key)
        && (!r.last_notified_at || r.last_notified_at.slice(0, 10) < today));
      const won = preview ? true : sRow
        ? await store.compareAndSet(sKey, sRow.version, { signature: today, last_seen_at: nowIso, version: sRow.version + 1 })
        : await store.insertIfAbsent({ ...emptyRow(source, sKey, nowIso), signature: today });
      if (won && persistent.length) {
        // Present the latest observation for each persistent incident.
        const fresh = persistent.map((r) => {
          const o = obsByKey.get(r.incident_key)!;
          const c = classifyObservation(o);
          return { ...r, processing_counts: c.processing, suppression_counts: c.suppression, last_detail: o.detail ?? r.last_detail, observations: r.observations + 1 };
        });
        const msg = renderDailySummary(fresh, nowIso);
        result.messages.push({ subject: msg.subject, text: msg.text });
        if (!preview) {
          const r = await send(msg).catch(() => ({ ok: false }));
          result.summarySent = r.ok;
          if (!r.ok) {
            // Give the day back so a later pass retries the summary.
            const cur = (await store.list(source).catch(() => [])).find((x) => x.incident_key === sKey);
            if (cur) await store.compareAndSet(sKey, cur.version, { signature: sRow?.signature ?? null, version: cur.version + 1 }).catch(() => false);
          }
        }
      }
    }
  }

  return result;
}
