/**
 * Agent 4 release driver: the DECISION CORE (pure logic behind an injectable port).
 * scripts/agent-release.mts wires it to GitHub (gh api), production (fetch) and local git.
 *
 * Every run rebuilds state from GitHub, takes ONE bounded step, and exits. It never sleeps long.
 * The caller (Agent 4's session) schedules the next run.
 *
 *  (a) A merge of ours is awaiting verification (from release records, or a lock naming a merged PR, which
 *      covers a crash between merge and record). If production's build stamp contains that merge, run the
 *      production checks, record the result and label the PR agent4:released. If not, wait. A restart in
 *      this state RESUMES verification and NEVER merges again.
 *  (b) Otherwise pick the oldest eligible PR: on the checked-in allowlist (scripts/agent-release.allow.json)
 *      AND with a valid review record for the exact head. Then gate it: CI `verify` green on that head,
 *      mergeable, production == main, the merged tree type-checks, and the production checks pass on the
 *      live deploy BEFORE merging. Then take the ATOMIC lock and merge pinned to the reviewed SHA, record
 *      it, and exit. Success after a merge = production serves a commit that CONTAINS the merge.
 *
 * Trust: labels are hints and never authorize. Authorization is the latest review-record comment (a
 * fenced ```agent4-review JSON block). It must be posted after the head commit's timestamp, never edited
 * (updated_at == created_at), match the head SHA, and carry Eric's approval for YELLOW/RED. All agents
 * share one GitHub identity, so this is TAMPER-EVIDENT, NOT TAMPER-PROOF.
 *
 * Never runs vercel. Dry-run is the default; the CLI applies actions only with --execute.
 */

export const LOCK_REF = 'refs/agent4/release-lock';
export const LOCK_TTL_MS = 45 * 60_000;
export const MAX_ATTEMPTS = 3;
export const LABELS = {
  ready: 'agent4:ready', changes: 'agent4:changes', green: 'agent4:green', yellow: 'agent4:yellow', red: 'agent4:red',
  released: 'agent4:released', blocked: 'agent4:blocked',
} as const;

/**
 * Eligibility is an explicit allowlist (scripts/agent-release.allow.json, maintained by Agent 4) of PR numbers
 * and/or exact branch names, AND a valid review record. Branch prefixes alone are not safe: builders use
 * feat/, fix/, docs/, chore/ and claude/. Branden's team (claude/team-*) is excluded even if listed.
 */
export const EXCLUDED_BRANCH_PREFIXES = ['claude/team-'] as const;
export interface Allowlist { prs: number[]; branches: string[] }

export type ReviewClass = 'GREEN' | 'YELLOW' | 'RED';

export interface Pr {
  number: number;
  draft: boolean;
  state: 'open' | 'closed';
  merged?: boolean;
  merge_commit_sha?: string | null;
  created_at: string;
  head: { sha: string; ref: string };
  base: { ref: string };
  mergeable: boolean | null;
  labels: string[];
}
export interface Comment { id: number; body: string; created_at: string; updated_at: string }
export interface ReviewRecord {
  reviewer: 'agent4';
  reviewed_sha: string;
  class: ReviewClass;
  checks: string[];
  eric_approval?: { quote: string; at: string } | null;
}
export interface ReleaseRecord {
  type: 'release';
  pr: number;
  status: 'merged' | 'released' | 'verify_failed' | 'attempt_failed' | 'blocked';
  sha: string;
  merge_commit?: string;
  reason?: string;
  at: string;
}
export interface LockPayload { owner: string; pr: number; sha: string; expires_at: string }
/** The lock as read: its payload and the commit the lock ref points at (the compare-and-swap token). */
export interface LockState { payload: LockPayload; commit: string }
export type Compare = 'identical' | 'ahead' | 'behind' | 'diverged';

