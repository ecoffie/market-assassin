import { config } from 'dotenv'; config({ path: '.env.local' });
import { Client } from 'pg';
import { kv } from '@vercel/kv';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const e='demo@getmindy.ai';
  const { rows:[b] } = await c.query(`SELECT balance FROM mcp_credit_balance WHERE user_email=$1`,[e]);
  const { rows:[v] } = await c.query(`SELECT count(*)::int n FROM user_past_performance WHERE user_email=$1`,[e]);
  const { rows:[crm] } = await c.query(`SELECT count(*)::int n FROM user_crm_connections WHERE user_email=$1`,[e]);
  const pro = await kv.get(`briefings:${e}`);
  console.log(`  balance ${b?.balance}  vault PP ${v.n}  CRM ${crm.n}  ${pro?'PRO ✗':'free ✓'}`);
  await c.end();
})().catch(e=>console.error('  '+e.message));
