import { describe, it, expect } from 'vitest';
import { fileControlsNote, ASK_MINDY_CHAT_HREF } from './file-controls';

describe('fileControlsNote (Map drawer has no file controls; production 2026-11-27)', () => {
  it('Map: one step to Ask Mindy in the left sidebar, with the link, naming only the controls that exist', () => {
    const n = fileControlsNote({ surface: 'map', uploads: true, connected: true });
    expect(ASK_MINDY_CHAT_HREF).toBe('/app?panel=chat');
    expect(n).toContain('Open [Ask Mindy](/app?panel=chat) in the left sidebar, then use **Attach file** or **Use a file from Drive or OneDrive** under the message box.');
    expect(fileControlsNote({ surface: 'map', uploads: true, connected: false })).not.toContain('Drive or OneDrive**');
  });
  it('app: the controls are under the message box', () => {
    const n = fileControlsNote({ surface: 'app', uploads: true, connected: true });
    expect(n).toContain('Use **Attach file** or **Use a file from Drive or OneDrive** under the message box');
    expect(n).not.toContain('left sidebar');
  });
  it('never "none of my tools can"; with no control enabled it says so plainly', () => {
    for (const surface of ['map', 'app'] as const) expect(fileControlsNote({ surface, uploads: true, connected: true })).toContain('Never say "none of my tools can"');
    const off = fileControlsNote({ surface: 'map', uploads: false, connected: false });
    expect(off).toContain('attaching files is not turned on for their account yet');
    expect(off).not.toContain('/app?panel=chat');
  });
});
