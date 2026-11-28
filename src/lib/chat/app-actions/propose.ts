/**
 * Ask Mindy controls the app and the Map: the SERVER half (spec: tasks/ask-mindy-app-actions-spec-2026-11-27.md).
 *
 * One chat-private tool, propose_app_action, offered to standard Ask Mindy and research mode when
 * ASK_MINDY_APP_ACTIONS is on for the user (flag + allowlist) and the asking surface has at least one registered action.
 * Never on card turns (the caller does not build a proposer there). The model's JSON is never trusted: every call is run
 * through the registry's validateAction() before an {type:'action'} event is emitted, and the tool returns "proposed",
 * never "done" — the client decides and executes.
 *
 * Server rules on top of the registry:
 * - at most MAX_ACTIONS_PER_TURN accepted proposals per turn (later ones are refused, never emitted);
 * - map.open_record only for a notice id that appeared in THIS turn's tool results (Eric, 2026-11-27) — an id the model
 *   read in a prompt-injected page or typed from memory is refused;
 * - a 'pro' gate uses the same hasProAccess answer the route already computed; 'signed_in' is always true here (the
 *   chat route only runs for a verified user);
 * - write actions carry needs_confirm: true (the client shows the one-line confirm). None are registered yet.
 */
import { randomUUID } from 'node:crypto';
import { ACTIONS, MAX_ACTIONS_PER_TURN, validateAction, type ActionSurface } from './registry';

export const PROPOSE_APP_ACTION = 'propose_app_action';

type Env = Record<string, string | undefined>;

/** Flag + allowlist (spec "Gating and flag"): off unless ASK_MINDY_APP_ACTIONS='true' and the email is listed (or '*'). */
export function appActionsEnabledFor(email: string | null | undefined, env: Env = process.env): boolean {
  if (env.ASK_MINDY_APP_ACTIONS !== 'true' || !email) return false;
  const list = (env.ASK_MINDY_APP_ACTIONS_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes('*') || list.includes(email.trim().toLowerCase());
}

/**
 * Which surface is asking. The client says so explicitly (`surface: 'map' | 'app'`); until every client sends it, the
 * Map drawer is recognised by its display hint ('narrow_panel' is sent only by the Map). Anything else is the app.
 */
export function parseActionSurface(body: { surface?: unknown; display?: unknown }): ActionSurface {
  if (body.surface === 'map' || body.surface === 'app') return body.surface;
  return body.display === 'narrow_panel' ? 'map' : 'app';
}

export function actionNamesFor(surface: ActionSurface): string[] {
  return Object.entries(ACTIONS).filter(([, d]) => d.surfaces.includes(surface)).map(([n]) => n);
}

/**
 * The tool definition (OpenAI function shape; research mode converts it). Providers refuse a top-level oneOf/anyOf in
 * a tool's input schema, so `name` is an enum of this surface's actions and `args` is an object whose shape per action
 * is spelled out in the description. The registry's own validateAction() is the real check.
 */
export function proposeAppActionToolDef(surface: ActionSurface) {
  const names = actionNamesFor(surface);
  const lines = names.map((n) => {
    const d = ACTIONS[n];
    const props = (d.argsSchema as { properties?: Record<string, unknown> }).properties ?? {};
    return `- ${n}: ${d.description} args: ${JSON.stringify(props)}`;
  });
  return {
    type: 'function' as const,
    function: {
      name: PROPOSE_APP_ACTION,
      description: [
        'Change what the customer is looking at in the app (beta). Use ONLY when the customer asked to see, filter, open or go',
        'somewhere on this page. One action per intent; at most 3 per answer. The page applies it and shows the change with Undo,',
        'so this returns "proposed", never "done". ALWAYS also answer in words: the answer must stand alone without the action.',
        'map.open_record only with a notice id that appeared in a tool result in THIS answer. Never invent filter values.',
        'Actions:',
        ...lines,
      ].join('\n'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'args'],
        properties: {
          name: { type: 'string', enum: names },
          args: { type: 'object', description: 'The arguments for that action, exactly as listed above.' },
        },
      },
    },
  };
}

/**
 * Production test 2026-11-28: "change the TEST actions smoke alerts to daily" ran IMMEDIATELY through the chat tool
 * update_market_schedule (allowed_write, no confirm) instead of map.update_alert (confirm). On a turn where app actions
 * are offered, the direct saved-search writes are not offered: creating a saved search or changing its alerts goes
 * only through the confirmed actions (map.save_search / map.update_alert).
 */
export const ACTION_OWNED_WRITE_TOOLS: ReadonlySet<string> = new Set(['schedule_market_search', 'update_market_schedule']);

/** One line for the system prompt, so the model knows the tool exists and when not to use it. */
export const APP_ACTIONS_NOTE =
  'APP ACTIONS (beta): propose_app_action can change what the customer sees on this page (filters, horizons, zoom, opening'
  + ' a record). Use it only when they asked to see, filter, open or go somewhere, once per intent, and always answer in words'
  + ' too. Saving a search or changing its alerts goes ONLY through map.save_search / map.update_alert (frequencies: daily,'
  + ' weekly or off; say plainly that other schedules, such as certain weekdays, are not available).'
  + ' Never say the change was made: say what you set it to show. A save, add, change or remove is only WAITING until the'
  + ' customer clicks its button: tell them which button to click (for example "Click Add to save it to My Pursuits") and'
  + ' never write "I\'ve added", "I\'ve sent", "saved" or "done" for it.';