export interface Port {
  now(): number;
  openPrs(): Promise<Pr[]>;
  allowlist(): Promise<Allowlist>;
  /** Recently merged PRs into main (newest first, bounded). */
  recentlyMergedPrs(): Promise<Pr[]>;
  pr(n: number): Promise<Pr>;
  comments(n: number): Promise<Comment[]>;
  commitDate(sha: string): Promise<string>;
  verifyState(sha: string): Promise<'success' | 'pending' | 'failure' | 'missing'>;
  mainSha(): Promise<string>;
  /** Production build stamp (a commit sha), or null when it can't be read. */
  productionSha(): Promise<string | null>;
  /** How `head` relates to `base` in commit history. */
  compare(base: string, head: string): Promise<Compare>;
  typecheckMerged(pr: number, sha: string): Promise<{ ok: boolean; detail: string }>;
  /** The production checks against the live deploy; `expectedSha` must prefix the live build stamp. */
  prodChecks(expectedSha: string): Promise<{ ok: boolean; results: Array<{ name: string; ok: boolean; detail: string }> }>;
  // writes (the CLI calls these only with --execute)
  merge(n: number, sha: string): Promise<{ merged: boolean; merge_commit?: string; message?: string }>;
  comment(n: number, body: string): Promise<void>;
  addLabels(n: number, labels: string[]): Promise<void>;
  // Atomic lock. createLock: ref create, fails (false) if the ref exists. takeOverLock: ref update with
  // force=false to a new commit whose PARENT is `expectedCommit`: a fast-forward only from that exact old
  // lock, so of two concurrent takeovers exactly one wins (the other gets 422 / not a fast-forward → false).
  readLock(): Promise<LockState | null>;
  createLock(p: LockPayload): Promise<boolean>;
  takeOverLock(expectedCommit: string, p: LockPayload): Promise<boolean>;
  deleteLock(): Promise<void>;
}

// ── records ──────────────────────────────────────────────────────────────────────────────────────

function fenced(body: string, tag: string): unknown[] {
  const out: unknown[] = [];
  const re = new RegExp('```' + tag + '\\s*\\n([\\s\\S]*?)\\n```', 'g');
  for (const m of body.matchAll(re)) { try { out.push(JSON.parse(m[1])); } catch { /* not a record */ } }
  return out;
}

export function releaseRecordBody(r: ReleaseRecord, note = ''): string {
  return `${note ? note + '\n\n' : ''}\`\`\`agent4-release\n${JSON.stringify(r)}\n\`\`\`\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_`;
}

export function releaseRecords(comments: Comment[]): ReleaseRecord[] {
  return comments.flatMap((c) => fenced(c.body, 'agent4-release') as ReleaseRecord[])
    .filter((r) => r && r.type === 'release' && typeof r.pr === 'number');
}

function isReviewRecord(x: unknown): x is ReviewRecord {
  const r = x as ReviewRecord;
  return !!r && r.reviewer === 'agent4' && typeof r.reviewed_sha === 'string' && /^[0-9a-f]{40}$/.test(r.reviewed_sha)
    && (r.class === 'GREEN' || r.class === 'YELLOW' || r.class === 'RED') && Array.isArray(r.checks);
}

export type ReviewVerdict = { ok: true; record: ReviewRecord } | { ok: false; reason: string };

/** The latest review record, held to the trust rules. */
export function validateReview(comments: Comment[], headSha: string, headCommitDate: string): ReviewVerdict {
  const withRecords = comments
    .map((c) => ({ c, recs: fenced(c.body, 'agent4-review').filter(isReviewRecord) }))
    .filter((x) => x.recs.length > 0)
    .sort((a, b) => Date.parse(a.c.created_at) - Date.parse(b.c.created_at));
  if (!withRecords.length) return { ok: false, reason: 'no review record' };
  const latest = withRecords[withRecords.length - 1];
  const record = latest.recs[latest.recs.length - 1];
  if (latest.c.updated_at !== latest.c.created_at) return { ok: false, reason: 'review record was edited' };
  if (Date.parse(latest.c.created_at) <= Date.parse(headCommitDate)) return { ok: false, reason: 'review record predates the head commit' };
  if (record.reviewed_sha !== headSha) return { ok: false, reason: 'reviewed SHA moved (head is not the reviewed commit)' };
  if (record.class !== 'GREEN') {
    const a = record.eric_approval;
    if (!a || typeof a.quote !== 'string' || !a.quote.trim() || typeof a.at !== 'string' || !Number.isFinite(Date.parse(a.at))) {
      return { ok: false, reason: `${record.class} without Eric's approval` };
    }
  }
  return { ok: true, record };
}

