import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Without the private attendee list, attendee-derived dashboard figures are UNAVAILABLE, never 0.
// (Route modules may only export handlers, so this guards the source; the loader itself is unit-tested
// in src/lib/bootcamp/attendee-list.unit.test.ts.)
const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const page = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'dashboard', 'page.tsx'), 'utf8');

describe('admin dashboard bootcamp card: unavailable, not 0', () => {
  it('reads the attendee list only through the private-input loader', () => {
    expect(route).toContain("import { loadBootcampAttendees } from '@/lib/bootcamp/attendee-list';");
    expect(route).not.toMatch(/bootcamp-attendees-to-enroll\.txt'\)/);
    expect(route).not.toMatch(/fs\.existsSync\(BOOTCAMP_ATTENDEE_FILE\)/);
  });

  it('defaults attendee-derived figures to unavailable', () => {
    const empty = route.slice(route.indexOf('function emptyBootcampRollout()'), route.indexOf('async function getBootcampRollout()'));
    expect(empty).toContain("attendeeList: 'unavailable'");
    expect(empty).toMatch(/totalAttendees: null as number \| null/);
    expect(empty).toMatch(/invitationsRemaining: null as number \| null/);
    expect(empty).toContain("conversionRate: 'unavailable'");
  });

  it('never presents enrolled users as attendees, and derives nothing from an unknown total', () => {
    expect(route).not.toContain('rollout.totalAttendees = fallbackUsers.length');
    expect(route).toContain("rollout.invitationsRemaining = rollout.totalAttendees === null ? null :");
    expect(route).toContain("rollout.conversionRate = rollout.totalAttendees === null ? 'unavailable' :");
  });

  it('the page shows "remaining unavailable" instead of a number or "Complete"', () => {
    expect(page).toContain('invitationsRemaining: number | null;');
    expect(page).toContain('remaining unavailable (attendee list not loaded)');
    expect(page).toContain('const rolloutDone = bc.invitationsRemaining === 0;');
  });
});
