#!/usr/bin/env node

/**
 * Ingest Eric's proprietary call transcripts (sales discovery + coaching +
 * assessment + consultancy) into Mindy's RAG corpus.
 *
 * WHY THIS EXISTS
 *   The 430 Fireflies transcripts in Drive + the big "Assessment Call
 *   Transcripts" Google Doc are first-party GovCon conversations no
 *   competitor has. They make Mindy answer like a GovCon Giants rep/coach:
 *   real objection handling, real pricing talk, real prospect pain, real
 *   contracting guidance.
 *
 * SOURCES (already exported to disk by the MCP Drive step — see
 *   tasks/PLAN-rag-coaching-calls-ingest.md):
 *     tasks/cache/calls/<fileId>.txt        ← one Fireflies call per file
 *     tasks/cache/calls/<fileId>.json       ← OPTIONAL sidecar metadata
 *                                              { title, fileId, source, mimeType }
 *     tasks/cache/calls/assessment-doc.txt  ← the big concatenated doc
 *                                              (split here by "# Member" headers)
 *   We read pre-extracted .txt so this script needs NO Drive creds and NO
 *   mammoth/pdf-parse at ingest time. (The export step does extraction.)
 *
 * WRITE PATH
 *   Local SUPABASE_SERVICE_ROLE_KEY is stale (401), so — exactly like
 *   scripts/ingest-proposal-template-corpus.js — we POST to the deployed
 *   admin bridge which has current server env:
 *     POST {ENDPOINT}/api/admin/rag-library?password=...
 *     { action:'upsert-rag-docs', dryRun, confirm, dedupeByHash, docs:[...] }
 *   The server chunks (500-word / 50-overlap) and writes documents + chunks.
 *
 * CLASSIFICATION
 *   Every call is tagged by type so retrieval can be tuned later:
 *     sales_call     — discovery / opportunity / potential-engagement /
 *                      sales meetings (reps pitching Mindy + consulting)
 *     coaching_call  — assessment / consultancy / "… and Eric Coffie" 1-on-1 /
 *                      coaching sessions / beginners / client follow-ups / Q&A
 *     (INTERNAL OPS are EXCLUDED entirely — team/weekly/marketing/standup/
 *      candidate interviews / appt-setter onboarding.)
 *   Scope decision (Eric, 2026-06-03): ingest everything EXCEPT internal ops.
 *
 * USAGE
 *   Dry run (default):  node scripts/ingest-coaching-calls.js
 *   Apply:              node scripts/ingest-coaching-calls.js --apply
 *   Options:
 *     --endpoint=https://getmindy.ai   (default)
 *     --limit=5                        (first N files)
 *     --only=sales|coaching            (ingest just one type)
 *     --cache=tasks/cache/calls        (override source dir)
 *     --include-internal               (override the internal-ops skip)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- args -------------------------------------------------------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_INTERNAL = args.includes('--include-internal');
const getArg = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : dflt;
};
const ENDPOINT = (getArg('endpoint', 'https://getmindy.ai')).replace(/\/$/, '');
const LIMIT = Number(getArg('limit', Infinity));
const ONLY = getArg('only', null); // 'sales' | 'coaching' | null
const CACHE_DIR = path.resolve(getArg('cache', path.join(__dirname, '..', 'tasks', 'cache', 'calls')));
const PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---- classification ---------------------------------------------
// Match on the human-readable title (the Fireflies filename / doc header),
// NOT the body — bodies all mention Mindy + pricing regardless of call type.

const INTERNAL_PATTERNS = [
  /\bteam meeting\b/i,
  /\bweekly meeting\b/i,
  /\bgcg weekly\b/i,
  /\bmarketing\b/i,
  /\bstand[- ]?up\b/i,
  /\bstrategy meeting\b/i,
  /\binterview with candidate\b/i,
  /\bappt setter\b/i,
  /\bonboarding\b/i,
  /\binternal\b/i,
  /\bsales meeting\b/i, // internal sales team syncs (not a prospect call)
];

const COACHING_PATTERNS = [
  /\bassessment call\b/i,
  /\bconsultancy (service|meeting)\b/i,
  /\bconsulting call\b/i,
  /\bcoaching session\b/i,
  /\bbeginners call\b/i,
  /\bclient call\b/i,
  /\bfollow up (call|meeting)\b/i,
  /\bq&a\b/i,
  /\band eric coffie\b/i,
  /\beric coffie\b/i, // "<name> and Eric Coffie" 1-on-1s
];

const SALES_PATTERNS = [
  /\bdiscovery (call|meeting)\b/i,
  /\bopportunity meeting\b/i,
  /\bpotential (engagement|partnership|consulting)\b/i,
  /\bsales\b/i,
];

/** Returns 'coaching_call' | 'sales_call' | null (null = skip: internal/other). */
function classifyCall(title) {
  const t = title || '';
  if (!INCLUDE_INTERNAL && INTERNAL_PATTERNS.some((re) => re.test(t))) return null;
  // Coaching takes priority — an Eric 1-on-1 is coaching even if also "sales".
  if (COACHING_PATTERNS.some((re) => re.test(t))) return 'coaching_call';
  if (SALES_PATTERNS.some((re) => re.test(t))) return 'sales_call';
  // Unknown client-facing call: default to sales_call (lower boost) so it's
  // ingested (scope = everything but internal) without over-claiming coaching.
  return 'sales_call';
}

