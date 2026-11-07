import { describe, expect, it } from 'vitest';
import { PURSUIT_COLLAB_JS, PURSUIT_COLLAB_DISCUSS_HREF } from './pursuit-collab';

type Collab = {
  slot: (p: Record<string, unknown>) => string;
  load: (p: Record<string, unknown>, opts: { email: string; headers: Record<string, string> }) => Promise<void>;
  decisionText: (p: Record<string, unknown>) => string;
  assigneeText: (p: Record<string, unknown>) => string;
};
type FakeRes = { ok: boolean; json: () => Promise<unknown> };

// Execute the emitted page script against a minimal window/document/fetch.
function boot(fetchImpl: (url: string) => Promise<FakeRes>) {
  const slotEl = { attr: '', innerHTML: '', getAttribute: () => slotEl.attr };
  const win: Record<string, unknown> = {};
  const doc = { querySelectorAll: () => (slotEl.attr ? [slotEl] : []) };
  const calls: string[] = [];
  const f = (url: string) => { calls.push(url); return fetchImpl(url); };
  new Function('window', 'document', 'fetch', PURSUIT_COLLAB_JS)(win, doc, f);
  return { collab: win.__pursuitCollab as Collab, slotEl, calls };
}

describe('pursuit collaboration summary (map pursuit pages)', () => {
  it('renders bid decision + owner from the pipeline row, nothing invented when absent', () => {
    const { collab } = boot(() => Promise.reject(new Error('no fetch')));
    expect(collab.decisionText({ bid_decision: 'pursue' })).toBe('Bid decision: Pursue');
    expect(collab.decisionText({ bid_decision: 'skip' })).toBe('Bid decision: No-bid');
    expect(collab.decisionText({ bid_decision: null })).toBe('Bid decision: not made yet');
    // Column absent → render nothing, never "none".
    expect(collab.decisionText({})).toBe('');
    expect(collab.assigneeText({ owner_email: 'a@x.com', collaborators: ['b@x.com', 'c@x.com'] })).toBe('Owner: a@x.com + 2 collaborators');
    expect(collab.assigneeText({ owner_email: null })).toBe('Owner: not assigned');
    expect(collab.assigneeText({})).toBe('');
    const html = collab.slot({ id: 'p1' });
    expect(html).toContain(`href="${PURSUIT_COLLAB_DISCUSS_HREF}"`);
    expect(html).not.toContain('Bid decision');
  });

  it('loads comment count + latest snippet with the page auth headers, once', async () => {
    const { collab, slotEl, calls } = boot(async () => ({
      ok: true,
      json: async () => ({ success: true, comments: [
        { content: 'first', user_email: 'a@x.com' },
        { content: 'Need the <b>bond</b> letter', user_email: 'b@x.com' },
      ] }),
    }));
    slotEl.attr = 'p1';
    await collab.load({ id: 'p1' }, { email: 'me@x.com', headers: { 'x-mi-auth-token': 't' } });
    expect(calls[0]).toBe('/api/app/comments?email=me%40x.com&pipeline_id=p1');
    expect(slotEl.innerHTML).toContain('2 comments');
    expect(slotEl.innerHTML).toContain('latest from b@x.com');
    expect(slotEl.innerHTML).toContain('&lt;b&gt;bond&lt;/b&gt;');
    await collab.load({ id: 'p1' }, { email: 'me@x.com', headers: {} });
    expect(calls).toHaveLength(1);
  });

  it('an error says "couldn’t load", never zero', async () => {
    const { collab, slotEl } = boot(async () => ({ ok: false, json: async () => ({ success: false, error: 'Access denied' }) }));
    slotEl.attr = 'p2';
    await collab.load({ id: 'p2' }, { email: 'me@x.com', headers: {} });
    expect(slotEl.innerHTML).toContain('couldn’t load');
    expect(slotEl.innerHTML).not.toMatch(/0 comments|No comments/);
  });

  it('a real empty list says "No comments yet"', async () => {
    const { collab, slotEl } = boot(async () => ({ ok: true, json: async () => ({ success: true, comments: [] }) }));
    slotEl.attr = 'p3';
    await collab.load({ id: 'p3' }, { email: 'me@x.com', headers: {} });
    expect(slotEl.innerHTML).toContain('No comments yet.');
  });

  it('signed out → no fetch', async () => {
    const { collab, calls } = boot(async () => ({ ok: true, json: async () => ({}) }));
    await collab.load({ id: 'p4' }, { email: '', headers: {} });
    expect(calls).toHaveLength(0);
  });
});
