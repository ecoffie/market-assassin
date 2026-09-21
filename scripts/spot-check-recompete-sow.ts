/**
 * Spot-check GET /api/app/recompete-sow against local dev or prod.
 * Usage: npx tsx scripts/spot-check-recompete-sow.ts [baseUrl]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE = process.argv[2] || 'http://localhost:3000';

const CASES = [
  {
    label: 'Army IT services',
    piid: 'W91ZLK24P0041',
    naics: '541512',
    agency: 'Department of the Army',
    description: 'Information technology support services help desk network administration',
  },
  {
    label: 'VA facilities janitorial',
    piid: '36C24124D0123',
    naics: '561720',
    agency: 'Department of Veterans Affairs',
    description: 'Janitorial custodial cleaning services medical center',
  },
  {
    label: 'Navy facilities maintenance',
    piid: 'N0017824D0001',
    naics: '561210',
    agency: 'Department of the Navy',
    description: 'Facilities maintenance and repair building systems HVAC',
  },
];

async function run() {
  for (const c of CASES) {
    const qs = new URLSearchParams({
      piid: c.piid,
      naics: c.naics,
      agency: c.agency,
      description: c.description,
    });
    const url = `${BASE}/api/app/recompete-sow?${qs}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      console.log('\n---', c.label, '---');
      console.log('HTTP', res.status);
      console.log('verdict:', data.verdict, data.reason || '');
      if (data.telemetry) console.log('telemetry:', JSON.stringify(data.telemetry));
      if (data.match) {
        console.log('match:', data.match.title?.slice(0, 80));
        console.log('score:', data.match.scorePct + '%', data.match.sowDocType);
      }
    } catch (e) {
      console.error(c.label, (e as Error).message);
    }
  }
}

run();
