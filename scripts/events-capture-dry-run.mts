/**
 * Read-only preview of one extract-sam-events calendar slice.
 * Fetches the public SBA events pages and prints what a run would insert.
 * No database writes. No SAM.gov API call (that half reads sam_opportunities, which
 * this script does not have credentials for on a bare checkout).
 *
 *   npx tsx scripts/events-capture-dry-run.mts
 */
import { collectSbaEvents } from '../src/lib/events/sba-calendar';
import { NEW_CALENDAR_EVENTS_PER_RUN, NEW_SAM_EVENTS_PER_RUN } from '../src/lib/events/capture-plan';

const today = new Date();
const result = await collectSbaEvents({ today, runAt: today.toISOString(), cap: NEW_CALENDAR_EVENTS_PER_RUN });
const wouldAdd = result.events.length;

console.log(JSON.stringify({
  measuredAt: today.toISOString(),
  writes: false,
  samApiCalled: false,
  calendar: {
    source: 'https://legacy.sba.gov/events',
    relevantInWindow: result.relevant,
    wouldInsertThisRun: wouldAdd,
    deferredPastCap: result.deferred,
    cap: NEW_CALENDAR_EVENTS_PER_RUN,
    truncated: result.truncated,
    error: result.error,
    sample: result.events.slice(0, 8).map((e) => ({
      notice_id: e.notice_id,
      title: e.title,
      date: e.event_date,
      location: e.event_location,
      registration_url: e.registration_url,
      host: e.inferred_office,
      source: e.contact_info,
      linked_sam_notice_id: null,
    })),
  },
  samNotices: {
    measured: false,
    reason: 'SAM candidates are the notices already in sam_opportunities. This checkout has no Supabase credentials, so the new-notice count is unmeasured. The run cap for those inserts is NEW_SAM_EVENTS_PER_RUN.',
    cap: NEW_SAM_EVENTS_PER_RUN,
  },
}, null, 2));

if (result.error && wouldAdd === 0) process.exit(2);
