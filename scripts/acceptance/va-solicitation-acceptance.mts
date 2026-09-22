/** VA 36C24226Q0857 — primary acceptance case. */
import { createClient } from '@supabase/supabase-js';
import { fetchNoticeResources } from '../../src/lib/sam/fetch-notice-resources';
import { getRotatedSAMKey } from '../../src/lib/sam/utils';
import { solicitationDocuments } from '../../src/mcp/tools/solicitation-documents';
import { generateCacheKey } from '../../src/lib/mcp/external-cache';

const NID = '2d232f3ce1f04085be52cbfe43a0e463';
let pass = true;
const chk = (name: string, ok: boolean, detail = '') => { console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?' — '+detail:''}`); if(!ok) pass=false; };

// 1 ── app inventory vs MCP inventory
const key = await getRotatedSAMKey() as string;
const app = await fetchNoticeResources(NID, key) ?? [];
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
// Evict ONLY this notice's cache row so the run re-extracts. The earlier form
// deleted every solicitation_docs row for EVERY notice — an unscoped prod
// delete inside a script presented as read-only acceptance. Import the real
// derivation rather than re-deriving it: a hand-copied md5 happens to match
// only while the params object has ONE key, and would diverge silently the
// moment a param is added, leaving this script testing a stale cache.
const cacheKey = generateCacheKey('solicitation_docs', { noticeId: NID });
await sb.from('mcp_external_cache').delete().eq('cache_key', cacheKey);
const mcp: any = await solicitationDocuments({ notice_id: NID, text_limit: 120_000 });
const appIds = new Set(app.map(a=>a.fileId!)); const mcpIds = new Set<string>(mcp.documents.map((d:any)=>d.document_id));
chk('inventory count matches', app.length===mcp.documents.length, `app=${app.length} mcp=${mcp.documents.length}`);
chk('every app attachment id present in MCP', [...appIds].every(i=>mcpIds.has(i)), `missing=${[...appIds].filter(i=>!mcpIds.has(i)).length}`);

// 2 ── exact reconstruction through paging (byte-for-byte vs stored char_count)
const acc = new Map<string,string>();
let r:any = mcp, calls = 1, guard = 0;
for (const d of r.documents) acc.set(d.document_id, d.extracted_text);
while (r.next_page && guard++ < 40) {
  r = await solicitationDocuments({ notice_id: NID, text_limit: 120_000, document_ids: r.next_page.document_ids, documents: r.next_page.documents });
  for (const d of r.documents) acc.set(d.document_id, (acc.get(d.document_id)||'') + d.extracted_text);
  calls++;
}
let exact = true;
for (const d of mcp.documents) {
  const got = (acc.get(d.document_id)||'').length;
  if (d.char_count != null && got !== d.char_count) { exact=false; console.log(`   mismatch ${d.filename}: assembled ${got} vs char_count ${d.char_count}`); }
}
chk('exact text reconstruction (assembled === char_count for every doc)', exact, `${calls} calls`);
// A single response is deliberately BOUNDED (MAX_WINDOW_CHARS), so the real
// contract is: paging terminates, and when it does nothing is left unread.
chk('paging terminates on the documented signal (next_page === null)', r.next_page===null);
chk('no unread text remains at termination', r.documents.every((d:any)=>!d.text_window.has_more));
chk('no document reports unread text after paging',
  mcp.documents.every((d:any)=>{ const got=(acc.get(d.document_id)||'').length; return d.char_count==null || got>=d.char_count; }));

// 3 ── the cited late-document sections
const all = [...acc.values()].join('\n');
for (const [label, re] of Object.entries({
  'FAR 52.212-1 (instructions, p48)': /52\.212-1/i,
  'FAR 52.212-2 (evaluation factors, p58)': /52\.212-2/i,
  'insurance (p29)': /insurance/i,
  'VAAR 852.219-75 / limitations on subcontracting (p42)': /852\.219-75|limitations on subcontracting/i,
})) chk(label, re.test(all));
console.log(`\nassembled ${all.length} chars across ${acc.size} documents`);
console.log(pass ? '\n✅ VA ACCEPTANCE PASSED' : '\n❌ VA ACCEPTANCE FAILED');
process.exit(pass?0:1);
