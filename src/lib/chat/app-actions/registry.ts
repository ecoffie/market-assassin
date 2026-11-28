/**
 * Ask Mindy controls the app and the Map: the ONE action registry (spec: tasks/ask-mindy-app-actions-spec-2026-11-27.md).
 *
 * The server proposes {type:'action', id, name, args} on the chat stream; the client validates it here and runs it
 * through the function behind today's button. Unknown names, unknown arg keys, bad values or a wrong surface are
 * REJECTED whole, never partially applied. View actions run at once with a change line + Undo; write actions (later
 * slices) always need a one-line confirm.
 *
 * The Map runs inside an ES5 script (src/app/opportunity-map/route.ts, ASK_MINDY_JS → MAP_ACTIONS). It mirrors these
 * rules; app-actions-parity.unit.test.ts fails CI if the two drift.
 */

export type ActionSurface = 'map' | 'app';
export type ActionKind = 'view' | 'write';

export const MAX_ACTIONS_PER_TURN = 3;

/** FILT keys a view action may set (each is a control the map bar already has). */
export const MAP_FILTER_KEYS = [
  'state', 'setAside', 'setAsideMulti', 'agency', 'subAgency', 'office', 'naics', 'psc', 'noticeType', 'noticeMulti',
  'closingDays', 'postedDays', 'valueRange', 'vehicle', 'hasDocs', 'hasContact', 'likelihood',
] as const;
export type MapFilterKey = (typeof MAP_FILTER_KEYS)[number];

/** 'none': anything the visible control already allows; 'signed_in'/'pro': the same check the button uses (pro = hasProAccess). */
export type ActionGate = 'none' | 'signed_in' | 'pro';
type JsonSchema = Record<string, unknown>;

export interface ActionDef {
  surfaces: ActionSurface[];
  kind: ActionKind;
  /** Every write action needs the one-line inline confirm; view actions never do. */
  needsConfirm: boolean;
  gate: ActionGate;
  /** Model-facing: when to propose it (one line). */
  description: string;
  args: readonly string[];
  /** JSON Schema for the args (additionalProperties: false); mirrors validateAction. */
  argsSchema: JsonSchema;
}

/**
 * "Take me to ..." (Phase A of tasks/ask-mindy-operates-mindy-plan.md, approved for Mindy Day 2026-11-28). The model
 * names a destination; the /app client maps it to (panel, section) from its own hard-coded table
 * (src/lib/app/nav-destinations.ts, Agent 2), whose keys must equal this list. No panel ids, sections or URLs from the
 * model. Labels are what the answer says, so it stands alone if the customer never clicks.
 */
export const NAV_DESTINATION_IDS = ['my_documents', 'my_pursuits', 'alert_settings', 'billing'] as const;
export type NavDestination = (typeof NAV_DESTINATION_IDS)[number];
export const NAV_DESTINATION_LABELS: Record<NavDestination, string> = {
  my_documents: 'My Documents',
  my_pursuits: 'My Pursuits',
  alert_settings: 'Settings → Alerts & matching',
  billing: 'Settings → Billing & credits',
};

