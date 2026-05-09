#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = process.cwd();
const routes = childProcess
  .execFileSync('find', ['src/app/api', '-name', 'route.ts'], { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)
  .sort();

const authMarkers = [
  'requireMIAuthSession',
  'requireTwoFactorSession',
  'verifyMIAccess',
  'verifyMAAccess',
  'verifyAdminPassword',
  'verifyAdminSecret',
  'ADMIN_PASSWORD',
  'ADMIN_SECRET',
  'CRON_SECRET',
  'cronSecret',
  'x-api-key',
  'authorization',
  'Bearer',
  'validateRequest',
  'constructEvent',
  'signature',
  'token',
  'password',
];

const knownPublicOrTokenized = [
  '/api/access-links/consume/',
  '/api/access-links/request/',
  '/api/alerts/unsubscribe/',
  '/api/briefings/feedback/',
  '/api/capture-lead/',
  '/api/feedback/',
  '/api/ma-access/[token]/',
  '/api/database-access/[token]/',
  '/api/track/',
  '/api/webhooks/',
];

function routeName(file) {
  return `/${path.dirname(file).replace(/^src\/app\//, '')}/`;
}

const candidates = [];
const publicOrTokenized = [];

for (const file of routes) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const route = routeName(file);
  const hasAuthMarker = authMarkers.some((marker) => source.includes(marker));
  const isKnownPublic = knownPublicOrTokenized.some((prefix) => route.startsWith(prefix));

  if (!hasAuthMarker && !isKnownPublic) {
    candidates.push({ route, file });
  } else if (isKnownPublic) {
    publicOrTokenized.push({ route, file, hasAuthMarker });
  }
}

console.log(JSON.stringify({
  totalRoutes: routes.length,
  openCandidateCount: candidates.length,
  openCandidates: candidates,
  knownPublicOrTokenizedCount: publicOrTokenized.length,
  knownPublicOrTokenized,
}, null, 2));
