// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SavedSearchesList from './SavedSearchesList';

vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string) => {
    const body = url.includes('badge=1')
      ? { success: true, perSearch: [] }
      : {
          success: true,
          searches: [
            { id: 'bad', name: 'Blocked search', mode: 'open', filters: { naics: '541510' }, alerts_enabled: true, alert_block: 'Email alerts are blocked: NAICS 541510 is not a valid code.' },
            { id: 'good', name: 'Working search', mode: 'open', filters: { naics: '541611' }, alerts_enabled: true, alert_block: null },
          ],
        };
    return new Response(JSON.stringify(body), { status: 200 });
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

describe('SavedSearchesList: a blocked search says so', () => {
  it('shows the notice on the blocked row and never "alerts on" beside it', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    await act(async () => {
      root!.render(<SavedSearchesList email="user@example.com" />);
      await new Promise((r) => setTimeout(r, 20));
    });
    const rows = [...host.querySelectorAll('li')];
    const blocked = rows.find((r) => r.textContent?.includes('Blocked search'))!;
    const good = rows.find((r) => r.textContent?.includes('Working search'))!;
    expect(blocked.querySelector('[role="status"]')?.textContent).toContain('NAICS 541510 is not a valid code');
    expect(blocked.textContent).not.toContain('alerts on');
    expect(good.textContent).toContain('alerts on');
    expect(good.querySelector('[role="status"]')).toBeNull();
  });
});
