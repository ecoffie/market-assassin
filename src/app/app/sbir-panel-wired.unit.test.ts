/**
 * /app SBIR panel wiring (Eric 2026-07-28). The /app shell had NO SBIR surface (only /briefings did),
 * so the DoD SBIR ingestion (#6) had nowhere to appear for app users. This asserts the panel is
 * registered end-to-end: the AppPanel type, the sidebar nav entry, the PanelContainer case, and the
 * deep-link KNOWN_PANELS set. Source-level (a full render needs the app shell) but it locks the wiring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const sidebar = readFileSync(join(root, 'components/app/UnifiedSidebar.tsx'), 'utf8');
const container = readFileSync(join(root, 'components/app/panels/index.tsx'), 'utf8');
const appPage = readFileSync(join(root, 'app/app/page.tsx'), 'utf8');
const wrapper = readFileSync(join(root, 'components/app/panels/SbirPanel.tsx'), 'utf8');

describe('SBIR panel is registered in the /app shell', () => {
  it("'sbir' is an AppPanel type value", () => {
    expect(sidebar).toContain("| 'sbir'");
  });
  it('the sidebar nav has an SBIR/STTR entry (funding-intel category, pro+)', () => {
    expect(sidebar).toContain("id: 'sbir'");
    expect(sidebar).toContain('SBIR / STTR');
    expect(sidebar).toContain('FlaskConical'); // icon imported + used
  });
  it('the PanelContainer lazy-imports + renders the SbirPanel for case "sbir"', () => {
    expect(container).toContain("const SbirPanel = lazy(() => import('./SbirPanel'))");
    expect(container).toContain("case 'sbir':");
    expect(container).toContain('<SbirPanel email={email} tier={tier} />');
  });
  it("deep-link KNOWN_PANELS includes 'sbir' (so /app?panel=sbir works)", () => {
    expect(appPage).toContain("'grants', 'sbir'");
  });
  it('the /app wrapper reuses the existing briefings SbirPanel (no 400-line duplicate)', () => {
    expect(wrapper).toContain("import BriefingsSbirPanel from '@/components/briefings/SbirPanel'");
    expect(wrapper).toContain('<BriefingsSbirPanel email={email ?? \'\'} />');
    // accepts null email like the rest of the container
    expect(wrapper).toContain('email: string | null');
  });
});
