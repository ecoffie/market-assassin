import { describe, it, expect } from 'vitest';
import {
  classifyObservation,
  decideIncident,
  normalizeErrorMessage,
  runWatchdogIncidents,
  PENDING_RETRY_LEASE_MS,
  type IncidentRow,
  type IncidentStore,
  type WatchdogObservation,
} from './watchdog-incidents';

/**
 * In-memory store with the same atomicity as the SQL store: each operation completes
 * without yielding, so INSERT-if-absent and compare-and-set are indivisible — exactly the
 * guarantee Postgres gives a single INSERT ... ON CONFLICT / UPDATE ... WHERE version.
 */
export function memoryStore(): IncidentStore & { rows: Map<string, IncidentRow>; failList?: boolean } {
  const rows = new Map<string, IncidentRow>();
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const s = {
    rows,
    failList: false,
    async list(source: string) {
      await Promise.resolve();
      if (s.failList) throw new Error('relation "ops_incidents" does not exist');
      return [...rows.values()].filter((r) => r.source === source).map(clone);
    },
    async insertIfAbsent(row: IncidentRow) {
      await Promise.resolve();
      if (rows.has(row.incident_key)) return false;
      rows.set(row.incident_key, clone(row));
      return true;
    },
    async compareAndSet(key: string, v: number, patch: Partial<IncidentRow>) {
      await Promise.resolve();
      const cur = rows.get(key);
      if (!cur || cur.version !== v) return false;
      rows.set(key, { ...cur, ...clone(patch) });
      return true;
    },
  };
  return s;
}

type Captured = { subject: string; text: string };
function capture() {
  const sent: Captured[] = [];
  return { sent, send: async (m: { subject: string; text: string }) => { sent.push({ subject: m.subject, text: m.text }); return { ok: true }; } };
}

// The two real failures from the 2026-10-05T06:00:29Z watchdog alert (cron_job_runs).
const SAVED_SEARCH = (error = 'unexpected_schedule_error=1,email_send_rejected=3', at = '2026-10-04T11:00'): WatchdogObservation => ({
  key: 'failing:saved-search-alerts', kind: 'failing', jobName: 'saved-search-alerts', status: 'error', error,
  detail: `last failed run ${at}Z (error)`,
});
const EPA = (status = 'timeout', error = 'This operation was aborted', at = '2026-10-04T14:50'): WatchdogObservation => ({
  key: 'failing:epa-source-watch', kind: 'failing', jobName: 'epa-source-watch', status, error,
  detail: `last failed run ${at}Z (${status})`,
});

const SRC = 'dispatcher-watchdog';
const pass = (store: IncidentStore, obs: WatchdogObservation[], iso: string, send: ReturnType<typeof capture>['send']) =>
  runWatchdogIncidents({ store, source: SRC, observations: obs, now: new Date(iso), send });

describe('classification', () => {
  it('splits processing failures from recipient suppression; counts are not identity', () => {
    const c = classifyObservation(SAVED_SEARCH());
    expect(c.processing).toEqual({ unexpected_schedule_error: 1 });
    expect(c.suppression).toEqual({ email_send_rejected: 3 });
    expect(c.signature).toBe('error|unexpected_schedule_error');
    expect(classifyObservation(SAVED_SEARCH('unexpected_schedule_error=4,email_send_rejected=9')).signature).toBe(c.signature);
  });

  it('suppression-only is not a processing failure', () => {
    const c = classifyObservation(SAVED_SEARCH('email_send_rejected=3'));
    expect(c.suppressionOnly).toBe(true);
    expect(c.signature).toBe('error|suppression-only');
  });

  it('free-text errors normalize volatile numbers, ids and durations', () => {
    expect(normalizeErrorMessage('fetch failed after 3 attempts in 1200ms id 16c461b6-b204-4189-9e8e-1994bc4561ba'))
      .toBe(normalizeErrorMessage('fetch failed after 5 attempts in 900ms id 00000000-0000-4000-8000-000000000000'));
    expect(classifyObservation(EPA()).signature).toBe('timeout|msg:this operation was aborted');
  });

  it('backlog is volatile, not identity', () => {
    expect(classifyObservation(SAVED_SEARCH('email_send_failed=1,capacity_exhausted=1,backlog=40')).signature)
      .toBe(classifyObservation(SAVED_SEARCH('email_send_failed=1,capacity_exhausted=1,backlog=7')).signature);
  });

  it('decideIncident: identical repeat produces no event but counts the observation', () => {
    const first = decideIncident(SRC, 'k', null, SAVED_SEARCH(), '2026-10-04T12:00:00Z')!;
    const prev = { ...first.next, version: 0 } as IncidentRow;
    const again = decideIncident(SRC, 'k', prev, SAVED_SEARCH(), '2026-10-04T15:00:00Z')!;
    expect(again.event).toBeNull();
    expect(again.next.observations).toBe(2);
  });
});

