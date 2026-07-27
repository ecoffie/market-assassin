#!/usr/bin/env node
/**
 * Gate: the opportunity-map serves big client scripts as TEMPLATE LITERALS (DRAWER_JS / BOOT_VIEW_JS
 * / etc). tsc validates the TypeScript but treats those template literals as opaque strings — so a
 * JS SYNTAX ERROR inside the client script (e.g. an unbalanced paren) compiles clean, passes the
 * gate, and ships DEAD: the inline <script> throws on load and every function defined after the
 * break (openOppDrawer, drawers) never binds. That exact bug shipped in #495 (an extra ')').
 *
 * This checks each client template literal by RESOLVING it the way the JS engine would (so \\' → \',
 * \\u2014 stays as the browser sees it) and running the V8 parser via new Function().
 */
import { readFileSync } from 'fs';
const src = readFileSync(new URL('../src/app/opportunity-map/route.ts', import.meta.url), 'utf8');

// Grab each `const NAME = ` + backtick template that contains "<script>".
const rx = /const\s+(\w+)\s*=\s*(?:'<script>[^]*?'|`<script>[^]*?<\/script>`)/g;
// Simpler + robust: find every template literal that starts with `<script> or `<script>window
const tplRx = /`(<script>[^]*?<\/script>)`/g;
let m, n = 0, failed = 0;
while ((m = tplRx.exec(src))) {
  n++;
  // Resolve the template literal exactly as JS would: it's a raw template with no ${}, so the
  // VALUE is the source text with escape sequences processed. Use JSON to process \uXXXX/\n, but
  // template literals also turn \\ into \ — do that first, then strip the <script> tags.
  let raw = m[1];
  // Reproduce template-literal cooking for the escapes present here (\\ , \' , \" , \uXXXX, \n):
  let cooked = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') {
      const nx = raw[i + 1];
      if (nx === '\\') { cooked += '\\'; i++; }
      else if (nx === 'n') { cooked += '\n'; i++; }
      else if (nx === 't') { cooked += '\t'; i++; }
      else if (nx === "'") { cooked += "'"; i++; }
      else if (nx === '"') { cooked += '"'; i++; }
      else if (nx === '`') { cooked += '`'; i++; }
      else if (nx === 'u') { cooked += raw.slice(i, i + 6); i += 5; } // keep \uXXXX as a valid JS escape
      else { cooked += raw[i]; }
    } else cooked += raw[i];
  }
  const js = cooked.replace(/^<script>/, '').replace(/<\/script>$/, '');
  try { new Function(js); }
  catch (e) { failed++; console.error(`✗ client template #${n} has a JS syntax error: ${e.message}`); }
}
if (!n) { console.error('check-drawer-js: found NO client <script> templates — did the file move?'); process.exit(1); }
if (failed) { console.error(`\n${failed} client script(s) would throw on load. Fix before shipping.`); process.exit(1); }
console.log(`✓ ${n} client <script> template(s) parse clean.`);
