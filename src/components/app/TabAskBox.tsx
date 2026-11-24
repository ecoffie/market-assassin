'use client';

/**
 * The ONE Ask Mindy box every tab shares (ships OFF behind NEXT_PUBLIC_TAB_ASK — the caller checks
 * isTabAskEnabled() and renders nothing of this when it is off).
 *
 * It never fetches and never renders results. The tab's adapter turns the question into the tab's OWN
 * params; `onAsk` runs the tab's EXISTING load with them (so the answer fills the tab's normal list) and
 * resolves to how many rows came back (`null` = unknown — shown as unavailable, never 0). The box then
 * shows one line saying what Mindy searched, with Clear. A question the tab's filters cannot express is
 * never guessed at: the box shows why and offers "Ask Mindy in chat instead".
 */
import { useId, useState, type FormEvent } from 'react';
import { Sparkles, X, MessageCircle } from 'lucide-react';
import { handOffToChat, parseTabAsk, type ParsedTabAsk, type TabAskAdapter, type TabAskCount } from '@/lib/app/tab-ask';

export interface TabAskBoxProps<P> {
  adapter: TabAskAdapter<P>;
  /** Run the tab's existing load with these params; resolve to the rows shown (null = unknown). */
  onAsk: (params: P, ask: ParsedTabAsk) => Promise<TabAskCount>;
  /** Restore the tab to what it showed before the question. */
  onClear: () => void;
  /** Defaults to the in-app chat handoff (seed + open chat). */
  onAskInChat?: (question: string) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'answered'; summary: string }
  | { kind: 'handoff'; question: string; why: string };

export default function TabAskBox<P>({ adapter, onAsk, onClear, onAskInChat = handOffToChat }: TabAskBoxProps<P>) {
  const inputId = useId();
  const [text, setText] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function ask(question: string) {
    const parsed = parseTabAsk(question, adapter.tabWords);
    const params = adapter.toQuery(parsed);
    if (params === null) {
      setState({ kind: 'handoff', question: parsed.question, why: adapter.whyNot(parsed) });
      return;
    }
    setState({ kind: 'busy' });
    let count: TabAskCount = null;
    try { count = await onAsk(params, parsed); } catch { count = null; }
    setState({ kind: 'answered', summary: adapter.summary(parsed, count) });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || state.kind === 'busy') return;
    void ask(text);
  }

  function clear() {
    setText('');
    setState({ kind: 'idle' });
    onClear();
  }

  return (
    <section
      aria-label="Ask Mindy about this list"
      data-testid="tab-ask"
      data-tab={adapter.tab}
      className="bg-ground border border-surface rounded-xl p-4 space-y-3"
    >
      <form role="search" onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <label htmlFor={inputId} className="sr-only">Ask Mindy</label>
        <div className="relative flex-1 min-w-0">
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-300 pointer-events-none" aria-hidden="true" />
          <input
            id={inputId}
            data-testid="tab-ask-input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={adapter.placeholder}
            autoComplete="off"
            className="w-full pl-9 pr-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-amber-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          data-testid="tab-ask-submit"
          disabled={!text.trim() || state.kind === 'busy'}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-input disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {state.kind === 'busy' ? 'Searching…' : 'Ask Mindy'}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2" aria-label="Example questions">
        <span className="text-xs text-faint">Try:</span>
        {adapter.examples.slice(0, 3).map((ex) => (
          <button
            key={ex}
            type="button"
            data-testid="tab-ask-example"
            onClick={() => { setText(ex); void ask(ex); }}
            disabled={state.kind === 'busy'}
            className="px-2.5 py-1 text-xs rounded-full bg-surface text-ink-soft hover:text-white hover:bg-surface/70 transition-colors"
          >
            {ex}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="min-h-0">
        {state.kind === 'answered' && (
          <div data-testid="tab-ask-summary" className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2">
            <p className="text-sm text-amber-100 min-w-0 break-words">{state.summary}</p>
            <button
              type="button"
              data-testid="tab-ask-clear"
              onClick={clear}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
            </button>
          </div>
        )}
        {state.kind === 'handoff' && (
          <div data-testid="tab-ask-handoff" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
            <p className="text-sm text-ink-soft min-w-0">{state.why}</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="tab-ask-chat"
                onClick={() => onAskInChat(state.question)}
                className="inline-flex items-center gap-1 text-sm text-amber-400 hover:text-amber-300"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" /> Ask Mindy in chat instead
              </button>
              <button type="button" onClick={clear} className="text-xs text-muted hover:text-white">Clear</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