// ---- title / person / date parsing ------------------------------
// Fireflies titles look like:
//   "Amir Johnson- GCG Discovery Call-transcript-2026-06-01T14-30-00.000Z.docx"
//   "Whitty-CAP Global Coaching Session-transcript-2026-04-15T...docx"
function parseTitle(rawTitle) {
  let t = rawTitle.replace(/\.(docx|pdf|txt)$/i, '');
  // pull out the -transcript-<ISO> tail as the date
  let date = null;
  const m = t.match(/-transcript-(\d{4}-\d{2}-\d{2})/);
  if (m) date = m[1];
  t = t.replace(/-transcript-.*$/i, '').trim();
  // person = leading "Name-" or "Name:" before the call-type label
  let person = null;
  const pm = t.match(/^([^-:]+?)(?:[-:]\s*(?:GCG|FREE|.*\bcall\b|.*\bmeeting\b))/i);
  if (pm) person = pm[1].trim();
  return { cleanTitle: t, person, date };
}

// ---- transcript cleaning ----------------------------------------
// Fireflies bodies are: repeating  <timestamp>\n<Speaker>\n<utterance>.
// We keep speaker + utterance (the dialogue IS the signal), drop the bare
// timestamps and the "Transcribed by fireflies.ai" footer, collapse blank
// runs. We deliberately KEEP speaker labels so retrieval can attribute who
// said what (rep vs prospect vs Eric).
function cleanTranscript(raw) {
  let text = raw.replace(/\r\n/g, '\n');
  // strip Fireflies footer
  text = text.replace(/Transcribed by\s*<?https?:\/\/fireflies\.ai\/?>?\s*$/i, '');
  const lines = text.split('\n');
  const out = [];
  for (let line of lines) {
    const s = line.trim();
    if (!s) continue;
    // drop bare timestamps like "00:03" or "01:53:22"
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) continue;
    out.push(s);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// crude NAICS / topic heuristics from body
function inferTopicTags(docType, person, body) {
  const tags = ['call-transcript', docType];
  const b = body.toLowerCase();
  if (/sources sought/.test(b)) tags.push('sources-sought');
  if (/\b8\(?a\)?\b/.test(b)) tags.push('8a');
  if (/sdvosb|service.disabled/.test(b)) tags.push('sdvosb');
  if (/sam\.gov/.test(b)) tags.push('sam-gov');
  if (/subcontract|teaming|prime/.test(b)) tags.push('teaming-subcontracting');
  if (/proposal|rfp|rfq/.test(b)) tags.push('proposal');
  if (/pricing|750|150|1500|white glove/.test(b)) tags.push('pricing-offer');
  return [...new Set(tags)];
}

// ---- build doc objects for the bridge ---------------------------
function buildDoc({ sourcePath, filename, title, fullText, docType, person, date, sizeBytes }) {
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  const niceTitle = person
    ? `${person} — ${docType === 'sales_call' ? 'Discovery Call' : 'Coaching Call'}${date ? ` (${date})` : ''}`
    : title;
  return {
    sourcePath,                       // idempotency key (gdrive:fireflies/<id>)
    filename,
    fileExtension: 'txt',
    sizeBytes: sizeBytes || Buffer.byteLength(fullText),
    fileMtime: (date ? new Date(date) : new Date('2026-01-01')).toISOString(),
    fileSha256: sha256(fullText),
    docType,
    topLevelFolder: 'Coaching Calls',
    folderPath: 'gdrive/fireflies',
    title: niceTitle,
    fullText: fullText.slice(0, 1_500_000),
    pageCount: null,
    wordCount,
    topicTags: inferTopicTags(docType, person, fullText),
    relatedNaics: [],
    oneLineSummary: `${docType === 'sales_call' ? 'GovCon Giants discovery/sales call' : 'GovCon Giants coaching/assessment call'}${person ? ` with ${person}` : ''}${date ? ` on ${date}` : ''}.`,
    usageRights: 'eric_owned',
  };
}

// ---- bridge POST (mirrors proposal-template-corpus) -------------
async function postBatch(docs) {
  const res = await fetch(`${ENDPOINT}/api/admin/rag-library?password=${encodeURIComponent(PASSWORD)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'upsert-rag-docs',
      dryRun: !APPLY,
      confirm: APPLY ? 'upsert-rag-docs' : undefined,
      dedupeByHash: true,
      docs,
    }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Non-JSON ${res.status}: ${text.slice(0, 300)}`); }
  if (!res.ok || !json.success) {
    throw new Error(`Bridge failed ${res.status}: ${json.error || text.slice(0, 300)}`);
  }
  return json;
}

