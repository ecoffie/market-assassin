/**
 * GUARD: no scheduled-job handler under src/app/api/cron can do work before server-side authorization.
 *
 * Parses every src/app/api/cron/**\/route.ts with the TypeScript compiler. For each exported HTTP handler
 * (GET/POST/PUT/PATCH/DELETE — function declarations, `export const X = …`, and `export { a as X }`):
 *   - the handler must contain an approved authorization check among its top-level statements, AND
 *   - that check must come BEFORE the first statement that awaits anything else, creates a database
 *     client, fetches, or sends email.
 * A handler that only delegates to another exported handler of the same file (`export const POST = GET`,
 * `return GET(req)`) inherits that handler's verdict.
 *
 * Scheduled job routes require server-side authorization.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

const ROOT = process.cwd();
const CRON_DIR = join(ROOT, 'src/app/api/cron');
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Approved authorization: the shared helpers, or a direct comparison against a server-held secret
 * (CRON_SECRET, or ADMIN_PASSWORD on admin-only endpoints). A caller-set header alone is never one.
 */
const AUTH = /\b(authorizeCronRequest|requireJobAuth|isAuthorizedJobRequest|hasValidCronSecret|cronBearerAuthorized|retiredAlertRoute)\s*\(|\bCRON_SECRET\b|\bADMIN_PASSWORD\b/;
/** Work that must never happen before authorization. */
const WORK = /\bawait\b|\bcreateClient\s*\(|\bgetWriteClient\s*\(|\bgetReadClient\s*\(|\bsendEmail\s*\(|\bfetch\s*\(/;
/** Reading the request itself is not work. */
const READS_REQUEST = /\bawait\s+(?:(?:request|req)\.(?:json|text|formData)\(\)|headers\(\)|cookies\(\))/g;

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

type Verdict = { ok: true } | { ok: false; why: string } | { delegate: string };

function judgeBody(body: ts.Block, sf: ts.SourceFile, siblings: Set<string>, localAuth: RegExp | null, locals: Map<string, ts.Block>, depth = 0): Verdict {
  const stmts = body.statements;
  if (stmts.length === 1) {
    const only = stmts[0].getText(sf);
    const m = only.match(/^return\s+(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    if (m && siblings.has(m[1])) return { delegate: m[1] };
    // `return handle(request)` → judge the local function that does the work.
    if (m && locals.has(m[1]) && depth < 3) return judgeBody(locals.get(m[1])!, sf, siblings, localAuth, locals, depth + 1);
  }
  // A GATE is a top-level `if (<auth condition>) return …` (or `{ … return … }`). The condition counts when
  // it calls an approved helper / local auth helper, compares a server-held secret, or tests a variable
  // that an earlier top-level statement computed from one. A secret mentioned anywhere else (an optional
  // `?restamp=1` branch, an email link) is not a gate.
  const authVars = new Set<string>();
  const isAuthExpr = (text: string) =>
    AUTH.test(text) || (localAuth ? localAuth.test(text) : false)
    || [...authVars].some((v) => new RegExp(`\\b${v}\\b`).test(text));
  let authAt = -1;
  let workAt = -1;
  stmts.forEach((s, i) => {
    const text = s.getText(sf).replace(READS_REQUEST, '');
    let isGate = false;
    let isAuthDecl = false;
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && isAuthExpr(d.initializer.getText(sf))) { authVars.add(d.name.text); isAuthDecl = true; }
      }
    }
    if (ts.isIfStatement(s) && isAuthExpr(s.expression.getText(sf)) && /\breturn\b/.test(s.thenStatement.getText(sf))) isGate = true;
    if (isGate && authAt === -1) authAt = i;
    if (!isGate && !isAuthDecl && WORK.test(text) && workAt === -1) workAt = i;
  });
  if (authAt === -1) return { ok: false, why: 'no authorization check' };
  if (workAt !== -1 && workAt < authAt) return { ok: false, why: `work at statement ${workAt + 1} before authorization at ${authAt + 1}` };
  return { ok: true };
}

/** Local helpers in the same file that themselves perform an approved check (e.g. `function isAuthorized(req)`). */
function localAuthHelpers(sf: ts.SourceFile): RegExp | null {
  const names: string[] = [];
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body && !METHODS.has(n.name.text) && AUTH.test(n.body.getText(sf))) names.push(n.name.text);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && AUTH.test(d.initializer.getText(sf))) names.push(d.name.text);
      }
    }
  });
  return names.length ? new RegExp(`\\b(${names.join('|')})\\s*\\(`) : null;
}

