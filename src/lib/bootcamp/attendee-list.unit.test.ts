import { describe, it, expect } from 'vitest';
import { loadBootcampAttendees } from './attendee-list';

const CWD = '/srv/app';
const read = (content: string) => () => content;
const at = '@';

describe('bootcamp attendee list is a private input', () => {
  it('not configured → unavailable (never an empty success)', () => {
    expect(loadBootcampAttendees({ env: {}, cwd: CWD })).toEqual({ ok: false, reason: 'not_configured' });
  });
  it('a path inside the repository is refused', () => {
    expect(loadBootcampAttendees({ env: { BOOTCAMP_ATTENDEE_FILE: `${CWD}/data/x.txt` }, cwd: CWD })).toEqual({ ok: false, reason: 'inside_repository' });
    expect(loadBootcampAttendees({ env: { BOOTCAMP_ATTENDEE_FILE: 'data/x.txt' }, cwd: CWD })).toEqual({ ok: false, reason: 'inside_repository' });
  });
  it('unreadable → unavailable', () => {
    const r = loadBootcampAttendees({ env: { BOOTCAMP_ATTENDEE_FILE: '/private/x.txt' }, cwd: CWD, readFile: () => { throw new Error('ENOENT'); } });
    expect(r).toEqual({ ok: false, reason: 'unreadable' });
  });
  it('empty → unavailable, never "0 attendees"', () => {
    expect(loadBootcampAttendees({ env: { BOOTCAMP_ATTENDEE_FILE: '/private/x.txt' }, cwd: CWD, readFile: read('\n  \n') })).toEqual({ ok: false, reason: 'empty' });
  });
  it('reads, normalises and de-duplicates a private list', () => {
    const r = loadBootcampAttendees({ env: { BOOTCAMP_ATTENDEE_FILE: '/private/x.txt' }, cwd: CWD, readFile: read(`A${at}example.com\na${at}example.com\nnot an email\nb${at}example.com`) });
    expect(r).toEqual({ ok: true, emails: [`a${at}example.com`, `b${at}example.com`] });
  });
});
