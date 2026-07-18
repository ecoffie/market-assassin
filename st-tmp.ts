import { config } from 'dotenv'; config({ path: '.env.local' });
import { Client } from 'pg';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 });
  await c.connect();
  const e='demo@getmindy.ai';
  const { rows:[b] } = await c.query(`SELECT balance FROM mcp_credit_balance WHERE user_email=$1`,[e]);
  const { rows:[v] } = await c.query(`SELECT legal_name, uei FROM user_identity_profile WHERE user_email=$1`,[e]);
  const { rows:[pp] } = await c.query(`SELECT count(*)::int n FROM user_past_performance WHERE user_email=$1`,[e]);
  const { rows:[crm] } = await c.query(`SELECT provider, location_id FROM user_crm_connections WHERE user_email=$1`,[e]);
  const { rows:[ns] } = await c.query(`SELECT array_length(naics_codes,1) naics, array_length(keywords,1) kw FROM user_notification_settings WHERE user_email=$1`,[e]);
  console.log(`  balance:  ${b?.balance}`);
  console.log(`  vault:    ${v?.legal_name} (${v?.uei}), ${pp.n} past-perf`);
  console.log(`  targeting:${ns?.naics} NAICS, ${ns?.kw} keywords`);
  console.log(`  CRM:      ${crm ? crm.provider+' '+crm.location_id : 'NOT connected'}`);
  await c.end();
})().catch(e=>console.error('  '+e.message));
