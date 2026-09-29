import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { desiredPayloads, planSync, validateConfig, FREE_TIER_MONITOR_LIMIT, type MonitorConfig } from './betterstack';

const config: MonitorConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../monitoring/betterstack-monitors.json', import.meta.url)), 'utf8'),
);

describe('monitoring/betterstack-monitors.json', () => {
  it('is valid and inside the free tier', () => {
    expect(validateConfig(config)).toEqual([]);
    expect(config.monitors.length).toBeLessThanOrEqual(FREE_TIER_MONITOR_LIMIT);
  });

  it('covers every required endpoint for both availability and latency', () => {
    const required = ['/', '/today', '/sitemap.xml', '/contractors/the-boeing-company', '/api/health'];
    for (const profile of ['availability', 'latency'] as const) {
      const paths = config.monitors.filter((m) => m.profile === profile).map((m) => m.path);
      expect(paths.sort()).toEqual([...required].sort());
    }
  });

  it('requires persistence before alerting: about 2 checks down, about 3 checks slow', () => {
    const freq = Number(config.defaults.check_frequency);
    expect(freq).toBe(300);
    expect(config.profiles.availability.confirmation_period / freq).toBeGreaterThanOrEqual(1);
    expect(config.profiles.latency.confirmation_period / freq).toBeGreaterThanOrEqual(3);
    expect(config.profiles.latency.request_timeout).toBe(3);
  });

  it('checks from more than one region', () => {
    expect((config.defaults.regions as string[]).length).toBeGreaterThanOrEqual(2);
  });
});

describe('desiredPayloads', () => {
  it('builds absolute URLs, prefixed names, and merges profile settings', () => {
    const p = desiredPayloads(config);
    const home = p.find((x) => x.pronounceable_name === '[mindy] Home')!;
    expect(home).toMatchObject({ url: 'https://getmindy.ai/', monitor_type: 'keyword', required_keyword: 'Mindy', request_timeout: 10, confirmation_period: 300 });
    const lat = p.find((x) => x.pronounceable_name === '[mindy] Latency: Home')!;
    expect(lat).toMatchObject({ url: 'https://getmindy.ai/', monitor_type: 'status', request_timeout: 3, confirmation_period: 900 });
    expect(lat).not.toHaveProperty('required_keyword');
  });

  it('can target a preview host and attach an escalation policy', () => {
    const p = desiredPayloads(config, { baseUrl: 'https://preview.example.com/', policyId: 'pol_1' });
    expect(p.every((x) => x.url.startsWith('https://preview.example.com/'))).toBe(true);
    expect(p.every((x) => x.policy_id === 'pol_1')).toBe(true);
  });
});

describe('planSync', () => {
  it('creates everything in an empty account', () => {
    const plan = planSync(config, []);
    expect(plan.create).toHaveLength(config.monitors.length);
    expect(plan.update).toEqual([]);
    expect(plan.orphans).toEqual([]);
  });

  it('is idempotent: a second run against what it created is all unchanged', () => {
    const remote = desiredPayloads(config).map((attributes, i) => ({ id: String(i), attributes: { ...attributes, http_method: 'GET' } }));
    const plan = planSync(config, remote);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toHaveLength(config.monitors.length);
  });

  it('reports drift as an update with before/after', () => {
    const remote = desiredPayloads(config).map((attributes, i) => ({ id: String(i), attributes: { ...attributes } }));
    remote[0].attributes.request_timeout = 30;
    const plan = planSync(config, remote);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].changes.request_timeout).toEqual({ from: 30, to: 10 });
  });

  it('never plans a delete: unknown prefixed monitors are orphans, foreign ones are ignored', () => {
    const remote = [
      { id: 'x', attributes: { pronounceable_name: '[mindy] Old check', url: 'https://getmindy.ai/old' } },
      { id: 'y', attributes: { pronounceable_name: 'Someone else\'s monitor', url: 'https://example.com' } },
    ];
    const plan = planSync(config, remote);
    expect(plan.orphans).toEqual([{ id: 'x', name: '[mindy] Old check' }]);
    expect(Object.keys(plan)).not.toContain('delete');
  });
});

describe('validateConfig', () => {
  it('rejects a config over the free tier, bad timeouts, and keyword monitors without a keyword', () => {
    const bad: MonitorConfig = {
      ...config,
      profiles: { ...config.profiles, latency: { request_timeout: 4, confirmation_period: 900 } },
      monitors: [
        ...config.monitors,
        { key: 'extra', name: 'Extra', path: '/x', profile: 'availability', monitor_type: 'keyword' },
      ],
    };
    const errors = validateConfig(bad);
    expect(errors.join('\n')).toMatch(/exceeds the 10-monitor free tier/);
    expect(errors.join('\n')).toMatch(/request_timeout 4s/);
    expect(errors.join('\n')).toMatch(/needs required_keyword/);
  });
});