/**
 * The button the client shows for each write (must match ACT_WRITES in the Map route) and what clicking it does.
 * The model's reply while a write is pending quotes this, so the customer is told to click, never told it is done.
 */
export const WRITE_CONFIRM_HINTS: Record<string, { button: string; does: string }> = {
  'map.save_search': { button: 'Save', does: 'save this view as a saved search with alerts' },
  'map.update_alert': { button: 'Change', does: 'change how often that search sends alerts' },
  'map.add_to_pursuits': { button: 'Add', does: 'save it to My Pursuits' },
  'map.remove_from_pursuits': { button: 'Remove', does: 'remove it from My Pursuits' },
};

/** The reply text the model gets back for an accepted write: pending, with the exact sentence to use. */
/** What clicking will do, from the validated args (search name, frequency), so the sentence is specific. */
function pendingDoes(name: string, args: Record<string, unknown> | undefined, fallback: string): string {
  const freq = typeof args?.alert_frequency === 'string' ? args.alert_frequency : null;
  const freqWords = freq === 'off' ? 'with alerts paused' : freq ? `with ${freq} alerts` : '';
  if (name === 'map.save_search' && typeof args?.name === 'string') return `save this view as "${args.name}"${freqWords ? ` ${freqWords}` : ''}`;
  if (name === 'map.update_alert' && freq) return freq === 'off' ? 'pause that search\'s alerts' : `switch that search to ${freq} alerts`;
  return fallback;
}

/**
 * The reply the model gets for an accepted write: pending, with the exact sentence to use. Production test 2026-11-28:
 * before Save was clicked Mindy said "I've set up a saved search called ...": the rule covers EVERY write action.
 */
export function pendingWriteNote(name: string, args?: Record<string, unknown>): string {
  const h = WRITE_CONFIRM_HINTS[name];
  const say = h ? `Click ${h.button} to ${pendingDoes(name, args, h.does)}.` : 'Click the button under this answer to confirm it.';
  return `NOT DONE YET: the page is showing a confirm button and nothing changes until the customer clicks it. Say exactly: "${say}"`
    + ' Never write "I\'ve added", "I\'ve sent", "I\'ve saved", "I\'ve set up", "I\'ve created", "I\'ve changed", "I\'ve updated",'
    + ' "I\'ve removed", "saved", "added", "set up", "is now set" or "done" about it in this answer.';
}

export interface ActionEvent {
  type: 'action';
  id: string;
  name: string;
  args: Record<string, unknown>;
  needs_confirm?: true;
}

export interface AppActionProposer {
  readonly surface: ActionSurface;
  /** Feed every successful tool result of this turn (the evidence an open_record id must appear in). */
  observeToolResult(toolName: string, content: string): void;
  /** Execute one propose_app_action call: validate, emit at most MAX_ACTIONS_PER_TURN events, return the model reply. */
  propose(input: Record<string, unknown>): Record<string, unknown>;
  /** For the turn trace: accepted names and refusal reasons, in order. */
  readonly log: Array<{ name: string; outcome: string }>;
}

export function createAppActionProposer(opts: {
  surface: ActionSurface;
  emit: (evt: ActionEvent) => void;
  hasPro: boolean;
  newId?: () => string;
}): AppActionProposer {
  const evidence: string[] = [];
  const log: Array<{ name: string; outcome: string }> = [];
  let accepted = 0;
  const newId = opts.newId ?? (() => randomUUID());
  const refuse = (name: string, reason: string, message: string) => {
    log.push({ name, outcome: `rejected:${reason}` });
    return { status: 'rejected', reason, message };
  };

  return {
    surface: opts.surface,
    log,
    observeToolResult(toolName, content) {
      if (toolName === PROPOSE_APP_ACTION || typeof content !== 'string' || !content) return;
      evidence.push(content);
    },
    propose(input) {
      const name = typeof input?.name === 'string' ? input.name.slice(0, 60) : '';
      if (accepted >= MAX_ACTIONS_PER_TURN) {
        return refuse(name, 'max', `Only ${MAX_ACTIONS_PER_TURN} page changes per answer; this one was not sent. Describe it in words instead.`);
      }
      const id = newId();
      const check = validateAction({ type: 'action', id, name, args: input?.args }, opts.surface);
      if (!check.ok) {
        return refuse(name, check.reason, 'That change is not available on this page with those settings, so it was not sent. Answer in words.');
      }
      const def = ACTIONS[check.action.name];
      if (def.gate === 'pro' && !opts.hasPro) {
        return refuse(name, 'gate', 'That change needs a Pro plan, so it was not sent. Answer in words.');
      }
      if (check.action.name === 'map.open_record') {
        const nid = String(check.action.args.notice_id);
        if (!evidence.some((t) => t.includes(nid))) {
          return refuse(name, 'unsourced', 'Only an opportunity returned by a tool in this answer can be opened. Answer in words.');
        }
      }
      accepted += 1;
      const evt: ActionEvent = { type: 'action', id, name: check.action.name, args: check.action.args };
      if (def.needsConfirm) evt.needs_confirm = true;
      opts.emit(evt);
      log.push({ name: check.action.name, outcome: 'proposed' });
      return {
        status: 'proposed',
        id,
        note: def.needsConfirm
          ? pendingWriteNote(check.action.name, check.action.args)
          : 'Sent to the page; it applies the change and offers Undo. Do not say it was done; say what you set it to show.',
      };
    },
  };
}
