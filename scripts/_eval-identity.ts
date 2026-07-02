import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../src/lib/llm/call-llm';
import { readFileSync } from 'fs';

// Pull the PARSE_PROMPT straight from the route so the eval matches production.
const src = readFileSync('src/app/api/app/vault/documents/parse/route.ts', 'utf8');
const m = src.match(/const PARSE_PROMPT = `([\s\S]*?)`;/);
if (!m) { console.error('could not extract prompt'); process.exit(1); }
const PARSE_PROMPT = m[1];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const { data } = await sb.from('user_boilerplate_docs')
    .select('extracted_text, original_filename')
    .eq('user_email', 'eric@govcongiants.com')
    .ilike('original_filename', '%Wiipica%')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const text: string = data?.extracted_text || '';
  console.log('DOC:', data?.original_filename, '| textlen:', text.length);
  const { text: out } = await callLLM({
    system: PARSE_PROMPT, user: text.slice(0, 40000),
    json: true, temperature: 0.1, maxTokens: 8000, job: 'reasoning',
  });
  const raw = JSON.parse(out.replace(/```json\n?|```\n?/g, '').trim());
  console.log('\n=== IDENTITY ===');
  console.log(JSON.stringify(raw.identity, null, 2));
  console.log('\n=== COUNTS ===  pp:', (raw.past_performance||[]).length, ' caps:', (raw.capabilities||[]).length);
})();