const PLAIN_PATTERN = "^[A-Za-z0-9 ,.&()'/:_-]+$";
const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const NOTICE_PATTERN = '^[A-Za-z0-9_-]{6,64}$';
const FREQUENCIES = ['daily', 'weekly', 'off'];
const str = (maxLength: number, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', minLength: 1, maxLength, pattern: PLAIN_PATTERN, ...extra });
const HORIZON_PROPS = { open: { type: 'boolean' }, recompete: { type: 'boolean' }, forecast: { type: 'boolean' } };

export const ACTIONS: Record<string, ActionDef> = {
  'map.apply_view': {
    surfaces: ['map'], kind: 'view', needsConfirm: false, gate: 'none',
    description: 'Show a view on the Opportunity Map: keyword, filters (state, agency, NAICS, set-aside, …) and which horizons are on. Merges onto the current view unless replace is true.',
    args: ['mode', 'q', 'filters', 'horizons', 'replace'],
    argsSchema: {
      type: 'object', additionalProperties: false, minProperties: 1,
      properties: {
        mode: { type: 'string', enum: ['open', 'recompete'] },
        q: str(120, { minLength: 2 }),
        filters: {
          type: 'object', additionalProperties: false,
          properties: Object.fromEntries((['state', 'setAside', 'setAsideMulti', 'agency', 'subAgency', 'office', 'naics', 'psc', 'noticeType', 'noticeMulti', 'closingDays', 'postedDays', 'valueRange', 'vehicle', 'hasDocs', 'hasContact', 'likelihood'] as const).map((k) => [k, k === 'state' ? { type: 'string', pattern: '^[A-Za-z]{2}( *, *[A-Za-z]{2})*$', maxLength: 80 } : str(80)])),
        },
        horizons: { type: 'object', additionalProperties: false, properties: HORIZON_PROPS },
        replace: { type: 'boolean' },
      },
    },
  },
  'map.search': {
    surfaces: ['map'], kind: 'view', needsConfirm: false, gate: 'none',
    description: 'Search the Opportunity Map for a keyword, exactly as if typed into the search box.',
    args: ['q'],
    argsSchema: { type: 'object', additionalProperties: false, required: ['q'], properties: { q: str(120, { minLength: 2 }) } },
  },
  'map.set_horizons': {
    surfaces: ['map'], kind: 'view', needsConfirm: false, gate: 'none',
    description: 'Choose what the map shows: Open now (open), Coming back (recompete), Coming soon (forecast). Use isolate to show only one.',
    args: ['open', 'recompete', 'forecast', 'isolate'],
    argsSchema: { type: 'object', additionalProperties: false, minProperties: 1, properties: { ...HORIZON_PROPS, isolate: { type: 'string', enum: ['open', 'recompete', 'forecast'] } } },
  },
  'map.go_to': {
    surfaces: ['map'], kind: 'view', needsConfirm: false, gate: 'none',
    description: 'Zoom the map to one US state (2-letter code) or back to the whole country.',
    args: ['state', 'national'],
    argsSchema: { type: 'object', additionalProperties: false, properties: { state: { type: 'string', pattern: '^[A-Za-z]{2}$' }, national: { type: 'boolean', const: true } }, oneOf: [{ required: ['state'] }, { required: ['national'] }] },
  },
  'map.open_record': {
    surfaces: ['map'], kind: 'view', needsConfirm: false, gate: 'none',
    description: 'Open one opportunity on the map. Only a notice id that appeared in THIS turn\'s tool results.',
    args: ['notice_id'],
    argsSchema: { type: 'object', additionalProperties: false, required: ['notice_id'], properties: { notice_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{6,64}$' } } },
  },
  // ── Write actions (slice 2): always the one-line inline confirm; executed by POST /api/app/mindy-actions (Agent 3).
  'app.navigate': {
    surfaces: ['app'], kind: 'view', needsConfirm: false, gate: 'none',
    description: 'Take the customer to a page in the Mindy app: their documents (files Mindy made and their uploads), their pursuits, their alert and matching settings, or billing and credits. Only when they ask where something is or to go there. View only: it never changes a setting.',
    args: ['destination'],
    argsSchema: { type: 'object', additionalProperties: false, required: ['destination'], properties: { destination: { type: 'string', enum: [...NAV_DESTINATION_IDS] } } },
  },
  'map.save_search': {
    surfaces: ['map'], kind: 'write', needsConfirm: true, gate: 'signed_in',
    description: 'Save the map view the customer is looking at as a saved search, with alerts. The client saves exactly what is on screen; give only a short name and the alert frequency.',
    args: ['name', 'alert_frequency'],
    argsSchema: { type: 'object', additionalProperties: false, required: ['name', 'alert_frequency'], properties: { name: str(80), alert_frequency: { type: 'string', enum: FREQUENCIES } } },
  },
  'map.update_alert': {
    surfaces: ['map'], kind: 'write', needsConfirm: true, gate: 'signed_in',
    description: 'Change how often a saved search sends alerts (daily, weekly or off).',
    args: ['search_id', 'alert_frequency'],
    argsSchema: { type: 'object', additionalProperties: false, required: ['search_id', 'alert_frequency'], properties: { search_id: { type: 'string', pattern: UUID_PATTERN }, alert_frequency: { type: 'string', enum: FREQUENCIES } } },
  },
  'map.add_to_pursuits': {
    surfaces: ['map'], kind: 'write', needsConfirm: true, gate: 'signed_in',
    description: "Add an opportunity (notice_id) or recompete (contract_id) the customer chose to My Pursuits. Only an id that appeared in THIS turn's tool results.",
    args: ['kind', 'notice_id', 'contract_id'],
    argsSchema: {
      type: 'object', additionalProperties: false, required: ['kind'],
      properties: { kind: { type: 'string', enum: ['opportunity', 'recompete'] }, notice_id: { type: 'string', pattern: NOTICE_PATTERN }, contract_id: str(64) },
      oneOf: [{ properties: { kind: { const: 'opportunity' } }, required: ['notice_id'], not: { required: ['contract_id'] } }, { properties: { kind: { const: 'recompete' } }, required: ['contract_id'], not: { required: ['notice_id'] } }],
    },
  },
  'map.remove_from_pursuits': {
    surfaces: ['map'], kind: 'write', needsConfirm: true, gate: 'signed_in',
    description: 'Remove an item from My Pursuits (pursuit_id or notice_id).',
    args: ['pursuit_id', 'notice_id'],
    argsSchema: { type: 'object', additionalProperties: false, properties: { pursuit_id: { type: 'string', pattern: UUID_PATTERN }, notice_id: { type: 'string', pattern: NOTICE_PATTERN } }, oneOf: [{ required: ['pursuit_id'] }, { required: ['notice_id'] }] },
  },
};

/** The route's action name (Agent 3 accepts bare names): the registry name without its surface prefix. */
export function routeActionName(name: string): string {
  return name.replace(/^(map|app)\./, '');
}

/**
 * The input schema for the server's propose_app_action tool (Agent 1): one of the registered actions with its own
 * args schema. The server still calls validateAction() before emitting — the model's JSON is never trusted.
 */
export function toolInputSchema(surfaces: ActionSurface[] = ['map', 'app']): JsonSchema {
  const names = Object.entries(ACTIONS).filter(([, d]) => d.surfaces.some((x) => surfaces.includes(x)));
  return {
    type: 'object',
    oneOf: names.map(([name, d]) => ({
      type: 'object', additionalProperties: false, required: ['name', 'args'],
      description: d.description,
      properties: { name: { const: name }, args: d.argsSchema },
    })),
  };
}

const PLAIN = /^[A-Za-z0-9 ,.&()'/:_-]+$/;
const STATES = /^[A-Z]{2}(,[A-Z]{2})*$/;
const NOTICE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FREQ = ['daily', 'weekly', 'off'];
const HORIZONS = ['open', 'recompete', 'forecast'] as const;

export type ValidAction = { id: string; name: string; kind: ActionKind; args: Record<string, unknown> };
export type ActionCheck = { ok: true; action: ValidAction } | { ok: false; reason: string };

function plain(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= max && PLAIN.test(s) ? s : null;
}

/** Validate one stream event for a surface. Never throws. */
export function validateAction(evt: unknown, surface: ActionSurface): ActionCheck {
  if (!evt || typeof evt !== 'object') return { ok: false, reason: 'shape' };
  const e = evt as { type?: unknown; id?: unknown; name?: unknown; args?: unknown };
  if (e.type !== 'action') return { ok: false, reason: 'shape' };
  const id = typeof e.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.id) ? e.id : null;
  if (!id) return { ok: false, reason: 'id' };
  const name = typeof e.name === 'string' ? e.name : '';
  const def = ACTIONS[name];
  if (!def) return { ok: false, reason: 'unknown' };
  if (!def.surfaces.includes(surface)) return { ok: false, reason: 'surface' };
  const raw = e.args && typeof e.args === 'object' && !Array.isArray(e.args) ? (e.args as Record<string, unknown>) : {};
  for (const k of Object.keys(raw)) if (!def.args.includes(k)) return { ok: false, reason: `arg:${k}` };
  const args: Record<string, unknown> = {};

  if (name === 'map.apply_view' || name === 'map.search') {
    if (raw.q != null) { const q = plain(raw.q, 120); if (q == null || q.length < 2) return { ok: false, reason: 'q' }; args.q = q; }
    if (name === 'map.search' && args.q == null) return { ok: false, reason: 'q' };
    if (raw.mode != null) { if (raw.mode !== 'open' && raw.mode !== 'recompete') return { ok: false, reason: 'mode' }; args.mode = raw.mode; }
    if (raw.replace != null) { if (typeof raw.replace !== 'boolean') return { ok: false, reason: 'replace' }; args.replace = raw.replace; }
    if (raw.filters != null) {
      if (typeof raw.filters !== 'object' || Array.isArray(raw.filters)) return { ok: false, reason: 'filters' };
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.filters as Record<string, unknown>)) {
        if (!(MAP_FILTER_KEYS as readonly string[]).includes(k)) return { ok: false, reason: `filter:${k}` };
        const s = plain(v, 80);
        if (s == null) return { ok: false, reason: `filter:${k}` };
        if (k === 'state' && !STATES.test(s.toUpperCase().replace(/ /g, ''))) return { ok: false, reason: 'filter:state' };
        f[k] = k === 'state' ? s.toUpperCase().replace(/ /g, '') : s;
      }
      args.filters = f;
    }
    if (raw.horizons != null) {
      if (typeof raw.horizons !== 'object' || Array.isArray(raw.horizons)) return { ok: false, reason: 'horizons' };
      const h: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(raw.horizons as Record<string, unknown>)) {
        if (!(HORIZONS as readonly string[]).includes(k) || typeof v !== 'boolean') return { ok: false, reason: 'horizons' };
        h[k] = v;
      }
      args.horizons = h;
    }
    if (name === 'map.apply_view' && args.q == null && !args.filters && !args.horizons && !args.mode) return { ok: false, reason: 'empty' };
  } else if (name === 'map.set_horizons') {
    if (raw.isolate != null) { if (!(HORIZONS as readonly string[]).includes(raw.isolate as string)) return { ok: false, reason: 'isolate' }; args.isolate = raw.isolate; }
    for (const h of HORIZONS) if (raw[h] != null) { if (typeof raw[h] !== 'boolean') return { ok: false, reason: h }; args[h] = raw[h]; }
    if (!Object.keys(args).length) return { ok: false, reason: 'empty' };
  } else if (name === 'map.go_to') {
    if (raw.national === true) args.national = true;
    else if (typeof raw.state === 'string' && /^[A-Za-z]{2}$/.test(raw.state)) args.state = raw.state.toUpperCase();
    else return { ok: false, reason: 'place' };
  } else if (name === 'map.open_record') {
    if (typeof raw.notice_id !== 'string' || !NOTICE_ID.test(raw.notice_id)) return { ok: false, reason: 'notice_id' };
    args.notice_id = raw.notice_id;
  } else if (name === 'app.navigate') {
    if (!(NAV_DESTINATION_IDS as readonly string[]).includes(raw.destination as string)) return { ok: false, reason: 'destination' };
    args.destination = raw.destination;
  } else if (name === 'map.save_search') {
    const n = plain(raw.name, 80);
    if (n == null) return { ok: false, reason: 'name' };
    if (!FREQ.includes(raw.alert_frequency as string)) return { ok: false, reason: 'alert_frequency' };
    args.name = n; args.alert_frequency = raw.alert_frequency;
  } else if (name === 'map.update_alert') {
    if (typeof raw.search_id !== 'string' || !UUID.test(raw.search_id)) return { ok: false, reason: 'search_id' };
    if (!FREQ.includes(raw.alert_frequency as string)) return { ok: false, reason: 'alert_frequency' };
    args.search_id = raw.search_id; args.alert_frequency = raw.alert_frequency;
  } else if (name === 'map.add_to_pursuits') {
    if (raw.kind === 'opportunity' && typeof raw.notice_id === 'string' && NOTICE_ID.test(raw.notice_id) && raw.contract_id == null) { args.kind = 'opportunity'; args.notice_id = raw.notice_id; }
    else if (raw.kind === 'recompete' && raw.notice_id == null) { const c = plain(raw.contract_id, 64); if (c == null) return { ok: false, reason: 'contract_id' }; args.kind = 'recompete'; args.contract_id = c; }
    else return { ok: false, reason: 'target' };
  } else if (name === 'map.remove_from_pursuits') {
    const hasP = raw.pursuit_id != null, hasN = raw.notice_id != null;
    if (hasP === hasN) return { ok: false, reason: 'target' };
    if (hasP) { if (typeof raw.pursuit_id !== 'string' || !UUID.test(raw.pursuit_id)) return { ok: false, reason: 'pursuit_id' }; args.pursuit_id = raw.pursuit_id; }
    else { if (typeof raw.notice_id !== 'string' || !NOTICE_ID.test(raw.notice_id)) return { ok: false, reason: 'notice_id' }; args.notice_id = raw.notice_id; }
  }
  return { ok: true, action: { id, name, kind: def.kind, args } };
}
