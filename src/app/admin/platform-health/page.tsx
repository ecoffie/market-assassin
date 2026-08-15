'use client';
/**
 * /admin/platform-health — the Observatory measuring itself.
 *
 * Eric 2026-08-15: *"Not because customers need it. Because YOU need it… Nobody has to infer
 * anything."* Built after I reported data as stale without measuring it — see
 * `src/lib/analytics/platform-health.ts` for the full origin and the one rule it enforces.
 *
 * DESIGN CONSEQUENCE OF THAT RULE: the "Not measured" block is at the TOP, not buried at the
 * bottom. What we could NOT verify is the most decision-relevant thing on the page — it is exactly
 * the gap that let a wrong claim stand. A dashboard that shows only what it knows, in the same
 * visual weight as what it doesn't, is how the original mistake happens again.
 *
 * Same dark console styling as /admin/map-funnel and /admin/competition-health.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';

type Status = 'healthy' | 'degraded' | 'failed' | 'unknown';
interface Dataset {
  key: string; name: string; category: string; cadence: string;
  lastBuilt: string | null; daysSinceBuilt: number | null; recordCount: number | null;
  status: Status; blockedBy?: string; detail: string;
}
interface Job {
  jobName: string; cronExpr: string; lastRunAt: string | null; lastStatus: string | null;
  hoursSinceRun: number | null; status: Status; detail: string;
}
interface Health {
  datasets: Dataset[]; jobs: Job[];
  unmeasured: Array<{ check: string; blockedBy: string }>;
  generatedAt: string; degraded: boolean;
}

/** Status → dot + label. `unknown` is deliberately GREY, not red: "not measured" ≠ "broken". */
const TONE: Record<Status, { dot: string; text: string; label: string }> = {
  healthy: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Healthy' },
  degraded: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Delayed' },
  failed: { dot: 'bg-red-400', text: 'text-red-300', label: 'Failed' },
  unknown: { dot: 'bg-slate-500', text: 'text-slate-400', label: 'Not measured' },
};

function Pill({ s }: { s: Status }) {
  const t = TONE[s];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${t.text}`}>
      <span className={`h-2 w-2 rounded-full ${t.dot}`} />
      {t.label}
    </span>
  );
}

export default function PlatformHealthPage() {
  const [password, setPassword] = useState('');
  const [pwInput, setPwInput] = useState('');
  const [authed, setAuthed] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async (pw: string) => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/admin/platform-health?password=${encodeURIComponent(pw)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'failed');
      setHealth(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('ma_admin_pw') : null;
    if (stored) { setPassword(stored); setAuthed(true); load(stored); }
  }, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    localStorage.setItem('ma_admin_pw', pwInput);
    setPassword(pwInput); setAuthed(true); load(pwInput);
  };

  if (!authed) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-slate-100">
        <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-white/10 bg-white/5 p-6">
          <h1 className="mb-4 text-lg font-semibold">Platform Health</h1>
          <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)}
                 placeholder="Admin password" autoFocus
                 className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500" />
          <button type="submit" className="mt-3 w-full rounded-lg bg-sky-600 py-2 text-sm font-semibold hover:bg-sky-500">
            Unlock
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-sky-400">
          Mindy · Observatory · Self-measurement
        </div>
        <h1 className="text-2xl font-bold">Platform Health</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          The Observatory measures procurement. This measures the measurement system — data freshness,
          ingest health, and, most importantly, <strong className="text-slate-200">what we could not verify</strong>.
        </p>

        <button onClick={() => load(password)} disabled={loading}
                className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:border-white/25 disabled:opacity-50">
          {loading ? 'Checking…' : '↻ Re-check'}
        </button>

        {err && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>}

        {health && (
          <>
            {/* ── NOT MEASURED — deliberately FIRST. This is the block whose absence let a wrong
                 claim stand; burying it would repeat the original failure. ─────────────────── */}
            {health.unmeasured.length > 0 && (
              <section className="mt-6 rounded-xl border border-slate-500/30 bg-slate-500/5 p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <span className="h-2 w-2 rounded-full bg-slate-500" />
                  Not measured ({health.unmeasured.length})
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  These checks did not run. That is <em>not</em> the same as a failure — it means no claim
                  can be made either way, and each row names its blocker.
                </p>
                <ul className="mt-3 space-y-2">
                  {health.unmeasured.map((u) => (
                    <li key={u.check} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <div className="text-[13px] font-semibold text-slate-200">{u.check}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{u.blockedBy}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ── DATASETS ─────────────────────────────────────────────────────────────────── */}
            <section className="mt-6 rounded-xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-semibold">Data freshness</h2>
              <p className="mt-1 text-xs text-slate-400">
                Each source judged against <em>its own</em> declared cadence — a quarterly source 40 days
                old is healthy; a weekly one is not.
              </p>
              <div className="mt-4 space-y-1">
                {health.datasets.map((d) => (
                  <div key={d.key} className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-slate-100">{d.name}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{d.detail}</div>
                      {d.recordCount != null && (
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">{d.recordCount.toLocaleString()} records</div>
                      )}
                    </div>
                    <div className="pt-0.5"><Pill s={d.status} /></div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── JOBS ─────────────────────────────────────────────────────────────────────── */}
            <section className="mt-6 rounded-xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-semibold">Scheduled jobs</h2>
              <p className="mt-1 text-xs text-slate-400">
                A job stuck on <span className="font-mono">dispatched</span> reads as{' '}
                <span className="text-slate-300">Not measured</span>, never success — long jobs are ack&apos;d
                early by design, so a still-running job and a dead one look identical from here.
              </p>
              <div className="mt-4 space-y-1">
                {health.jobs.map((j) => (
                  <div key={j.jobName} className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[13px] text-slate-100">{j.jobName}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        <span className="font-mono text-slate-500">{j.cronExpr}</span> · {j.detail}
                      </div>
                    </div>
                    <div className="pt-0.5"><Pill s={j.status} /></div>
                  </div>
                ))}
              </div>
            </section>

            <footer className="mt-6 text-center text-xs text-slate-500">
              Checked {new Date(health.generatedAt).toLocaleString()}.
              {health.degraded && <span className="ml-1 text-amber-400">Some blocks failed to load — see &quot;Not measured&quot;.</span>}
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
