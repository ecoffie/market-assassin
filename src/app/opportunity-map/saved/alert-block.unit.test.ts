import { describe, it, expect } from 'vitest';
import { GET } from './route';

/** The Watchlist page is a served HTML template: prove the row notice is wired, escaped, and parses. */
describe('Watchlist page: a blocked search says so', () => {
  it('renders alert_block from the list API through h() in a parseable script', async () => {
    const html = await (await GET()).text();
    expect(html).toContain(`(r.alert_block?'<div class="rptwarn" role="status">\\u26a0 '+h(r.alert_block)+'</div>':'')`);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const page = scripts.find((s) => s.includes('r.alert_block'));
    expect(page).toBeTruthy();
    expect(() => new Function(page!)).not.toThrow();
  });
});
