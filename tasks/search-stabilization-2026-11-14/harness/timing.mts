// READ-ONLY timing of the Open text predicate (count exact, head) for the long-paragraph searches that 500 on the Map.
// usage: tsx timing.mts <cols comma list>   (runs each query 2x, reports clause count + ms + count/error)
import { createClient } from '@supabase/supabase-js';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MAPS_POLICY } from '@/lib/discovery/policy';
import { textPredicate } from '@/lib/discovery/matcher';
const cols = (process.argv[2] || 'title,description,sow_text,department,solicitation_number').split(',');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const Q = [
  'We are a commercial cleaning company. We provide janitorial and custodial services for office buildings: daily cleaning, restroom sanitation, trash removal, floor care, carpet cleaning and window washing.',
  'We are a healthcare staffing firm. We place registered nurses, licensed practical nurses, nursing assistants and other clinical staff in hospitals, clinics and medical facilities.',
  'We are a mechanical contractor. We maintain, repair and replace HVAC systems: heating, ventilation and air conditioning equipment, chillers, boilers, air handlers, rooftop units and building controls.',
  'We are a construction contractor. We erect pre-engineered steel buildings and install and replace metal roofing systems, including standing seam roofs, wall panels and structural steel framing.',
];
const now = new Date().toISOString();
for (const q of Q) {
  const plan: any = buildDiscoveryPlan({ query: q } as any, MAPS_POLICY);
  const pred = textPredicate(plan.matcher, cols)!;
  const clauses = (pred.match(/\.(i?match)\./g) || []).length;
  const res: string[] = [];
  for (let i = 0; i < 2; i++) {
    const t = Date.now();
    const { count, error } = await db.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true).gt('response_deadline', now).or(pred);
    res.push(`${Date.now() - t}ms ${error ? 'ERR ' + error.message.slice(0, 50) : count}`);
  }
  console.log(q.slice(0, 40).padEnd(42), `clauses=${clauses}`.padEnd(12), res.join(' | '));
}
