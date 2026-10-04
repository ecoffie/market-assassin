import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The brand migration is complete only if every routable page is either on the public design
 * system (src/lib/public-site/opt-in.json) or listed, with a reason, in
 * docs/design/public-site/NOT-MIGRATED.md. A new page that is in neither is a forgotten page.
 */
const ROOT = process.cwd();
const APP = join(ROOT, 'src/app');
const manifest = JSON.parse(readFileSync(join(ROOT, 'src/lib/public-site/opt-in.json'), 'utf8')) as { files: string[] };
const doc = readFileSync(join(ROOT, 'docs/design/public-site/NOT-MIGRATED.md'), 'utf8');

/** Product, internal and machine trees the inventory covers as a whole. */
const WHOLE_TREES = ['/api', '/admin', '/app', '/opportunity-map', '/design-fixtures', '/.well-known'];

function routeEntries(dir: string, out: { route: string; file: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routeEntries(p, out);
    else if (/^(page|route)\.tsx?$/.test(name)) {
      const rel = relative(APP, dir).split('\\').join('/');
      const route = ('/' + rel).replace(/\/\([^)]+\)/g, '').replace(/\/$/, '') || '/';
      out.push({ route, file: relative(ROOT, p).split('\\').join('/') });
    }
  }
  return out;
}

const listed = [...doc.matchAll(/`(\/[^`\s]*)`/g)].map((m) => m[1]);
const isListed = (route: string) =>
  listed.some((l) => {
    if (l.includes('*')) return new RegExp('^' + l.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(route);
    return route === l || route.startsWith(l.replace(/\/$/, '') + '/');
  });
const isOptedIn = (file: string) => manifest.files.some((o) => file === o || file.startsWith(o.replace(/\/$/, '') + '/'));

describe('public design migration inventory', () => {
  it('accounts for every routable page: migrated, or listed in NOT-MIGRATED.md', () => {
    const forgotten = routeEntries(APP)
      .filter(({ route }) => !WHOLE_TREES.some((t) => route === t || route.startsWith(t + '/')))
      .filter(({ route, file }) => !isOptedIn(file) && !isListed(route))
      .map(({ route, file }) => `${route}  (${file})`);
    expect(forgotten).toEqual([]);
  });
});
