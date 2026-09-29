/**
 * Sync monitoring/betterstack-monitors.json to Better Stack Uptime.
 *
 *   npx tsx scripts/betterstack-sync.ts                 dry run: prints create/update/unchanged/orphans
 *   npx tsx scripts/betterstack-sync.ts --apply         performs the creates and updates
 *   npx tsx scripts/betterstack-sync.ts --base-url=https://<preview>.vercel.app   dry run against a preview
 *
 * Env: BETTERSTACK_API_TOKEN (required, an Uptime API token), BETTERSTACK_POLICY_ID
 * (optional escalation policy that routes incidents to Slack #mindy-ops).
 *
 * Never deletes. Monitors whose name starts with the config prefix but are no
 * longer in the config are listed as orphans for a human to remove.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planSync, validateConfig, type MonitorConfig, type RemoteMonitor } from '../src/lib/monitoring/betterstack';

const API = 'https://uptime.betterstack.com/api/v2/monitors';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function api(method: string, url: string, token: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function listMonitors(token: string): Promise<RemoteMonitor[]> {
  const all: RemoteMonitor[] = [];
  let next: string | null = `${API}?per_page=250`;
  while (next) {
    const page = (await api('GET', next, token)) as { data: RemoteMonitor[]; pagination?: { next: string | null } };
    all.push(...page.data);
    next = page.pagination?.next ?? null;
  }
  return all;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const config: MonitorConfig = JSON.parse(readFileSync(resolve(__dirname, '../monitoring/betterstack-monitors.json'), 'utf8'));
  const errors = validateConfig(config);
  if (errors.length) {
    console.error('Config invalid:\n  ' + errors.join('\n  '));
    process.exit(1);
  }

  const token = process.env.BETTERSTACK_API_TOKEN;
  if (!token) {
    console.error('BETTERSTACK_API_TOKEN is not set. Create an Uptime API token in Better Stack (Settings -> API tokens).');
    process.exit(1);
  }

  const plan = planSync(config, await listMonitors(token), { baseUrl: arg('base-url'), policyId: process.env.BETTERSTACK_POLICY_ID });

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${plan.create.length} create, ${plan.update.length} update, ${plan.unchanged.length} unchanged, ${plan.orphans.length} orphan`);
  for (const c of plan.create) console.log(`  + ${c.pronounceable_name}  ${c.url}  (${c.monitor_type}, ${c.request_timeout}s timeout, confirm ${c.confirmation_period}s)`);
  for (const u of plan.update) console.log(`  ~ ${u.name}  ${Object.entries(u.changes).map(([k, v]) => `${k}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`).join(', ')}`);
  for (const o of plan.orphans) console.log(`  ? orphan (not deleted): ${o.name} [${o.id}]`);

  if (!apply) {
    console.log('\nNothing was changed. Re-run with --apply to write.');
    return;
  }
  for (const c of plan.create) await api('POST', API, token, c);
  for (const u of plan.update) await api('PATCH', `${API}/${u.id}`, token, u.payload);
  console.log('Applied.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