describe('incident notifications (captured Slack messages)', () => {
  it('(a) repeated identical failure → one message, then silent', async () => {
    const store = memoryStore(); const { sent, send } = capture();
    await pass(store, [SAVED_SEARCH()], '2026-10-01T12:00:00Z', send);
    const r2 = await pass(store, [SAVED_SEARCH()], '2026-10-01T15:00:00Z', send);
    const r3 = await pass(store, [SAVED_SEARCH()], '2026-10-01T18:00:00Z', send);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Cron watchdog: 1 opened');
    expect(sent[0].text).toContain('🔴 OPENED saved-search-alerts — processing failures: unexpected_schedule_error=1');
    expect(sent[0].text).toContain('🛡️ Recipient suppression (not an outage): 3 email(s) blocked by the send guard (email_send_rejected=3)');
    expect(r2.silentRepeats).toEqual(['failing:saved-search-alerts']);
    expect(r3.silentRepeats).toEqual(['failing:saved-search-alerts']);
    expect(store.rows.get('failing:saved-search-alerts')!.observations).toBe(3);
  });

  it('(b) materially different failure → new message', async () => {
    const store = memoryStore(); const { sent, send } = capture();
    await pass(store, [EPA()], '2026-10-04T15:00:00Z', send);
    await pass(store, [EPA()], '2026-10-04T18:00:00Z', send);
    await pass(store, [EPA('error', 'instance_read: permission denied for table data_source_instances')], '2026-10-04T21:00:00Z', send);
    expect(sent.map((m) => m.subject)).toEqual(['Cron watchdog: 1 opened', 'Cron watchdog: 1 changed']);
    expect(sent[0].text).toContain('🔴 OPENED epa-source-watch — this operation was aborted');
    expect(sent[1].text).toContain('🔁 CHANGED epa-source-watch — was [msg:this operation was aborted], now instance_read: permission denied for table data_source_instances');
  });

  it('(c) worsening customer impact → message; more suppressed sends alone → silent', async () => {
    const store = memoryStore(); const { sent, send } = capture();
    await pass(store, [SAVED_SEARCH()], '2026-10-01T12:00:00Z', send);
    await pass(store, [SAVED_SEARCH('unexpected_schedule_error=1,email_send_rejected=9')], '2026-10-01T15:00:00Z', send);
    await pass(store, [SAVED_SEARCH('unexpected_schedule_error=3,email_send_rejected=9')], '2026-10-01T18:00:00Z', send);
    await pass(store, [SAVED_SEARCH('unexpected_schedule_error=2,email_send_rejected=9')], '2026-10-01T21:00:00Z', send);
    expect(sent.map((m) => m.subject)).toEqual(['Cron watchdog: 1 opened', 'Cron watchdog: 1 worsened']);
    expect(sent[1].text).toContain('📈 WORSENED saved-search-alerts — unexpected_schedule_error 1→3');
  });

  it('(d) recovery → exactly one message; re-failure reopens', async () => {
    const store = memoryStore(); const { sent, send } = capture();
    await pass(store, [SAVED_SEARCH(), EPA()], '2026-10-04T15:00:00Z', send);
    await pass(store, [SAVED_SEARCH()], '2026-10-04T21:00:00Z', send);
    await pass(store, [SAVED_SEARCH()], '2026-10-05T00:00:00Z', send);
    expect(sent.map((m) => m.subject)).toEqual(['Cron watchdog: 2 opened', 'Cron watchdog: 1 recovered']);
    expect(sent[1].text).toMatch(/✅ RECOVERED epa-source-watch — cleared after 1 watchdog pass\(es\) over 6h/);
    await pass(store, [SAVED_SEARCH(), EPA()], '2026-10-05T03:00:00Z', send);
    expect(sent[2].subject).toBe('Cron watchdog: 1 opened');
    expect(sent[2].text).toContain('OPENED epa-source-watch');
  });

  it('(e) persistent unchanged incidents → one daily summary per UTC day', async () => {
    const store = memoryStore(); const { sent, send } = capture();
    await pass(store, [SAVED_SEARCH(), EPA()], '2026-10-04T15:00:00Z', send);
    // Next day: first pass before 12:00 UTC says nothing; the 12:00 pass sends ONE summary.
    await pass(store, [SAVED_SEARCH(), EPA()], '2026-10-05T09:00:00Z', send);
    const noon = await pass(store, [SAVED_SEARCH(), EPA()], '2026-10-05T12:00:00Z', send);
    await pass(store, [SAVED_SEARCH(), EPA()], '2026-10-05T15:00:00Z', send);
    expect(sent.map((m) => m.subject)).toEqual([
      'Cron watchdog: 2 opened',
      'Cron watchdog daily summary: 2 open incident(s), unchanged',
    ]);
    expect(noon.summarySent).toBe(true);
    const s = sent[1].text;
    expect(s).toContain('• saved-search-alerts — open 21h, 3 pass(es), unexpected_schedule_error=1 — last failed run 2026-10-04T11:00Z (error)');
    expect(s).toContain('🛡️ Recipient suppression (not an outage): 3 email(s)');
    expect(s).toContain('• epa-source-watch — open 21h, 3 pass(es), this operation was aborted — last failed run 2026-10-04T14:50Z (timeout)');
  });

  it('suppression-only failure is an actionable item, not an outage, and does not re-page', async () => {
    const store = memoryStore(); const { sent, send } = capture();
    await pass(store, [SAVED_SEARCH('email_send_rejected=3', '2026-09-30T11:00')], '2026-10-01T09:00:00Z', send);
    await pass(store, [SAVED_SEARCH('email_send_rejected=5')], '2026-10-01T12:00:00Z', send);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Cron watchdog: 1 suppression opened');
    expect(sent[0].text).toContain('🛡️ SUPPRESSION saved-search-alerts — no processing failure');
    expect(sent[0].text).not.toContain('OPENED');
    // A malformed customer search arriving on top escalates — it is never hidden by the suppression.
    await pass(store, [SAVED_SEARCH('unexpected_schedule_error=1,email_send_rejected=3')], '2026-10-01T15:00:00Z', send);
    expect(sent[1].subject).toBe('Cron watchdog: 1 changed');
    expect(sent[1].text).toContain('🔁 CHANGED saved-search-alerts — was [suppression-only], now processing failures: unexpected_schedule_error=1');
  });

  it('(f) overlapping watchdog runs → exactly one message', async () => {
    const store = memoryStore(); const a = capture(); const b = capture();
    const [ra, rb] = await Promise.all([
      pass(store, [SAVED_SEARCH(), EPA()], '2026-10-05T06:00:00Z', a.send),
      pass(store, [SAVED_SEARCH(), EPA()], '2026-10-05T06:00:01Z', b.send),
    ]);
    expect(a.sent.length + b.sent.length).toBe(1);
    expect([...ra.lostRaces, ...rb.lostRaces].sort()).toEqual(['failing:epa-source-watch', 'failing:saved-search-alerts']);
    // And overlapping on an EXISTING incident that worsens.
    const [rc, rd] = await Promise.all([
      pass(store, [SAVED_SEARCH('unexpected_schedule_error=2,email_send_rejected=3'), EPA()], '2026-10-05T09:00:00Z', a.send),
      pass(store, [SAVED_SEARCH('unexpected_schedule_error=2,email_send_rejected=3'), EPA()], '2026-10-05T09:00:01Z', b.send),
    ]);
    const worsened = [...a.sent, ...b.sent].filter((m) => m.subject.includes('worsened'));
    expect(worsened).toHaveLength(1);
    expect(rc.claimed.length + rd.claimed.length).toBe(1);
  });

  it('a failed post is retried after the lease, never by a concurrent run before it', async () => {
    const store = memoryStore();
    const failing = { sent: [] as Captured[], send: async () => ({ ok: false }) };
    const r1 = await runWatchdogIncidents({ store, source: SRC, observations: [EPA()], now: new Date('2026-10-04T15:00:00Z'), send: failing.send });
    expect(r1.sent).toBe(false);
    expect(store.rows.get('failing:epa-source-watch')!.notify_pending).toBe('opened');
    const { sent, send } = capture();
    await pass(store, [EPA()], new Date(Date.parse('2026-10-04T15:00:00Z') + PENDING_RETRY_LEASE_MS - 1000).toISOString(), send);
    expect(sent).toHaveLength(0);
    await pass(store, [EPA()], '2026-10-04T18:00:00Z', send);
    expect(sent.map((m) => m.subject)).toEqual(['Cron watchdog: 1 opened']);
    expect(store.rows.get('failing:epa-source-watch')!.notify_pending).toBeNull();
  });

  it('store unavailable → reports it so the route falls back to the legacy alert', async () => {
    const store = memoryStore(); store.failList = true; const { sent, send } = capture();
    const r = await pass(store, [SAVED_SEARCH()], '2026-10-05T06:00:00Z', send);
    expect(r.storeAvailable).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('preview writes nothing and sends nothing', async () => {
    const store = memoryStore(); const { sent, send } = capture();
    const r = await runWatchdogIncidents({ store, source: SRC, observations: [SAVED_SEARCH()], now: new Date('2026-10-05T06:00:00Z'), send, preview: true });
    expect(r.messages[0].subject).toBe('Cron watchdog: 1 opened');
    expect(sent).toHaveLength(0);
    expect(store.rows.size).toBe(0);
  });
});
