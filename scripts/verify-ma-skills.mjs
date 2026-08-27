#!/usr/bin/env node
/**
 * Offline integrity check for Market Assassin Phase 2 skills.
 *
 * Proves the skill layer still points at live repo paths and that each
 * SKILL.md frontmatter is parseable and on-demand. Does not drive the Map,
 * call prod, or mutate data.
 *
 * Usage:
 *   node scripts/verify-ma-skills.mjs
 *   npm run verify:ma-skills
 *
 * Exit 0 = registry + skills intact. Exit 1 = missing path or bad frontmatter.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = join(ROOT, 'scripts/ma-skill-registry.json');
const SKILLS_DIR = join(ROOT, '.cursor/skills');

const failures = [];
const ok = (msg) => console.log(`OK  ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL ${msg}`);
};

function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return null;
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const block = raw.slice(4, end);
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return { meta: out, body: raw.slice(end + 5) };
}

function assertPath(rel, label) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) fail(`${label}: missing ${rel}`);
  else ok(`${label}: ${rel}`);
}

function collectPaths(node, into = []) {
  if (typeof node === 'string') {
    if (node.includes('/') || node.endsWith('.ts') || node.endsWith('.mjs') || node.endsWith('.mts') || node.endsWith('.md')) {
      into.push(node);
    }
    return into;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectPaths(item, into);
    return into;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'version' || k === 'purpose' || k === 'skills' || k === 'npm' || k === 'exampleOnly') continue;
      collectPaths(v, into);
    }
  }
  return into;
}

if (!existsSync(REGISTRY_PATH)) {
  fail('registry missing: scripts/ma-skill-registry.json');
  process.exit(1);
}

const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
if (!Array.isArray(registry.skills) || registry.skills.length === 0) {
  fail('registry.skills must be a non-empty array');
}

const skillDirs = existsSync(SKILLS_DIR)
  ? readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  : [];

const expected = [...registry.skills].sort();
if (JSON.stringify(skillDirs) !== JSON.stringify(expected)) {
  fail(`skill dirs ${JSON.stringify(skillDirs)} !== registry ${JSON.stringify(expected)}`);
} else {
  ok(`skill dirs match registry (${expected.length})`);
}

for (const name of expected) {
  const skillPath = join(SKILLS_DIR, name, 'SKILL.md');
  if (!existsSync(skillPath)) {
    fail(`missing SKILL.md for ${name}`);
    continue;
  }
  const raw = readFileSync(skillPath, 'utf8');
  const parsed = parseFrontmatter(raw);
  if (!parsed) {
    fail(`${name}: frontmatter missing or malformed`);
    continue;
  }
  const { meta, body } = parsed;
  if (meta.name !== name) fail(`${name}: frontmatter name="${meta.name}" must equal directory`);
  else ok(`${name}: name`);
  if (!meta.description || meta.description.length < 20) fail(`${name}: description too short`);
  else ok(`${name}: description`);
  if (meta['disable-model-invocation'] !== 'true') {
    fail(`${name}: disable-model-invocation must be true (on-demand)`);
  } else {
    ok(`${name}: on-demand`);
  }
  if (!body.includes('scripts/ma-skill-registry.json')) {
    fail(`${name}: body must point at scripts/ma-skill-registry.json`);
  } else {
    ok(`${name}: registry pointer`);
  }
  // Ban frozen incident numbers / absolute machine paths in skill bodies.
  if (/\/Users\//.test(body) || /\/home\//.test(body)) fail(`${name}: absolute machine path in body`);
  if (/\b[0-9a-f]{40}\b/.test(body)) fail(`${name}: frozen full SHA in body`);
  if (/Co-Authored-By:/.test(body)) fail(`${name}: attribution trailer text`);
}

const pathSet = new Set(collectPaths(registry));
for (const rel of [...pathSet].sort()) {
  assertPath(rel, 'registry');
}

// npm script names are not files; confirm they exist in package.json when listed.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const npmScripts = registry.dataProvenance?.npm || [];
for (const s of npmScripts) {
  if (!pkg.scripts?.[s]) fail(`package.json missing script ${s}`);
  else ok(`npm script: ${s}`);
}
if (!pkg.scripts?.['verify:ma-skills']) fail('package.json missing script verify:ma-skills');
else ok('npm script: verify:ma-skills');

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log(`\nverify-ma-skills: ${pathSet.size} paths, ${expected.length} skills - OK`);
