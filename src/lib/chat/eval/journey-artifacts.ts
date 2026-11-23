/**
 * Writes a journey run's artifacts to disk (outside the repo by default) and builds the side-by-side index a
 * grader reads. No scores: this only records what the customer got.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnCapture } from './journey';

export interface ArtifactCtx {
  dir: string;
  host: string;
  email: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface ArtifactRecord { turn: number; kind: string; file: string; sha256: string; bytes: number; note?: string }

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function put(ctx: ArtifactCtx, records: ArtifactRecord[], turn: number, kind: string, file: string, data: Buffer | string, note?: string) {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  writeFileSync(join(ctx.dir, file), buf);
  records.push({ turn, kind, file, sha256: sha(buf), bytes: buf.length, ...(note ? { note } : {}) });
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

/**
 * One turn: the answer, the full event stream, a structured capture (without the inline report HTML), the
 * packaged report (inline HTML from the stream AND the hosted page), and every create_document file, downloaded
 * through the Vault download route with the same test token. A download that fails is recorded, never faked.
 */
export async function writeTurnArtifacts(ctx: ArtifactCtx, c: TurnCapture): Promise<ArtifactRecord[]> {
  mkdirSync(ctx.dir, { recursive: true });
  const f = ctx.fetchImpl ?? fetch;
  const records: ArtifactRecord[] = [];
  const p = `turn-${c.turn}`;
  put(ctx, records, c.turn, 'answer', `${p}.answer.md`, `> ${c.prompt.replace(/\n/g, '\n> ')}\n\n${c.answer}\n`);
  put(ctx, records, c.turn, 'events', `${p}.events.jsonl`, c.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const { events: _events, ...rest } = c;
  void _events;
  put(ctx, records, c.turn, 'capture', `${p}.json`, JSON.stringify({ ...rest, marketReport: c.marketReport ? { ...c.marketReport, html: c.marketReport.html ? `[${c.marketReport.html.length} chars: see ${p}.market-report.html]` : '' } : null }, null, 2));

  if (c.marketReport) {
    if (c.marketReport.html) put(ctx, records, c.turn, 'market_report_inline', `${p}.market-report.html`, c.marketReport.html);
    if (c.marketReport.url) {
      try {
        const url = new URL(c.marketReport.url, ctx.host).toString();
        const r = await f(url);
        if (r.ok) put(ctx, records, c.turn, 'market_report_hosted', `${p}.market-report.hosted.html`, Buffer.from(await r.arrayBuffer()), url);
        else records.push({ turn: c.turn, kind: 'market_report_hosted', file: '', sha256: '', bytes: 0, note: `fetch failed: HTTP ${r.status} ${url}` });
      } catch (e) {
        records.push({ turn: c.turn, kind: 'market_report_hosted', file: '', sha256: '', bytes: 0, note: `fetch failed: ${(e as Error).message}` });
      }
    }
  }

  for (const d of c.deliverables) {
    const fail = (why: string) => records.push({ turn: c.turn, kind: `document_${d.format}`, file: '', sha256: '', bytes: 0, note: `${d.document_id}: ${why}` });
    try {
      const q = new URLSearchParams({ email: ctx.email, id: d.document_id });
      const meta = await f(`${ctx.host.replace(/\/$/, '')}/api/app/vault/documents/download?${q}`, { headers: { 'x-mi-auth-token': ctx.token } });
      if (!meta.ok) { fail(`download route HTTP ${meta.status}`); continue; }
      const j = await meta.json() as { url?: string; filename?: string };
      if (!j.url) { fail('download route returned no url'); continue; }
      const bin = await f(j.url);
      if (!bin.ok) { fail(`signed url HTTP ${bin.status}`); continue; }
      put(ctx, records, c.turn, `document_${d.format}`, `${p}.${safe(j.filename || d.file_name || `${d.document_id}.${d.format}`)}`, Buffer.from(await bin.arrayBuffer()), d.document_id);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  return records;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** Side-by-side index of two runs (answers inline, artifacts linked). Deliberately unstyled and score-free. */
export function compareIndexHtml(runs: Array<{ name: string; dir: string; relDir: string }>): string {
  const manifests = runs.map((r) => JSON.parse(readFileSync(join(r.dir, 'manifest.json'), 'utf8')) as {
    label: string; target: { host: string; served_sha: string | null }; flags: Record<string, { state: string }>; turns: Array<{ turn: number; prompt: string }>; artifacts: ArtifactRecord[];
  });
  const maxTurns = Math.max(...manifests.map((m) => m.turns.length));
  const head = runs.map((r, i) => `<th>${esc(r.name)}<br><small>${esc(manifests[i].label)} · ${esc(manifests[i].target.host)} · ${esc(manifests[i].target.served_sha ?? 'sha unknown')}<br>flags: ${esc(Object.entries(manifests[i].flags).map(([k, v]) => `${k}=${v.state}`).join(', '))}</small></th>`).join('');
  const rows: string[] = [];
  for (let t = 1; t <= maxTurns; t++) {
    const prompt = manifests.find((m) => m.turns[t - 1])?.turns[t - 1]?.prompt ?? '';
    const cells = runs.map((r, i) => {
      let answer = '';
      try { answer = readFileSync(join(r.dir, `turn-${t}.answer.md`), 'utf8'); } catch { answer = '(no answer captured)'; }
      const links = manifests[i].artifacts.filter((a) => a.turn === t && a.file).map((a) => `<a href="${esc(`${r.relDir}/${a.file}`)}">${esc(a.kind)}</a>`).join(' · ');
      const gaps = manifests[i].artifacts.filter((a) => a.turn === t && !a.file).map((a) => `<li>${esc(a.kind)}: ${esc(a.note ?? '')}</li>`).join('');
      return `<td><pre>${esc(answer)}</pre><p>${links}</p>${gaps ? `<ul>${gaps}</ul>` : ''}</td>`;
    }).join('');
    rows.push(`<tr><th colspan="${runs.length}">Turn ${t}: ${esc(prompt)}</th></tr><tr>${cells}</tr>`);
  }
  return `<!doctype html><meta charset="utf-8"><title>Ask Mindy journey comparison</title><style>table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;vertical-align:top;padding:6px}pre{white-space:pre-wrap;font:13px/1.4 system-ui}</style><table><tr>${head}</tr>${rows.join('')}</table>\n`;
}