function judgeFile(path: string): string[] {
  const src = readFileSync(path, 'utf8');
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const localAuth = localAuthHelpers(sf);
  const locals = new Map<string, ts.Block>();
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body && !METHODS.has(n.name.text)) locals.set(n.name.text, n.body);
  });
  const handlers = new Map<string, Verdict>();
  const siblings = new Set<string>();
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name && METHODS.has(n.name.text)) siblings.add(n.name.text);
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name) && METHODS.has(d.name.text)) siblings.add(d.name.text);
  });
  const exported = (n: ts.Node) => !!(ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export);
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name && METHODS.has(n.name.text) && exported(n)) {
      handlers.set(n.name.text, n.body ? judgeBody(n.body, sf, siblings, localAuth, locals) : { ok: false, why: 'no body' });
    }
    if (ts.isVariableStatement(n) && exported(n)) {
      for (const d of n.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !METHODS.has(d.name.text) || !d.initializer) continue;
        const init = d.initializer;
        if (ts.isIdentifier(init) && siblings.has(init.text)) handlers.set(d.name.text, { delegate: init.text });
        else if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)) handlers.set(d.name.text, judgeBody(init.body, sf, siblings, localAuth, locals));
        else if (AUTH.test(init.getText(sf))) handlers.set(d.name.text, { ok: true }); // wrapped: withAuth(handler)
        else handlers.set(d.name.text, { ok: false, why: 'unrecognized handler form' });
      }
    }
    if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause)) {
      for (const e of n.exportClause.elements) {
        if (METHODS.has(e.name.text)) handlers.set(e.name.text, { ok: false, why: 're-exported handler: not verifiable here' });
      }
    }
  });
  const problems: string[] = [];
  const resolve = (name: string, seen = new Set<string>()): Verdict => {
    const v = handlers.get(name);
    if (!v) return { ok: false, why: `delegates to missing ${name}` };
    if ('delegate' in v) return seen.has(name) ? { ok: false, why: 'delegation cycle' } : resolve(v.delegate, new Set([...seen, name]));
    return v;
  };
  for (const name of handlers.keys()) {
    const v = resolve(name);
    if ('ok' in v && !v.ok) problems.push(`${relative(ROOT, path)} ${name}: ${v.why}`);
  }
  return problems;
}

describe('every cron handler authorizes before it does any work', () => {
  const files = routeFiles(CRON_DIR);

  it('finds the cron routes', () => {
    expect(files.length).toBeGreaterThan(90);
  });

  it('no handler can run without server-side authorization first', () => {
    const problems = files.flatMap(judgeFile);
    expect(problems).toEqual([]);
  });
});

describe('the guard itself catches the defect classes', () => {
  const judge = (code: string) => {
    const dir = join(ROOT, 'node_modules', '.cache', 'cron-guard-fixture');
    const p = join(dir, 'route.ts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, code);
    return judgeFile(p);
  };
  it('flags a handler with no authorization', () => {
    expect(judge(`export async function GET(request: Request) { const r = await fetch('x'); return r; }`)).toHaveLength(1);
  });
  it('flags work before authorization', () => {
    expect(judge(`export async function GET(request) { const db = createClient(a, b); const auth = await authorizeCronRequest(request, { isTest: false }); if (!auth.ok) return auth.response; }`)[0]).toMatch(/before authorization/);
  });
  it('flags a header-only gate (x-cron-dispatch is caller-set)', () => {
    expect(judge(`export async function GET(request) { if (request.headers.get('x-cron-dispatch') !== '1') return new Response('', { status: 401 }); await run(); }`)).toHaveLength(1);
  });
  it('accepts authorization first, and a delegating sibling', () => {
    expect(judge(`export async function GET(request) { const auth = await authorizeCronRequest(request, { isTest: false }); if (!auth.ok) return auth.response; await run(); }\nexport const POST = GET;`)).toEqual([]);
  });
});
