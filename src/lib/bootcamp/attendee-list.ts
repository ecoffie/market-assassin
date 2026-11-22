/**
 * The bootcamp attendee list is a private input: an absolute path OUTSIDE the repository, given by
 * BOOTCAMP_ATTENDEE_FILE. It is never committed.
 *
 * Callers must treat anything other than { ok: true } as UNAVAILABLE — never as "0 attendees":
 *   - the rollout cron refuses (and sends nothing);
 *   - the admin dashboard reports the attendee-derived figures as unavailable.
 */
import fs from 'fs';

export const BOOTCAMP_ATTENDEE_FILE_ENV = 'BOOTCAMP_ATTENDEE_FILE';

export type AttendeeListResult =
  | { ok: true; emails: string[] }
  | { ok: false; reason: 'not_configured' | 'inside_repository' | 'unreadable' | 'empty' };

export interface AttendeeListDeps {
  env?: Record<string, string | undefined>;
  cwd?: string;
  readFile?: (p: string) => string;
}

export function loadBootcampAttendees(deps: AttendeeListDeps = {}): AttendeeListResult {
  const env = deps.env ?? process.env;
  const cwd = deps.cwd ?? process.cwd();
  const p = (env[BOOTCAMP_ATTENDEE_FILE_ENV] || '').trim();
  if (!p) return { ok: false, reason: 'not_configured' };
  const cwdPrefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  if (!p.startsWith('/') || p === cwd || p.startsWith(cwdPrefix)) return { ok: false, reason: 'inside_repository' };
  let raw: string;
  try {
    raw = (deps.readFile ?? ((f: string) => fs.readFileSync(f, 'utf8')))(p);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const emails = Array.from(new Set(
    raw.split(/\r?\n/).map((e) => e.toLowerCase().trim()).filter((e) => e && e.includes('@') && !e.includes(' ')),
  ));
  if (!emails.length) return { ok: false, reason: 'empty' };
  return { ok: true, emails };
}
