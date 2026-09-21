/**
 * Seed a TEST vault with Tavares LLC's REAL past performance, so the proposal
 * eval measures Mindy against genuine evidence instead of the placeholder stubs
 * that polluted eric@govcongiants.com (GovCon Giants is a nonprofit — no
 * contracts of its own; Tavares LLC is a real client whose data Eric authorized
 * for the eval).
 *
 * Source of truth: "The Vault/Capability Statement/Tavares Capability Statement
 * 2020.pdf" — every contract, value, agency, and scope below is transcribed from
 * that document. NOTHING invented. (ground_in_real_data.)
 *
 * Idempotent: deletes any prior rows for the test email, then re-inserts.
 *
 * Run:  npx tsx scripts/proposal-eval/seed-tavares-vault.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const EMAIL = 'tavares-eval@test.local';

const NAICS = ['236210', '236220', '238130', '238150', '238310', '238320', '238350', '562910'];

const identity = {
  user_email: EMAIL,
  legal_name: 'Tavares LLC',
  cage_code: '6PY01',
  duns: '006493690',
  year_founded: 2007,
  certifications: ['8(a)', 'SDB', 'Small Business'],
  primary_naics: NAICS,
  one_liner: 'Rhode Island-based 8(a)-certified general contractor providing general construction, demolition, and historical renovation services.',
  elevator_pitch:
    'Tavares LLC, established in 2007, is a Rhode Island-based, 8(a)-certified general contractor. Since inception we have completed over 200 projects, every job on time and within budget, with an EMR of .69 — among the best in the industry. We self-perform carpentry, painting, drywall, dust/noise protection, demolition, and project supervision for federal, state, and local procurements.',
  hq_state: 'RI',
  hq_city: 'Providence',
  service_states: ['RI', 'MA'],
  office_address: '124 Webster Avenue, Providence, RI 02909',
  contact_name: 'Fernando Tavares',
  contact_title: 'Sole Owner',
  contact_phone: '(401) 451-2584',
  contact_email: 'fernando@fjtavares.com',
  bonding_single: '15000000',
  bonding_aggregate: '15000000',
};

// Every row below is from the Tavares 2020 capability statement.
const pastPerf = [
  {
    contract_title: 'Boott Cotton Mills — Historic Window Replacement',
    agency: 'Department of the Interior',
    sub_agency: 'National Park Service',
    office: 'Lowell, MA',
    contract_value: 2942548,
    role: 'prime',
    scope_description:
      'Replaced approximately 335 deteriorated existing wood windows with new custom aluminum windows and repaired approximately 27 existing wood windows originally installed in 1980. Replacement windows typical of late-19th-century textile mills matched the operation, configuration, and historical appearance of the original 1871 windows.',
    relevance_keywords: ['historic renovation', 'window replacement', 'NPS', 'federal prime', 'historical preservation'],
    naics_codes: ['236220', '238150'],
  },
  {
    contract_title: 'South Street Landing Enabling — Demolition & Asbestos Abatement',
    agency: 'Gilbane Building Company',
    office: 'Providence, RI',
    contract_value: 5333602,
    role: 'sub',
    scope_description:
      'Paint removal on existing steel, miscellaneous metals, and brick/CMU; lead paint abatement; general demolition of concrete, wood, CMU, structural and non-structural steel, and steel decking from two houses, turbine hall, and dynamo hall; asbestos caulking removal from east/south/west elevations.',
    reference_name: 'Anthony Iaccarrino',
    reference_phone: '401.456.5800',
    relevance_keywords: ['demolition', 'asbestos abatement', 'lead paint removal', 'environmental remediation'],
    naics_codes: ['238910', '562910'],
  },
  {
    contract_title: 'Lowell Justice Center — Doors/Frames/Hardware',
    agency: 'DCAMM (Massachusetts)',
    sub_agency: 'Dimeo Construction Company (prime)',
    office: 'Lowell, MA',
    contract_value: 1921928,
    role: 'sub',
    scope_description:
      'Furnished and installed all interior/exterior hollow metal doors and frames for doors, transoms, sidelights, and borrow lights; flush wood doors, interior sound-control door assemblies, and mechanical and electrical finish hardware.',
    relevance_keywords: ['doors frames hardware', 'finish carpentry', 'institutional construction', 'courthouse'],
    naics_codes: ['238350', '236220'],
  },
  {
    contract_title: 'CambridgeSide Galleria Mall — Drywall & Demolition',
    agency: 'The Whiting-Turner Contracting Co. (prime)',
    office: 'Cambridge, MA',
    contract_value: 3245653,
    role: 'sub',
    scope_description:
      'Complete renovation of common areas (~200,000 s.f.) including new soffits at railings with built-in LED lighting, new drywall ceilings, removal of old column covers and wall finishes for new tile and covers. Provided daily cleanup and debris removal after other trades.',
    relevance_keywords: ['drywall', 'demolition', 'commercial renovation', 'occupied facility'],
    naics_codes: ['238310'],
  },
  {
    contract_title: 'Rhode Island Veterans Home — Windows',
    agency: 'East Coast Interiors (prime)',
    office: 'Bristol, RI',
    contract_value: 2113133,
    role: 'sub',
    scope_description:
      'Supplied and installed windows with screens; unloaded and stocked all windows, flashed window openings, installed pre-made window pans, caulked and installed windows, and flashed over window flange.',
    relevance_keywords: ['window installation', 'veterans facility', 'glazing'],
    naics_codes: ['238150'],
  },
  {
    contract_title: 'Citizens Bank Refresh Project — General Trades (Various NE Locations)',
    agency: 'Gilbane Building Company (prime)',
    office: 'New England',
    contract_value: 1522004,
    role: 'sub',
    scope_description:
      'Provided union carpentry, labor, and materials to renovate existing branches throughout New England — demolition, new walls, painting, ceilings, millwork, flooring, electrical, and HVAC. All locations remained open while work was performed nights and weekends.',
    relevance_keywords: ['general trades', 'carpentry', 'occupied renovation', 'multi-site'],
    naics_codes: ['236220', '238350'],
  },
  {
    contract_title: "Walgreen's — Ground-Up Construction",
    agency: 'Gilbane Building Company (prime)',
    office: 'Providence, RI',
    contract_value: 1327000,
    role: 'sub',
    scope_description:
      'Complete ground-up construction including all site work, concrete, masonry, metals, rough and finish carpentry, roofing system, doors and hardware, glazing, drywall, acoustical ceilings, painting and wallcoverings, flooring, miscellaneous specialties, plumbing, mechanical, and electrical.',
    relevance_keywords: ['ground-up construction', 'general building', 'commercial'],
    naics_codes: ['236220'],
  },
  {
    contract_title: 'College of the Holy Cross (Hart Center) — Doors/Frames/Hardware & Painting',
    agency: 'Bond Brothers (prime)',
    office: 'Worcester, MA',
    contract_value: 1800312,
    role: 'sub',
    scope_description:
      'Furnished, fabricated, delivered, and installed all doors, frames, and hardware in the Hart Center Building. Primed, painted, and touched up all walls and ceilings; painted FP pipe, crew tank, diffusers, temporary protection walls, equipment, duct, and conduit in the Fieldhouse.',
    relevance_keywords: ['doors frames hardware', 'painting', 'higher education', 'finish work'],
    naics_codes: ['238350', '238320'],
  },
];

const capabilities = [
  { capability_name: 'General Building Construction', description: 'Ground-up and renovation general construction for federal, state, and local clients; self-performing carpentry, drywall, painting, and project supervision.', related_naics: ['236210', '236220'] },
  { capability_name: 'Demolition & Site Work', description: 'Selective and structural demolition of concrete, steel, wood, and CMU, including turbine/dynamo halls and multi-structure sites.', related_naics: ['238910'] },
  { capability_name: 'Historical Renovation', description: 'Historic preservation and renovation including custom window replication matching late-19th-century textile-mill configuration (NPS Boott Cotton Mills).', related_naics: ['236220'] },
  { capability_name: 'Environmental Remediation & Abatement', description: 'Lead paint abatement, asbestos abatement, and environmental remediation; self-performed asbestos abatement.', related_naics: ['562910'] },
  { capability_name: 'Doors, Frames & Finish Hardware', description: 'Furnish and install hollow-metal and flush-wood doors, frames, sound-control assemblies, and mechanical/electrical finish hardware (Lowell Justice Center, Holy Cross).', related_naics: ['238350'] },
  { capability_name: 'Glass & Glazing', description: 'Window and curtainwall supply and installation, flashing, pans, and caulking (RI Veterans Home, Boott Cotton Mills).', related_naics: ['238150'] },
];

async function main() {
  console.log(`Seeding test vault: ${EMAIL}`);

  // Wipe prior test rows (idempotent).
  await sb.from('user_past_performance').delete().eq('user_email', EMAIL);
  await sb.from('user_capabilities_library').delete().eq('user_email', EMAIL);
  await sb.from('user_identity_profile').delete().eq('user_email', EMAIL);

  const { error: idErr } = await sb.from('user_identity_profile').insert(identity);
  if (idErr) throw new Error(`identity: ${idErr.message}`);
  console.log('  identity ✓');

  const ppRows = pastPerf.map(p => ({ ...p, user_email: EMAIL, source: 'tavares_capability_statement_2020' }));
  const { error: ppErr } = await sb.from('user_past_performance').insert(ppRows);
  if (ppErr) throw new Error(`past_perf: ${ppErr.message}`);
  console.log(`  past performance ✓ (${ppRows.length} real contracts)`);

  const capRows = capabilities.map(c => ({ ...c, user_email: EMAIL }));
  const { error: capErr } = await sb.from('user_capabilities_library').insert(capRows);
  if (capErr) throw new Error(`capabilities: ${capErr.message}`);
  console.log(`  capabilities ✓ (${capRows.length})`);

  console.log('\nDone. Point the eval at this vault: set vaultEmail in cases.json.');
}

main().catch(e => { console.error(e); process.exit(1); });