export function isAllowed(pr: Pick<Pr, 'number' | 'head'>, allow: Allowlist): boolean {
  if (EXCLUDED_BRANCH_PREFIXES.some((p) => pr.head.ref.startsWith(p))) return false;
  return allow.prs.includes(pr.number) || allow.branches.includes(pr.head.ref);
}

/** The production build stamp "contains" an expected SHA when that SHA is a prefix of it (empty = unknown). */
export function stampMatches(stamp: string | null, expected: string): boolean {
  return !!stamp && !!expected && stamp.toLowerCase().startsWith(expected.toLowerCase());
}

/** Failed attempts for THIS head commit: a fixed and re-reviewed head starts again from zero. */
export function failedAttempts(records: ReleaseRecord[], pr: number, sha: string): number {
  return records.filter((r) => r.pr === pr && r.sha === sha && r.status === 'attempt_failed').length;
}

// ── decisions ────────────────────────────────────────────────────────────────────────────────────

export type Action =
  | { do: 'acquire_lock'; payload: LockPayload }
  | { do: 'merge'; pr: number; sha: string }
  | { do: 'record'; pr: number; record: ReleaseRecord; note?: string }
  | { do: 'label'; pr: number; labels: string[] }
  | { do: 'release_lock' }
  | { do: 'take_over_lock'; payload: LockPayload; expectedCommit: string };

export interface Decision {
  kind: 'verify' | 'wait' | 'merge' | 'refuse' | 'blocked' | 'idle';
  pr?: number;
  reasons: string[];
  actions: Action[];
}

interface Pending { pr: number; sha: string; merge_commit: string | null }

const RESOLVED: ReleaseRecord['status'][] = ['released', 'verify_failed', 'blocked'];

/**
 * Every merge of ours that is not yet resolved (released / verify_failed / blocked), reconciled from GITHUB
 * STATE, not trusted from the lock alone. A merged PR counts as ours when:
 *  - the lock names it; or
 *  - it carries a 'merged' release record; or
 *  - it is allowlisted and its latest review record names its merged head (a crash between the merge and
 *    its record, after the lock expired or was taken over).
 * While any is unresolved, nothing else merges.
 */
async function pendingVerification(port: Port): Promise<Pending | null> {
  const lock = await port.readLock();
  const allow = await port.allowlist();
  const merged = new Map<number, Pr>();
  for (const p of await port.recentlyMergedPrs()) merged.set(p.number, p);
  if (lock && !merged.has(lock.payload.pr)) {
    const p = await port.pr(lock.payload.pr);
    if (p.merged) merged.set(p.number, p);
  }
  // Oldest first, so an older unresolved merge is verified before a newer one.
  for (const p of [...merged.values()].sort((a, b) => a.number - b.number)) {
    if (p.labels.includes(LABELS.released)) continue;
    const comments = await port.comments(p.number);
    const recs = releaseRecords(comments).filter((r) => r.pr === p.number);
    if (recs.some((r) => RESOLVED.includes(r.status))) continue;
    const mergedRec = recs.find((r) => r.status === 'merged');
    const lockedHere = !!lock && lock.payload.pr === p.number;
    let reviewedHere = false;
    if (!mergedRec && !lockedHere && isAllowed(p, allow)) {
      const fenced = comments.flatMap((c) => [...c.body.matchAll(/```agent4-review\s*\n([\s\S]*?)\n```/g)].map((m) => { try { return JSON.parse(m[1]) as ReviewRecord; } catch { return null; } })).filter(isReviewRecord);
      reviewedHere = fenced.length > 0 && fenced[fenced.length - 1].reviewed_sha === p.head.sha;
    }
    if (!mergedRec && !lockedHere && !reviewedHere) continue;
    return { pr: p.number, sha: mergedRec?.sha ?? (lockedHere ? lock!.payload.sha : p.head.sha), merge_commit: mergedRec?.merge_commit ?? p.merge_commit_sha ?? null };
  }
  return null;
}

