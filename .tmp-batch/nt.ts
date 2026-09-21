import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const today = new Date().toISOString();
async function main() {
  const types = ['Combined Synopsis/Solicitation','Solicitation','Presolicitation','Special Notice','Sources Sought','Award Notice','Justification','Sale of Surplus Property','Intent to Bundle Requirements (DoD-Funded)','Consolidate/(Substantially) Bundle'];
  for (const t of types) {
    const { count } = await db.from('sam_opportunities').select('*', { count: 'exact', head: true }).eq('active', true).gte('response_deadline', today).eq('notice_type', t);
    console.log(String(count).padStart(6), t);
  }
  console.log('\n--- the three screenshot notices ---');
  for (const sol of ['DCSAPSAMRFI2026001','FA441826Q0088','2032K826R00020']) {
    const { data } = await db.from('sam_opportunities').select('title, notice_type, set_aside_code, set_aside_description, naics_code, psc_code, response_deadline').eq('solicitation_number', sol).limit(1);
    console.log(sol, JSON.stringify(data?.[0]));
  }
}
main();
