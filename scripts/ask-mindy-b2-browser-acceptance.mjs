#!/usr/bin/env node
/**
 * Ask Mindy B2 — authenticated staging acceptance through a REAL browser session.
 *
 *   node scripts/ask-mindy-b2-browser-acceptance.mjs \
 *     --base https://market-assassin-git-fix-ask-mindy-b2-eric-coffies-projects.vercel.app \
 *     --expect-email <synthetic Pro test account> \
 *     [--configs current,terra,fallback-luna,fallback-groq] [--budget-usd 5] [--out results.json]
 *
 * How authentication works (no forged tokens, no signing secrets):
 *  1. Opens a VISIBLE Chrome-for-Testing window with a fresh, throwaway profile at <base>/app.
 *  2. A person signs in through Mindy's normal login flow in that window.
 *  3. The script waits until the page holds a session, checks (in the page) that its account is
 *     --expect-email, and refuses to run otherwise.
 *  4. Every question is sent FROM THE PAGE with the page's own session headers. The token is read
 *     and used only inside the browser; it is never returned to Node, printed, or written to disk.
 *     The throwaway profile is deleted at the end.
 *
 * Model configurations are selected per request with the preview-only `x-ask-mindy-staging-config`
 * header (src/lib/chat/staging-model-config.ts) — honored only on a traced preview, never production.
 * Refuses production hosts. Stops before the next question once estimated spend reaches --budget-usd.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { QUESTIONS, cost, judge } from './ask-mindy-b2-acceptance.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = String(arg('base', '')).replace(/\/$/, '');
const expectEmail = String(arg('expect-email', '')).toLowerCase().trim();
const configs = String(arg('configs', 'current,terra,fallback-luna,fallback-groq')).split(',').map((s) => s.trim()).filter(Boolean);
const budget = Number(arg('budget-usd', '5'));
const out = arg('out', 'ask-mindy-b2-browser-acceptance.json');
const PER_TURN_RESERVE_USD = 0.25; // never start a turn that could cross the cap

if (!base || !expectEmail) { console.error('Usage: --base <preview url> --expect-email <synthetic Pro account>'); process.exit(2); }
if (/getmindy\.ai|govcongiants\.com/i.test(base) || !/\.vercel\.app$/i.test(new URL(base).host)) {
  console.error('Refusing: --base must be a *.vercel.app preview, never production.'); process.exit(2);
}

// Runs IN THE PAGE. Returns only the email the stored session names (never the token).
function pageSessionEmail() {
  const t = localStorage.getItem('mi_beta_auth_token');
  if (!t) return null;
  try {
    const p = t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return String(JSON.parse(decodeURIComponent(atob(p).split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''))).email || '').toLowerCase();
  } catch { return null; }
}

// Runs IN THE PAGE. Sends one question with the page's own session; returns parsed events only.
async function pageAsk(item, configName, email) {
  const h = { 'Content-Type': 'application/json', 'x-user-email': email, 'x-ask-mindy-staging-config': configName };
  const at = localStorage.getItem('mi_beta_auth_token'); if (at) h['x-mi-auth-token'] = at;
  const tf = localStorage.getItem('mi_beta_2fa_token'); if (tf) h['x-mi-2fa-token'] = tf;
  const started = performance.now();
  const outR = { id: item.id, q: item.q, config: configName, status: 0, ms: 0, firstTokenMs: null, tools: [], resultChars: [], notices: [], errors: [], answer: '', usage: null, credits: [] };
  const res = await fetch('/api/app/chat', { method: 'POST', headers: h, body: JSON.stringify({ email, message: item.q, history: item.history || [] }) });
  outR.status = res.status;
  if (!res.ok || !res.body) { outR.errors.push(`http_${res.status}`); outR.ms = Math.round(performance.now() - started); return outR; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let e; try { e = JSON.parse(line.slice(5)); } catch { continue; }
      if (e.type === 'token') { if (outR.firstTokenMs == null) outR.firstTokenMs = Math.round(performance.now() - started); outR.answer += e.content; }
      if (e.type === 'notice') outR.notices.push(e.code);
      if (e.type === 'error') outR.errors.push(`${e.code}: ${e.message}`);
      if (e.type === 'credits') outR.credits.push(e);
      if (e.type === 'trace') for (const t of e.tools || []) { outR.tools.push(`${t.tool}:${t.status}`); outR.resultChars.push(t.result_chars); }
      if (e.type === 'trace_usage') { outR.usage = { planner: e.planner, answer: e.answer }; outR.notices.push(...(e.notices || [])); }
    }
  }
  outR.ms = Math.round(performance.now() - started);
  return outR;
}

// Runs IN THE PAGE. The account's credit balance (token-only route), or null if unreadable.
async function pageBalance(email) {
  const h = { 'x-user-email': email };
  const at = localStorage.getItem('mi_beta_auth_token'); if (at) h['x-mi-auth-token'] = at;
  try { const r = await fetch('/api/mcp/account', { headers: h }); if (!r.ok) return null; const j = await r.json(); return typeof j.balance === 'number' ? j.balance : null; } catch { return null; }
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ask-mindy-b2-profile-'));
  const browser = await puppeteer.launch({ headless: false, userDataDir: profile, defaultViewport: null, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
    console.log(`\nSign in as ${expectEmail} in the browser window that just opened (normal Mindy login). Waiting up to 10 minutes…`);
    let email = null;
    for (let i = 0; i < 300 && !email; i++) { await new Promise((r) => setTimeout(r, 2000)); email = await page.evaluate(pageSessionEmail).catch(() => null); }
    if (!email) throw new Error('No session after 10 minutes.');
    if (email !== expectEmail) throw new Error(`Signed in as a different account than --expect-email; refusing to run.`);
    console.log(`Session detected for ${email}. Running ${configs.length} configuration(s) × ${QUESTIONS.length} questions, cap $${budget}.\n`);
    const balanceBefore = await page.evaluate(pageBalance, email);
    const results = []; let spent = 0; let stopped = false;
    for (const cfg of configs) {
      for (const item of QUESTIONS) {
        if (spent + PER_TURN_RESERVE_USD > budget) { stopped = true; break; }
        const r = await page.evaluate(pageAsk, item, cfg, email);
        r.usd = cost(r.usage); spent += r.usd; r.fails = judge(r, item.expect);
        if (r.credits.length) r.fails.push('credits event on a Pro chat turn');
        results.push(r);
        console.log(`${r.fails.length ? 'FAIL' : 'PASS'} [${cfg}] ${r.id} · ${r.ms}ms (first token ${r.firstTokenMs ?? '-'}ms) · $${r.usd.toFixed(4)} · tools=[${r.tools.join(', ')}] · answer=${r.usage?.answer?.model ?? '-'}${r.usage?.answer?.fallback ? ' (fallback)' : ''}${r.fails.length ? ` · ${r.fails.join('; ')}` : ''}`);
      }
      if (stopped) { console.log(`Budget reserve reached at $${spent.toFixed(4)}; stopping.`); break; }
    }
    const balanceAfter = await page.evaluate(pageBalance, email);
    const byConfig = {};
    for (const r of results) {
      const c = (byConfig[r.config] ||= { ran: 0, passed: 0, usd: 0, msTotal: 0, models: {} });
      c.ran++; if (!r.fails.length) c.passed++; c.usd += r.usd; c.msTotal += r.ms;
      const m = `${r.usage?.answer?.model ?? '-'}${r.usage?.answer?.fallback ? ' (fallback)' : ''}`; c.models[m] = (c.models[m] || 0) + 1;
    }
    for (const c of Object.values(byConfig)) { c.usd = Number(c.usd.toFixed(4)); c.avgMs = Math.round(c.msTotal / c.ran); delete c.msTotal; }
    const summary = { base, account: email, budget, spent: Number(spent.toFixed(4)), balanceBefore, balanceAfter, creditsUnchanged: balanceBefore === balanceAfter, byConfig, results };
    writeFileSync(out, JSON.stringify(summary, null, 2));
    console.log(`\nSpent ~$${summary.spent} · credit balance ${balanceBefore} → ${balanceAfter} · results in ${out}`);
    for (const [k, c] of Object.entries(byConfig)) console.log(`  ${k}: ${c.passed}/${c.ran} pass · avg ${c.avgMs}ms · $${c.usd} · answer models ${JSON.stringify(c.models)}`);
    process.exitCode = results.every((r) => !r.fails.length) && !stopped ? 0 : 1;
  } finally {
    await browser.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true }); // the session lived only in this throwaway profile
  }
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
