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

export const ACTIONS: Record<string, { surfaces: ActionSurface[]; kind: ActionKind; args: readonly string[] }> = {
  'map.apply_view': { surfaces: ['map'], kind: 'view', args: ['mode', 'q', 'filters', 'horizons', 'replace'] },
  'map.search': { surfaces: ['map'], kind: 'view', args: ['q'] },
  'map.set_horizons': { surfaces: ['map'], kind: 'view', args: ['open', 'recompete', 'forecast', 'isolate'] },
  'map.go_to': { surfaces: ['map'], kind: 'view', args: ['state', 'national'] },
  'map.open_record': { surfaces: ['map'], kind: 'view', args: ['notice_id'] },
};

const PLAIN = /^[A-Za-z0-9 ,.&()'/:_-]+$/;
const STATES = /^[A-Z]{2}(,[A-Z]{2})*$/;
const NOTICE_ID = /^[A-Za-z0-9_-]{6,64}$/;
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
  }
  return { ok: true, action: { id, name, kind: def.kind, args } };
}
