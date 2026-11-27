'use client';

/**
 * The floating "Ask Mindy" button in the signed-in app (owner, 2026-11-27): it replaces the public
 * "Get help" button inside /app and opens the Ask Mindy chat panel in place. Public pages keep
 * Get help; support inside the app is the account menu's "Get help" row.
 *
 * Hidden on the chat panel itself (it would open what is already open) and over the in-app map,
 * which has its own Ask Mindy. On phones it sits bottom-left (the voice-capture button is bottom-right);
 * on desktop it is bottom-right, below the tab tips hint (TabCoach HINT_BOTTOM = 88px).
 */
import { Sparkles } from 'lucide-react';

/** Hides the public Get help button if its script was already on the page before /app mounted. */
export const HIDE_HELP_WIDGET_CSS = '.mhw-btn,.mhw-p{display:none!important}';

export function shouldShowAskMindyFab(activePanel: string, isMapShell: boolean): boolean {
  return activePanel !== 'chat' && !isMapShell;
}

export default function AskMindyFab({
  activePanel,
  isMapShell,
  onOpen,
}: {
  activePanel: string;
  isMapShell: boolean;
  onOpen: () => void;
}) {
  return (
    <>
      <style>{HIDE_HELP_WIDGET_CSS}</style>
      {shouldShowAskMindyFab(activePanel, isMapShell) && (
        <button
          type="button"
          onClick={onOpen}
          data-testid="ask-mindy-fab"
          className="fixed bottom-5 left-5 md:left-auto md:right-5 z-40 flex items-center gap-2 rounded-full bg-purple-600 hover:bg-purple-500 px-4 py-3 text-[15px] font-semibold text-white shadow-2xl shadow-black/40 transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300 print:hidden"
          aria-label="Ask Mindy"
        >
          <Sparkles className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          Ask Mindy
        </button>
      )}
    </>
  );
}
