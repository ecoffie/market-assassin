/**
 * Where the customer attaches a file. Production finding 2026-11-27 (Map drawer): asked to connect Drive, Mindy said
 * "None of my tools can link outside accounts... do it yourself in the Mindy app" without saying where.
 * The Map drawer HAS an Attach row (opportunity-map/route.ts buildAttach, label "Attach", shown when uploads are enabled
 * for the caller) but no Drive/OneDrive picker, which lives only in Ask Mindy in the app (/app?panel=chat).
 */
export type FileSurface = 'map' | 'app';

/** The full Ask Mindy chat in the app (same origin as the Map). */
export const ASK_MINDY_CHAT_HREF = '/app?panel=chat';

export function fileControlsNote(a: { surface: FileSurface; uploads: boolean; connected: boolean }): string {
  const head = 'FILES: when the customer asks to attach, upload or share a file, connect Google Drive or OneDrive, or use a document,';
  const never = ' Never say "none of my tools can" or "do it yourself in the app" without saying where.';
  if (!a.uploads && !a.connected) {
    return `${head} say plainly that attaching files is not turned on for their account yet, and offer to work from text they paste into the message box.${never}`;
  }
  const lines: string[] = [];
  if (a.surface === 'map') {
    lines.push(a.uploads
      ? 'For a file from their computer: "Use **Attach** under the message box."'
      : 'For a file from their computer: attaching files is not turned on for their account yet.');
    if (a.connected) lines.push(`For Google Drive or OneDrive: "Open [Ask Mindy](${ASK_MINDY_CHAT_HREF}) in the left sidebar, then use **Use a file from Drive or OneDrive** under the message box." Include that link exactly; this Map panel has no Drive or OneDrive picker.`);
  } else {
    lines.push(a.uploads
      ? 'For a file from their computer: "Use **Attach file** under the message box."'
      : 'For a file from their computer: attaching files is not turned on for their account yet.');
    if (a.connected) lines.push('For Google Drive or OneDrive: "Use **Use a file from Drive or OneDrive** under the message box."');
  }
  return `${head} answer in one step, naming where the control is. ${lines.join(' ')} Once a file is attached, its text reaches you with the message.${never}`;
}
