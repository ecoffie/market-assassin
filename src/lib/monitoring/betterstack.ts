/**
 * Better Stack Uptime monitor planning: turns monitoring/betterstack-monitors.json
 * into the exact API payloads, and diffs them against the monitors that already
 * exist in the account. Pure: no network. scripts/betterstack-sync.ts does the I/O.
 *
 * Ownership rule: a remote monitor is ours only if its name starts with the
 * config's namePrefix. Matching is by full name, so renaming a monitor in the
 * config shows up as one create plus one orphan, never a silent rename.
 * The plan never deletes; orphans are reported for a human to remove.
 */

export type MonitorProfile = 'availability' | 'latency';

export interface MonitorSpec {
  key: string;
  name: string;
  path: string;
  profile: MonitorProfile;
  monitor_type: 'status' | 'keyword';
  required_keyword?: string;
}

export interface MonitorConfig {
  namePrefix: string;
  baseUrl: string;
  defaults: Record<string, unknown>;
  profiles: Record<MonitorProfile, { request_timeout: number; confirmation_period: number }>;
  monitors: MonitorSpec[];
}

export type MonitorPayload = Record<string, unknown> & { pronounceable_name: string; url: string };

export interface RemoteMonitor {
  id: string;
  attributes: Record<string, unknown>;
}

export interface MonitorPlan {
  create: MonitorPayload[];
  update: Array<{ id: string; name: string; changes: Record<string, { from: unknown; to: unknown }>; payload: MonitorPayload }>;
  unchanged: string[];
  orphans: Array<{ id: string; name: string }>;
}

// Better Stack's free tier allows 10 monitors; a config over budget is a bug, not a bill.
export const FREE_TIER_MONITOR_LIMIT = 10;

const ALLOWED_TIMEOUTS_S = [2, 3, 5, 10, 15, 30, 45, 60];

export function validateConfig(config: MonitorConfig): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const names = new Set<string>();
  if (!/^https:\/\/[^/]+$/.test(config.baseUrl)) errors.push(`baseUrl must be https://host with no trailing slash: ${config.baseUrl}`);
  if (config.monitors.length > FREE_TIER_MONITOR_LIMIT) {
    errors.push(`${config.monitors.length} monitors exceeds the ${FREE_TIER_MONITOR_LIMIT}-monitor free tier`);
  }
  for (const [name, p] of Object.entries(config.profiles)) {
    if (!ALLOWED_TIMEOUTS_S.includes(p.request_timeout)) errors.push(`profile ${name}: request_timeout ${p.request_timeout}s is not an allowed value`);
    if (Number(config.defaults.check_frequency) < p.request_timeout) errors.push(`profile ${name}: check_frequency must be >= request_timeout`);
  }
  for (const m of config.monitors) {
    if (keys.has(m.key)) errors.push(`duplicate key ${m.key}`);
    keys.add(m.key);
    const full = monitorName(config, m);
    if (names.has(full)) errors.push(`duplicate name ${full}`);
    names.add(full);
    if (!m.path.startsWith('/')) errors.push(`${m.key}: path must start with /`);
    if (!config.profiles[m.profile]) errors.push(`${m.key}: unknown profile ${m.profile}`);
    if (m.monitor_type === 'keyword' && !m.required_keyword) errors.push(`${m.key}: keyword monitor needs required_keyword`);
    if (m.monitor_type !== 'keyword' && m.required_keyword) errors.push(`${m.key}: required_keyword only applies to keyword monitors`);
  }
  return errors;
}

export function monitorName(config: MonitorConfig, m: MonitorSpec): string {
  return `${config.namePrefix} ${m.name}`;
}

/** The exact body sent to POST/PATCH /api/v2/monitors. `baseUrl` lets a dry run target a preview. */
export function desiredPayloads(config: MonitorConfig, opts: { baseUrl?: string; policyId?: string } = {}): MonitorPayload[] {
  const base = (opts.baseUrl || config.baseUrl).replace(/\/+$/, '');
  return config.monitors.map((m) => {
    const payload: MonitorPayload = {
      ...config.defaults,
      ...config.profiles[m.profile],
      monitor_type: m.monitor_type,
      pronounceable_name: monitorName(config, m),
      url: base + m.path,
    };
    if (m.required_keyword) payload.required_keyword = m.required_keyword;
    if (opts.policyId) payload.policy_id = opts.policyId;
    return payload;
  });
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && [...a].sort().join() === [...b].sort().join();
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function planSync(config: MonitorConfig, remote: RemoteMonitor[], opts: { baseUrl?: string; policyId?: string } = {}): MonitorPlan {
  const desired = desiredPayloads(config, opts);
  const byName = new Map(remote.map((r) => [String(r.attributes.pronounceable_name ?? ''), r]));
  const plan: MonitorPlan = { create: [], update: [], unchanged: [], orphans: [] };
  const wanted = new Set(desired.map((d) => d.pronounceable_name));

  for (const d of desired) {
    const existing = byName.get(d.pronounceable_name);
    if (!existing) {
      plan.create.push(d);
      continue;
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(d)) {
      if (!same(existing.attributes[k], v)) changes[k] = { from: existing.attributes[k], to: v };
    }
    if (Object.keys(changes).length) plan.update.push({ id: existing.id, name: d.pronounceable_name, changes, payload: d });
    else plan.unchanged.push(d.pronounceable_name);
  }

  for (const r of remote) {
    const name = String(r.attributes.pronounceable_name ?? '');
    if (name.startsWith(config.namePrefix + ' ') && !wanted.has(name)) plan.orphans.push({ id: r.id, name });
  }
  return plan;
}
