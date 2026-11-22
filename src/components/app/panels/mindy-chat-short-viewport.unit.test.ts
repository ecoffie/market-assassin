import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Ask Mindy (Mindy Chat): the answer area stays usable on short windows and phones (2026-11-22).
//
// Measured with the real MindyChatPanel (/design-fixtures/ask-mindy, scripts/acceptance/ask-mindy-viewports.mjs):
//   - The 240px history list was open by default on every screen. On phones it left an 80–150px chat column
//     and widened the page to 674px, so the browser zoomed out; iPhone SE answer area 54px, input off-screen.
//   - The panel was 100vh minus 73px with a fixed header and composer and no floor for the list: iPhone 13
//     landscape answer area 48px; desktop 1280x420 147px.
// After: phones start with history closed (opening it overlays the chat), the panel uses dvh (100vh is taller than the visible area under mobile toolbars), the list has a
// floor, and short windows compact the header/composer. SE 208px, landscape 137px, 1280x420 215px; page width
// equals the screen; source link, next-step suggestion and input reachable on all 9 viewports. 1440x900 unchanged.
//
// These guards pin the CSS the browser check depends on (CI has no browser); the acceptance script is the
// behavioural proof.

const src = readFileSync(join(__dirname, 'MindyChatPanel.tsx'), 'utf8');
const SHORT = '[@media(max-height:500px)]:';

function classOf(marker: string): string[] {
  const at = src.indexOf(marker);
  expect(at, `${marker} not found`).toBeGreaterThan(-1);
  const m = src.slice(at).match(/className="([^"]+)"/);
  expect(m, `className after ${marker}`).toBeTruthy();
  return m![1].split(/\s+/);
}

describe('Mindy Chat keeps the answer area usable on short windows and phones', () => {
  it('panel height follows the visible viewport (dvh, not vh) and is the overlay anchor', () => {
    const cls = classOf('return (\n    // dvh tracks');
    expect(cls).toContain('h-[calc(100dvh-73px)]');
    expect(cls).not.toContain('h-[calc(100vh-73px)]');
    expect(cls).toContain('relative');
  });

  it('history starts closed below the md breakpoint and closes after choosing a chat there', () => {
    expect(src).toContain("const PHONE_SIDEBAR_QUERY = '(min-width: 768px)';");
    expect(src).toMatch(/useEffect\(\(\) => \{ if \(isPhoneWidth\(\)\) setSidebarOpen\(false\); \}, \[isPhoneWidth\]\);/);
    expect((src.match(/if \(isPhoneWidth\(\)\) setSidebarOpen\(false\);/g) || []).length).toBe(3);
  });

  it('on phones the open history overlays the chat; from md up it sits beside it as before', () => {
    const cls = classOf('<aside');
    for (const c of ['absolute', 'inset-y-0', 'left-0', 'z-20', 'md:static', 'w-60', 'shrink-0']) expect(cls).toContain(c);
  });

  it('the message list has a height floor and stays the scroll container', () => {
    const cls = classOf('data-testid="chat-scroll"');
    for (const c of ['flex-1', 'min-h-[7rem]', 'overflow-y-auto']) expect(cls).toContain(c);
  });

  it('short windows compact the chat header and composer instead of squeezing the answer', () => {
    expect(src).toMatch(new RegExp(`<p className="[^"]*${SHORT.replace(/[[\]()]/g, '\\$&')}hidden">\\s*Ask anything about federal contracting`));
    const composer = classOf('{/* Input */}');
    expect(composer).toContain(`${SHORT}py-2`);
    expect(composer).toContain('shrink-0');
    expect(src).toMatch(new RegExp(`text-\\[11px\\] text-faint ${SHORT.replace(/[[\]()]/g, '\\$&')}hidden`));
  });

  it('the header row wraps so its buttons never widen a phone page', () => {
    const at = src.indexOf('<header className="px-4 md:px-6');
    expect(at).toBeGreaterThan(-1);
    const row = src.slice(at).match(/<div className="([^"]+)">/)![1].split(/\s+/);
    expect(row).toContain('flex-wrap');
  });

  it('source links and next-step suggestions still render inside the scrolling answer list', () => {
    const list = src.indexOf('data-testid="chat-scroll"');
    const composer = src.indexOf('{/* Input */}');
    const followups = src.indexOf('msg.followups');
    const citations = src.indexOf('msg.citations');
    expect(followups).toBeGreaterThan(list);
    expect(followups).toBeLessThan(composer);
    expect(citations).toBeGreaterThan(list);
    expect(citations).toBeLessThan(composer);
  });
});
