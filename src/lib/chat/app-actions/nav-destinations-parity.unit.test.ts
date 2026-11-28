/**
 * The server's app.navigate destinations (registry, Agent 1) and the /app client's table (src/lib/app/nav-destinations.ts,
 * Agent 2, #2586) must not drift: same keys, same "where it is" labels. The model's answer quotes the server label; the
 * card shows the client label.
 */
import { describe, it, expect } from 'vitest';
import { NAV_DESTINATION_IDS, NAV_DESTINATION_LABELS, ACTIONS } from './registry';
import { NAV_DESTINATIONS, NAV_DESTINATION_KEYS } from '@/lib/app/nav-destinations';

describe('app.navigate destinations: server registry == /app client table', () => {
  it('same keys, in the same order', () => {
    expect([...NAV_DESTINATION_IDS]).toEqual([...NAV_DESTINATION_KEYS]);
    expect((ACTIONS['app.navigate'].argsSchema as { properties: { destination: { enum: string[] } } }).properties.destination.enum).toEqual([...NAV_DESTINATION_KEYS]);
  });
  it('each label matches the client target label', () => {
    for (const k of NAV_DESTINATION_KEYS) expect(NAV_DESTINATION_LABELS[k]).toBe(NAV_DESTINATIONS[k].label);
  });
});
