/** Read-only proof of the DSIP public topic list. Does not write dod_sbir_topics. */
import { fetchDodPortalOpenTopics } from '../src/lib/sbir/dod-topics-portal';

const r = await fetchDodPortalOpenTopics();
const open = r.rows.filter((x) => x.status === 'open').length;
const pre = r.rows.filter((x) => x.status === 'pre-release').length;
console.log(JSON.stringify({
  complete: r.complete,
  degraded: r.degraded,
  error: r.error ?? null,
  reportedTotal: r.reportedTotal,
  rows: r.rows.length,
  pages: r.pages,
  open,
  pre,
  sample: r.rows.slice(0, 2),
}, null, 2));
