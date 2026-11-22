/**
 * Customer exports, rollback SQL, attendee lists and call transcripts are PRIVATE: they live in a
 * directory outside the repository, named by MINDY_PRIVATE_DIR (absolute path). Scripts that read or
 * write that kind of file must resolve it through here; they refuse to run without it, so nothing of
 * the sort can be written into the working tree (and committed) again.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function privateDir() {
  const dir = (process.env.MINDY_PRIVATE_DIR || '').trim();
  const resolved = dir ? path.resolve(dir) : '';
  if (!resolved || !path.isAbsolute(dir) || resolved === REPO_ROOT || resolved.startsWith(REPO_ROOT + path.sep)) {
    console.error('Refusing to run: set MINDY_PRIVATE_DIR to an absolute directory OUTSIDE the repository.');
    console.error('Customer data, exports and rollback files must never be written into the working tree.');
    process.exit(1);
  }
  return resolved;
}

/** An absolute path inside MINDY_PRIVATE_DIR (directories are created on demand by callers). */
function privatePath(...parts) {
  return path.join(privateDir(), ...parts);
}

module.exports = { privateDir, privatePath, REPO_ROOT };