async function verifyStep(port: Port, pend: Pending): Promise<Decision> {
  const nowIso = new Date(port.now()).toISOString();
  const prod = await port.productionSha();
  if (!prod) return { kind: 'wait', pr: pend.pr, reasons: ['production build stamp unreadable'], actions: [] };
  if (!pend.merge_commit) return { kind: 'wait', pr: pend.pr, reasons: ['merge commit not known yet'], actions: [] };
  // Success = production serves a commit that CONTAINS the merge (main keeps moving; live rarely == merge).
  const rel = stampMatches(prod, pend.merge_commit) ? 'identical' : await port.compare(pend.merge_commit, prod);
  if (rel !== 'identical' && rel !== 'ahead') {
    return { kind: 'wait', pr: pend.pr, reasons: [`#${pend.pr} merged but not live yet (production ${prod.slice(0, 8)})`], actions: [] };
  }
  const checks = await port.prodChecks(prod);
  const summary = checks.results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` — ${r.detail}`}`).join('\n');
  const record: ReleaseRecord = { type: 'release', pr: pend.pr, status: checks.ok ? 'released' : 'verify_failed', sha: pend.sha, merge_commit: pend.merge_commit, at: nowIso };
  return {
    kind: 'verify',
    pr: pend.pr,
    reasons: [checks.ok ? 'live and production checks pass' : 'live but production checks FAILED'],
    actions: [
      { do: 'record', pr: pend.pr, record, note: `Production verification (${prod.slice(0, 8)}):\n\n${summary}` },
      { do: 'label', pr: pend.pr, labels: [checks.ok ? LABELS.released : LABELS.blocked] },
      { do: 'release_lock' },
    ],
  };
}

/** One bounded step. Pure: reads through the port, returns the actions to apply. */
export async function decide(port: Port): Promise<Decision> {
  const pend = await pendingVerification(port);
  if (pend) return verifyStep(port, pend);

  const lock = await port.readLock();
  const now = port.now();
  let takeOver: LockState | null = null;
  if (lock) {
    if (Date.parse(lock.payload.expires_at) > now) return { kind: 'wait', pr: lock.payload.pr, reasons: [`release lock held for #${lock.payload.pr} until ${lock.payload.expires_at}`], actions: [] };
    takeOver = lock; // expired, and the reconciliation above found nothing unresolved
  }

  const [main, prod] = await Promise.all([port.mainSha(), port.productionSha()]);
  if (!stampMatches(prod, main)) return { kind: 'wait', reasons: [`production (${prod ? prod.slice(0, 8) : 'unreadable'}) is not main (${main.slice(0, 8)})`], actions: [] };

  const allow = await port.allowlist();
  const candidates = (await port.openPrs())
    .filter((p) => p.state === 'open' && !p.draft && p.base.ref === 'main' && isAllowed(p, allow) && !p.labels.includes(LABELS.blocked))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number);

  const skipped: string[] = [];
  for (const c of candidates) {
    const comments = await port.comments(c.number);
    const records = releaseRecords(comments);
    if (records.some((r) => r.status === 'blocked' && r.sha === c.head.sha)) { skipped.push(`#${c.number}: blocked at this head`); continue; }
    if (failedAttempts(records, c.number, c.head.sha) >= MAX_ATTEMPTS) {
      const record: ReleaseRecord = { type: 'release', pr: c.number, status: 'blocked', sha: c.head.sha, reason: `${MAX_ATTEMPTS} failed attempts`, at: new Date(now).toISOString() };
      return { kind: 'blocked', pr: c.number, reasons: [`${MAX_ATTEMPTS} failed attempts`], actions: [{ do: 'record', pr: c.number, record }, { do: 'label', pr: c.number, labels: [LABELS.blocked] }] };
    }
    const review = validateReview(comments, c.head.sha, await port.commitDate(c.head.sha));
    if (!review.ok) { skipped.push(`#${c.number}: ${review.reason}`); continue; }

    const refuse = (reason: string): Decision => ({
      kind: 'refuse', pr: c.number, reasons: [reason],
      actions: [{ do: 'record', pr: c.number, record: { type: 'release', pr: c.number, status: 'attempt_failed', sha: c.head.sha, reason, at: new Date(now).toISOString() } }],
    });
    const ci = await port.verifyState(c.head.sha);
    if (ci === 'pending' || ci === 'missing') { skipped.push(`#${c.number}: CI verify ${ci}`); continue; }
    if (ci === 'failure') return refuse('CI verify is red on the reviewed head');
    if (c.mergeable === null) { skipped.push(`#${c.number}: mergeability not computed yet`); continue; }
    if (c.mergeable === false) return refuse('not mergeable with main (conflict)');
    const tc = await port.typecheckMerged(c.number, c.head.sha);
    if (!tc.ok) return refuse(`merged tree does not type-check: ${tc.detail}`);
    // Production must be healthy BEFORE we add to it; a failure here is not this PR's fault, so wait.
    const pre = await port.prodChecks(main);
    if (!pre.ok) return { kind: 'wait', pr: c.number, reasons: [`production checks fail before merging: ${pre.results.filter((r) => !r.ok).map((r) => r.name).join(', ')}`], actions: [] };

    const payload: LockPayload = { owner: 'agent4-release', pr: c.number, sha: c.head.sha, expires_at: new Date(now + LOCK_TTL_MS).toISOString() };
    return {
      kind: 'merge', pr: c.number,
      reasons: [`${review.record.class} reviewed at ${c.head.sha.slice(0, 8)}; CI green; mergeable; type-checks`],
      actions: [
        takeOver ? { do: 'take_over_lock', payload, expectedCommit: takeOver.commit } : { do: 'acquire_lock', payload },
        { do: 'merge', pr: c.number, sha: c.head.sha },
        { do: 'record', pr: c.number, record: { type: 'release', pr: c.number, status: 'merged', sha: c.head.sha, at: new Date(now).toISOString() } },
      ],
    };
  }
  return { kind: 'idle', reasons: skipped.length ? skipped : ['nothing eligible'], actions: [] };
}