// ---- assessment-doc splitter ------------------------------------
// The big doc segments calls by markdown "# Member Name" headers.
function splitAssessmentDoc(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const parts = [];
  // split on lines starting with a single "# " heading
  const re = /^#\s+(.+)$/gm;
  let match, indices = [];
  while ((match = re.exec(text)) !== null) {
    indices.push({ name: match[1].trim(), start: match.index });
  }
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].start;
    const end = i + 1 < indices.length ? indices[i + 1].start : text.length;
    const body = text.slice(start, end).trim();
    const name = indices[i].name;
    // skip the doc's own title heading
    if (/^assessment call transcripts$/i.test(name)) continue;
    if (body.split(/\s+/).filter(Boolean).length < 80) continue; // too short to be a call
    parts.push({ name, body });
  }
  return parts;
}

// ---- main -------------------------------------------------------
async function main() {
  console.log(`Coaching/sales call ingest — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Cache dir: ${CACHE_DIR}`);
  if (ONLY) console.log(`Filter: only ${ONLY}_call`);
  console.log('');

  if (!fs.existsSync(CACHE_DIR)) {
    console.error(`Cache dir not found: ${CACHE_DIR}\nRun the MCP Drive export step first (see PLAN).`);
    process.exit(1);
  }

  const docs = [];
  const skipped = { internal: 0, short: 0, typeFilter: 0 };

  // 1) per-call Fireflies .txt files (skip assessment-doc.txt; handled below)
  const txtFiles = fs.readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith('.txt') && f !== 'assessment-doc.txt')
    .sort();

  for (const f of txtFiles) {
    const full = path.join(CACHE_DIR, f);
    const raw = fs.readFileSync(full, 'utf8');
    const sidecarPath = full.replace(/\.txt$/, '.json');
    let meta = {};
    if (fs.existsSync(sidecarPath)) {
      try { meta = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')); } catch {}
    }
    // title: sidecar.title > first non-empty line > filename
    const firstLine = raw.split('\n').map((l) => l.trim()).find(Boolean) || '';
    const title = meta.title || firstLine || f;

    const docType = classifyCall(title);
    if (docType === null) { skipped.internal++; continue; }
    if (ONLY && docType !== `${ONLY}_call`) { skipped.typeFilter++; continue; }

    const body = cleanTranscript(raw);
    if (body.split(/\s+/).filter(Boolean).length < 80) { skipped.short++; continue; }

    const { person, date } = parseTitle(title);
    const fileId = meta.fileId || path.basename(f, '.txt');
    docs.push(buildDoc({
      sourcePath: `gdrive:fireflies/${fileId}`,
      filename: meta.title || f,
      title,
      fullText: body,
      docType,
      person,
      date,
      sizeBytes: Buffer.byteLength(raw),
    }));
  }

  // 2) the big assessment doc → one coaching_call per member
  const assessmentPath = path.join(CACHE_DIR, 'assessment-doc.txt');
  if (fs.existsSync(assessmentPath)) {
    const raw = fs.readFileSync(assessmentPath, 'utf8');
    const parts = splitAssessmentDoc(raw);
    console.log(`assessment-doc.txt → ${parts.length} member segments`);
    for (const p of parts) {
      if (ONLY && ONLY !== 'coaching') { skipped.typeFilter++; continue; }
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      docs.push(buildDoc({
        sourcePath: `gdrive:assessment-doc/${slug}`,
        filename: `Assessment Call — ${p.name}`,
        title: `${p.name} — Assessment Call`,
        fullText: p.body,
        docType: 'coaching_call',
        person: p.name,
        date: null,
        sizeBytes: Buffer.byteLength(p.body),
      }));
    }
  }

  // limit AFTER classification so --limit gives N real docs
  let finalDocs = docs;
  if (LIMIT < docs.length) finalDocs = docs.slice(0, LIMIT);

  const byType = finalDocs.reduce((a, d) => { a[d.docType] = (a[d.docType] || 0) + 1; return a; }, {});
  console.log('\nClassified docs to ingest:', byType);
  console.log('Skipped:', skipped);
  console.log('');
  finalDocs.slice(0, 25).forEach((d, i) => {
    console.log(`${String(i + 1).padStart(3, '0')}. ${d.docType.padEnd(14)} ${String(d.fullText.length).padStart(7)}ch  ${d.title}`);
  });
  if (finalDocs.length > 25) console.log(`… and ${finalDocs.length - 25} more`);

  if (finalDocs.length === 0) {
    console.log('\nNothing to ingest. (Export calls to the cache dir first.)');
    return;
  }

  console.log(`\nPosting ${finalDocs.length} docs in batches of 5...`);
  const totals = { batches: 0, updatedDocuments: 0, insertedChunks: 0, failed: 0 };
  const failures = [];
  for (let i = 0; i < finalDocs.length; i += 5) {
    const batch = finalDocs.slice(i, i + 5);
    const result = await postBatch(batch);
    totals.batches++;
    totals.updatedDocuments += result.updatedDocuments || 0;
    totals.insertedChunks += result.insertedChunks || 0;
    totals.failed += result.failed || 0;
    if (Array.isArray(result.results)) {
      failures.push(...result.results.filter((r) => r.status === 'failed'));
    }
    console.log(`[${String(i + batch.length).padStart(3)}/${finalDocs.length}]`, {
      updatedDocuments: result.updatedDocuments,
      insertedChunks: result.insertedChunks,
      failed: result.failed,
    });
  }

  console.log('\nComplete:', totals);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((r) => console.log(`  ${r.title || r.sourcePath}: ${r.error || 'unknown'}`));
  }
  if (!APPLY) console.log('\nDRY RUN only. Re-run with --apply to write.');
}

main().catch((e) => { console.error(`COACHING_CALL_INGEST_FAILED: ${e.message}`); process.exit(1); });
