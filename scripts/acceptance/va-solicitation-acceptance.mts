/** VA 36C24226Q0857 — primary acceptance case. */
import { fetchNoticeResources } from '../../src/lib/sam/fetch-notice-resources';
import { getRotatedSAMKey } from '../../src/lib/sam/utils';
import { solicitationDocuments } from '../../src/mcp/tools/solicitation-documents';
import { createHash } from 'node:crypto';

// READ-ONLY BY CONSTRUCTION. This script performs NO writes of any kind.
// It used to DELETE the notice's cache row to force a cold extract — a
// production write inside a script presented as read-only verification. The
// cache is now disabled for this process instead, which forces the same cold
// path without touching stored data. Must be set before the cache module
// initializes its client.
process.env.MCP_EXTERNAL_CACHE = 'off';

const NID = '2d232f3ce1f04085be52cbfe43a0e463';
let pass = true;
const chk = (name: string, ok: boolean, detail = '') => { console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?' — '+detail:''}`); if(!ok) pass=false; };

// 1 ── app inventory vs MCP inventory
const key = await getRotatedSAMKey() as string;
const app = await fetchNoticeResources(NID, key) ?? [];
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
chk('exact text reconstruction (assembled length === char_count for every doc)', exact, `${calls} calls`);

// 2b ── TRUE byte comparison: the paged assembly must equal a single unpaged
// read, character for character. Length equality alone would pass even if the
// windows overlapped or dropped a boundary character and happened to balance
// out — this compares the content, plus a sha256 over it.
const oneShot: any = await solicitationDocuments({ notice_id: NID, text_limit: 1_000_000, documents: mcp.documents.map((d:any)=>({ document_id: d.document_id, offset: 0, limit: 1_000_000 })) });
let bytesEqual = true;
let comparedChars = 0, storedChars = 0;
const MAX_WINDOW = 120_000; // MAX_WINDOW_CHARS in solicitation-documents.ts
for (const d of oneShot.documents) {
  const paged = acc.get(d.document_id) || '';
  const direct = d.extracted_text;
  // GUARD AGAINST A VACUOUS PASS: if `direct` ever came back empty,
  // ''.slice(0,0) !== '' is false and this check would "pass" having compared
  // nothing. Require the unpaged read to be the full document or a full window.
  const expected = Math.min(d.char_count ?? 0, MAX_WINDOW);
  if (direct.length !== expected) {
    bytesEqual = false;
    console.log(`   SHORT READ ${d.filename}: unpaged returned ${direct.length}, expected ${expected}`);
    continue;
  }
  if (paged.slice(0, direct.length) !== direct) {
    bytesEqual = false;
    console.log(`   BYTE MISMATCH ${d.filename}: first diff at ${[...direct].findIndex((c,i)=>paged[i]!==c)}`);
  }
  comparedChars += direct.length;
  storedChars += d.char_count ?? 0;
}
const sha = createHash('sha256').update([...acc.values()].join('')).digest('hex');
// State the BOUND honestly: a single response is capped at MAX_WINDOW_CHARS, so
// a document longer than that is compared over its first 120k only. That prefix
// still spans the first paging boundary, which is where a tiling defect appears.
const pct = storedChars > 0 ? (100 * comparedChars / storedChars).toFixed(1) : '0.0';
chk(
  'byte-for-byte: paged assembly === unpaged read',
  bytesEqual,
  `${comparedChars}/${storedChars} chars (${pct}%) compared; sha256(assembled)=${sha.slice(0,16)}…`,
);
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