// ── apply (only with --execute) ──────────────────────────────────────────────────────────────────

export interface ApplyResult { applied: string[]; stopped?: string }

/**
 * Applies a decision's actions in order. Lock acquisition is the compare-and-swap. If it fails (another
 * run holds it), nothing else runs. A failed merge is recorded as an attempt and the lock is released.
 * The 'merged' record carries the real merge commit.
 */
export async function apply(port: Port, d: Decision): Promise<ApplyResult> {
  const applied: string[] = [];
  let mergeCommit: string | undefined;
  for (const a of d.actions) {
    if (a.do === 'acquire_lock') {
      if (!(await port.createLock(a.payload))) return { applied, stopped: 'another run holds the release lock' };
      applied.push(`lock #${a.payload.pr}`);
    } else if (a.do === 'take_over_lock') {
      // Atomic: succeeds only if the ref still points at the exact expired lock we decided on. Never
      // delete-then-create, where two runners could both delete and one recreate.
      if (!(await port.takeOverLock(a.expectedCommit, a.payload))) return { applied, stopped: 'another run took over the expired lock' };
      applied.push(`took over lock for #${a.payload.pr}`);
    } else if (a.do === 'merge') {
      const live = await port.pr(a.pr);
      if (live.head.sha !== a.sha) { await port.deleteLock(); return { applied, stopped: 'head moved after the decision' }; }
      const m = await port.merge(a.pr, a.sha);
      if (!m.merged) {
        const reason = `merge refused: ${m.message || 'unknown'}`;
        await port.comment(a.pr, releaseRecordBody({ type: 'release', pr: a.pr, status: 'attempt_failed', sha: a.sha, reason, at: new Date(port.now()).toISOString() }));
        await port.deleteLock();
        return { applied, stopped: reason };
      }
      mergeCommit = m.merge_commit;
      applied.push(`merged #${a.pr} at ${a.sha.slice(0, 8)}`);
    } else if (a.do === 'record') {
      const rec = a.record.status === 'merged' && mergeCommit ? { ...a.record, merge_commit: mergeCommit } : a.record;
      await port.comment(a.pr, releaseRecordBody(rec, a.note));
      applied.push(`record ${rec.status} on #${a.pr}`);
    } else if (a.do === 'label') {
      await port.addLabels(a.pr, a.labels);
      applied.push(`label #${a.pr} ${a.labels.join(',')}`);
    } else if (a.do === 'release_lock') {
      await port.deleteLock();
      applied.push('lock released');
    }
  }
  return { applied };
}
