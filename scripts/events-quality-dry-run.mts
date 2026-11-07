/**
 * DRY RUN ONLY: sizes a re-classification of historical sam_events rows under the 2026-11-07 rules in
 * src/lib/events/event-quality.ts. It has no write path. Run: npx tsx --tsconfig tsconfig.json scripts/events-quality-dry-run.mts
 * The read path already withholds unprovable locations, so customers see the fix without a backfill;
 * re-classifying event_type for old rows needs a separate, approved write.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { classifyEventText, extractEventLocation } from '../src/lib/events/event-quality';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const rows: any[] = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from('sam_events').select('notice_id,title,description,event_type,event_location').range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) break; }
let typeChange = 0, typeToNull = 0, locChange = 0; const samples: any[] = []; const flips: Record<string, number> = {};
for (const r of rows) { const t = classifyEventText(r.title, r.description); if (t !== r.event_type) { typeChange++; if (t === null) typeToNull++; flips[`${r.event_type}->${t}`] = (flips[`${r.event_type}->${t}`] || 0) + 1; if (samples.length < 5) samples.push({ title: r.title.slice(0, 70), from: r.event_type, to: t }); }
  const l = extractEventLocation(`${r.title} ${r.description || ''}`); if (l !== r.event_location) locChange++; }
console.log(JSON.stringify({ rows: rows.length, type_would_change: typeChange, type_would_become_null: typeToNull, flips, location_would_change: locChange, samples }));
