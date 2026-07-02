/**
 * Provision a Coach Mode enterprise/white-label organization + its org_admin.
 *
 * The clean way to stand up an NCMBC / SBDC / APEX tenant: creates the
 * organizations row (tier controls the client cap — enterprise = unlimited) and
 * adds the admin as an org_admin member. Idempotent on slug + (org, email).
 *
 *   npx tsx --env-file=.env.local scripts/provision-coach-org.ts \
 *     --name "NCMBC — North Carolina Military Business Center" \
 *     --slug ncmbc \
 *     --admin eric@govcongiants.com \
 *     --tier enterprise \
 *     --type apex \
 *     --tab "NCMBC"
 *
 * Required: --name, --slug, --admin. Optional: --tier (default enterprise),
 * --type (apex|sbdc|chamber|fhc|consultant|other, default other), --tab (Org Tab label).
 */
import { createClient } from '@supabase/supabase-js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const name = arg('--name');
const slug = arg('--slug');
const admin = (arg('--admin') || '').toLowerCase().trim();
const tier = arg('--tier') || 'enterprise';
const orgType = arg('--type') || 'other';
const tabLabel = arg('--tab') || 'Org Tab';

if (!name || !slug || !admin) {
  console.error('Required: --name "<org name>" --slug <slug> --admin <email>');
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  // 1) Upsert the org (idempotent on slug).
  const { data: existing } = await sb.from('organizations').select('id, tier').eq('slug', slug).maybeSingle();
  let orgId: string;
  if (existing) {
    orgId = existing.id;
    await sb.from('organizations').update({ name, org_type: orgType, tab_label: tabLabel, tier }).eq('id', orgId);
    console.log(`Org "${slug}" already existed → updated (tier=${tier}).`);
  } else {
    const { data, error } = await sb.from('organizations')
      .insert({ name, slug, org_type: orgType, tab_label: tabLabel, tier })
      .select('id').single();
    if (error) { console.error('Org insert failed:', error.message); process.exit(1); }
    orgId = data.id;
    console.log(`Created org "${name}" (${slug}) — id ${orgId}, tier ${tier}.`);
  }

  // 2) Add the admin as org_admin (idempotent on org+email).
  const { error: memErr } = await sb.from('org_members')
    .upsert({ org_id: orgId, user_email: admin, role: 'org_admin', status: 'active' },
      { onConflict: 'org_id,user_email' });
  if (memErr) { console.error('Member upsert failed:', memErr.message); process.exit(1); }
  console.log(`Added ${admin} as org_admin.`);

  // 3) Report client count.
  const { count } = await sb.from('org_clients').select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('status', 'active');
  console.log(`\nDONE. Org ${slug} has ${count ?? 0} active clients. Cap: ${tier === 'enterprise' ? 'unlimited' : '10 (grandfather)'}.`);
  console.log(`Admin ${admin} can now open /app → My Clients and bulk-import a roster.`);
})().catch((e) => { console.error(e); process.exit(1); });
