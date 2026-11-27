import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import McpSetupPage from './page';

/**
 * The Claude steps told people to find Connectors "Under Customize", then click
 * "Add" → "Browse connectors" → "Connect to Claude". Current Claude does not show that path:
 * on a live setup call the user found Mindy via Plugins → the Connectors tab → Browse plugins
 * → search "Mindy" → Add → Allow. Menus vary by Claude version, so a fallback line stays.
 */
function claudeSectionText(): string {
  const html = renderToStaticMarkup(<McpSetupPage />);
  const start = html.indexOf('id="claude"');
  const end = html.indexOf('id="chatgpt"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html
    .slice(start, end)
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&rsquo;/g, "'");
}

describe('Claude connect steps match the current Claude menus', () => {
  it('walks Plugins → Connectors tab → Browse plugins → search Mindy → Add', () => {
    const text = claudeSectionText();
    expect(text).toContain('Open Plugins, then Connectors');
    expect(text).toContain('In Settings, open Plugins, then click the Connectors tab.');
    expect(text).toContain('Click "Browse plugins"');
    expect(text).toContain('Find Mindy and click "Add"');
    expect(text).toContain('Search Mindy, then click Add on the Mindy result.');
  });

  it('keeps a fallback for Claude versions with different menus', () => {
    expect(claudeSectionText()).toContain(
      'If you don\'t see Connectors, open Plugins → Connectors, or search Settings for "connector".',
    );
  });

  it('no longer sends people to menus current Claude does not show', () => {
    const text = claudeSectionText();
    expect(text).not.toContain('Under Customize, click Connectors');
    expect(text).not.toContain('Browse connectors');
    expect(text).not.toContain('Connect to Claude');
  });

  it('keeps the sign-in and Allow steps after Add', () => {
    const text = claudeSectionText();
    expect(text.indexOf('Find Mindy and click "Add"')).toBeLessThan(text.indexOf('Sign in to Mindy'));
    expect(text.indexOf('Sign in to Mindy')).toBeLessThan(text.indexOf('Allow the connection'));
  });
});
