/**
 * Where the customer attaches a file. Production finding 2026-11-27 (Map drawer): the Map's Ask Mindy drawer has no
 * Attach file or Drive/OneDrive control, and asked to connect Drive, Mindy said "None of my tools can link outside
 * accounts... do it yourself in the Mindy app" without saying where. The answer now names the place in one step.
 */
export type FileSurface = 'map' | 'app';

/** The full Ask Mindy chat in the app (same origin as the Map). */
export const ASK_MINDY_CHAT_HREF = '/app?panel=chat';

export function fileControlsNote(a: { surface: FileSurface; uploads: boolean; connected: boolean }): string {
  const controls = [a.uploads ? '**Attach file**' : null, a.connected ? '**Use a file from Drive or OneDrive**' : null].filter(Boolean).join(' or ');
  const head = 'FILES: when the customer asks to attach, upload or share a file, connect Google Drive or OneDrive, or use a document,';
  const never = ' Never say "none of my tools can" or "do it yourself in the app" without saying where.';
  if (!controls) {
    return `${head} say plainly that attaching files is not turned on for their account yet, and offer to work from text they paste into the message box.${never}`;
  }
  if (a.surface === 'map') {
    return `${head} answer in one step: "This panel on the Map can't take files. Open [Ask Mindy](${ASK_MINDY_CHAT_HREF}) in the left sidebar, then use ${controls} under the message box." Include that link exactly.${never}`;
  }
  return `${head} answer in one step: "Use ${controls} under the message box, then ask your question." Once a file is attached, its text reaches you with the message.${never}`;
}
