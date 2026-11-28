// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import McpSetupPage from './page';
import CopyAddressButton from './CopyAddressButton';
import { SETUP_MCP_URL } from './setup-copy';

/**
 * The setup guide tells people to paste the connector address (ChatGPT step 2, Other
 * assistants) but the address box had no Copy button: a beginner had to select a small
 * monospace URL by hand, which is hard on a phone.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('setup guide address box has a Copy button', () => {
  it('the page renders a Copy address button inside "The address you\'ll paste" box', () => {
    const html = renderToStaticMarkup(<McpSetupPage />);
    const start = html.indexOf('data-testid="setup-address-box"');
    expect(start, 'address box').toBeGreaterThan(-1);
    // The box runs until the "Which AI do you use?" chooser that follows it.
    const box = html.slice(start, html.indexOf('which-ai-heading', start));
    expect(box).toContain('The address you’ll paste');
    expect(box).toContain(SETUP_MCP_URL);
    expect(box).toMatch(/<button[^>]*aria-label="Copy the address https:\/\/mcp\.getmindy\.ai\/mcp"[^>]*>Copy address<\/button>/);
  });

  describe('clicking it', () => {
    let host: HTMLDivElement;
    let root: Root;
    const writeText = vi.fn<(t: string) => Promise<void>>();

    beforeEach(() => {
      writeText.mockReset().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
    });
    afterEach(() => {
      act(() => root.unmount());
      host.remove();
      vi.useRealTimers();
    });

    it('copies the exact address and says "Copied", then resets', async () => {
      vi.useFakeTimers();
      await act(async () => { root.render(<CopyAddressButton text={SETUP_MCP_URL} />); });
      const btn = host.querySelector('button')!;
      expect(btn.textContent).toBe('Copy address');
      await act(async () => { btn.click(); });
      expect(writeText).toHaveBeenCalledWith('https://mcp.getmindy.ai/mcp');
      expect(btn.textContent).toBe('Copied');
      expect(btn.getAttribute('aria-label')).toBe('Address copied');
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(btn.textContent).toBe('Copy address');
    });

    it('stays on "Copy address" when the clipboard is blocked (the address is still on screen)', async () => {
      writeText.mockRejectedValue(new Error('blocked'));
      await act(async () => { root.render(<CopyAddressButton text={SETUP_MCP_URL} />); });
      const btn = host.querySelector('button')!;
      await act(async () => { btn.click(); });
      expect(btn.textContent).toBe('Copy address');
    });
  });
});
