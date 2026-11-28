import { describe, it, expect } from 'vitest';
import { fileControlsNote, ASK_MINDY_CHAT_HREF } from './file-controls';

describe('fileControlsNote (production 2026-11-27: say WHERE the control is)', () => {
  it('Map: Attach and the in-panel Drive or OneDrive picker are under the message box; connecting goes to Ask Mindy, with the link', () => {
    const n = fileControlsNote({ surface: 'map', uploads: true, connected: true });
    expect(ASK_MINDY_CHAT_HREF).toBe('/app?panel=chat');
    expect(n).toContain('"Use **Attach** under the message box in this panel to add a file from your computer."');
    expect(n).toContain('Use **Drive or OneDrive** under the message box in this panel to pick a file.');
    expect(n).toContain('open [Ask Mindy](/app?panel=chat) in the left sidebar and use **Use a file from Drive or OneDrive** → Connect.');
    expect(n).not.toMatch(/can't take files/);
    expect(n).not.toContain('has no Drive or OneDrive picker');
  });
  it('Map without Drive/OneDrive enabled: no sidebar detour, Attach only', () => {
    const n = fileControlsNote({ surface: 'map', uploads: true, connected: false });
    expect(n).toContain('**Attach** under the message box in this panel');
    expect(n).not.toContain('left sidebar');
    expect(n).not.toContain('Drive or OneDrive**');
  });
  it('app: both controls are under the message box', () => {
    const n = fileControlsNote({ surface: 'app', uploads: true, connected: true });
    expect(n).toContain('"Use **Attach file** under the message box."');
    expect(n).toContain('"Use **Use a file from Drive or OneDrive** under the message box."');
    expect(n).not.toContain('left sidebar');
  });
  it('never "none of my tools can"; with no control enabled it says so plainly', () => {
    for (const surface of ['map', 'app'] as const) expect(fileControlsNote({ surface, uploads: true, connected: true })).toContain('Never say "none of my tools can"');
    const off = fileControlsNote({ surface: 'map', uploads: false, connected: false });
    expect(off).toContain('attaching files is not turned on for their account yet');
    expect(off).not.toContain('/app?panel=chat');
  });
});
