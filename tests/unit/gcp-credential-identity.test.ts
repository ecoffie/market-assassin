import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs helper without type declarations
import { identifyCredential, matchesKeyPrefix } from '../../scripts/lib/gcp-credential-identity.mjs';

const root = process.cwd();
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const fake = {
  type: 'service_account',
  project_id: 'example-project',
  private_key_id: 'abc123def4567890abc123def4567890abc123de',
  private_key: PEM,
  client_email: 'probe-test@example-project.iam.gserviceaccount.com',
};
const asJson = JSON.stringify(fake);
const asB64 = Buffer.from(asJson).toString('base64');
const MARKER = PEM.split('\n')[1]; // a line of the private key body — must never appear in output

describe('identifyCredential', () => {
  it('reads identifiers from raw JSON and from base64 JSON', () => {
    for (const raw of [asJson, asB64, `  ${asB64}\n`]) {
      expect(identifyCredential(raw)).toEqual({
        ok: true, type: 'service_account', clientEmail: fake.client_email, keyId: fake.private_key_id, projectId: 'example-project',
      });
    }
  });

  it('never returns the private key', () => {
    const r = identifyCredential(asB64);
    expect(JSON.stringify(r)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(r)).not.toContain(MARKER);
  });

  it('a bad value fails without echoing it', () => {
    for (const raw of ['', undefined, null, 'not-a-credential', Buffer.from('{"type":"x"}').toString('base64')]) {
      const r = identifyCredential(raw);
      expect(r.ok).toBe(false);
      if (raw) expect(r.reason).not.toContain(String(raw));
    }
    expect(identifyCredential(JSON.stringify({ ...fake, private_key_id: '' })).ok).toBe(false);
    expect(identifyCredential(JSON.stringify({ ...fake, type: 'authorized_user' })).ok).toBe(false);
  });
});

describe('matchesKeyPrefix', () => {
  it('compares a hex prefix, case-insensitively; empty = no comparison', () => {
    expect(matchesKeyPrefix('814e6f1ca452', '814e6f')).toBe(true);
    expect(matchesKeyPrefix('814e6f1ca452', '814E6F')).toBe(true);
    expect(matchesKeyPrefix('06ddec000000', '814e6f')).toBe(false);
    expect(matchesKeyPrefix('814e6f1ca452', '')).toBeNull();
    expect(() => matchesKeyPrefix('814e6f', 'zz;rm')).toThrow(/hex/);
  });
});

describe('the probe script (subprocess)', () => {
  const run = (env: Record<string, string>, args: string[] = []) => new Promise<{ code: number | null; out: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts/gcp-credential-identity.mjs'), ...args], {
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });

  it('prints only identifiers and the prefix verdict', async () => {
    const r = await run({ GCP_SA_JSON: asB64 }, ['--scope', 'repository', '--expect-prefix', 'abc123']);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`client_email=${fake.client_email}`);
    expect(r.out).toContain(`private_key_id=${fake.private_key_id}`);
    expect(r.out).toContain('matches_expected_prefix=yes');
    expect(r.out).not.toContain('PRIVATE KEY');
    expect(r.out).not.toContain(MARKER);
    expect(r.out).not.toContain(asB64.slice(0, 40));
  });

  it('fails closed on a missing or bad secret without printing it', async () => {
    expect((await run({})).code).toBe(1);
    const bad = await run({ GCP_SA_JSON: 'c2VjcmV0LXZhbHVlLXNob3VsZC1uZXZlci1wcmludA==' });
    expect(bad.code).toBe(1);
    expect(bad.out).not.toContain('c2VjcmV0');
    expect(bad.out).not.toContain('secret-value');
  });
});

describe('the workflow', () => {
  const wf = readFileSync(join(root, '.github/workflows/gcp-credential-identity.yml'), 'utf8');
  it('is dispatch-only with read-only permissions', () => {
    expect(wf).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(wf).not.toMatch(/^\s{2}(schedule|push|pull_request|pull_request_target|workflow_run):/m);
    expect(wf).toMatch(/^permissions:\n {2}contents: read$/m);
  });
  it('never authenticates to GCP and never echoes the secret', () => {
    expect(wf).not.toContain('google-github-actions/auth');
    expect(wf).not.toMatch(/echo .*GCP_SA_JSON/);
    expect(wf).not.toMatch(/\$\{\{\s*secrets\.GCP_SA_JSON\s*\}\}[^\n]*\n[^\n]*(echo|cat|printf)/);
  });
  it('the bq-production scope runs in the protected environment', () => {
    const job = wf.slice(wf.indexOf('bq_production:'));
    expect(job).toMatch(/environment: bq-production/);
  });
});
