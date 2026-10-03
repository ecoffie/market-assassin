/**
 * Unit tests must not reach the network.
 *
 * The pre-push gate runs the unit suite on every push. A unit test that talks to a real
 * host makes the gate depend on that host's availability, latency and quota — the same
 * branch can pass or fail with nothing in it changed. Measured 2026-09-28: the only
 * outbound traffic in the unit run came from `lookup-solicitation.live.test.ts` (live
 * Supabase), which now runs under `npm run test:live` instead.
 *
 * This guard makes the rule enforceable rather than remembered: any non-loopback TCP/TLS
 * connection attempted inside a unit-test worker throws immediately and names the host.
 * Loopback (localhost / 127.x / ::1) and Unix sockets stay allowed. Child processes
 * (git, tsx CLIs spawned by e2e tests) are separate processes and are not affected.
 *
 * To test code that fetches: inject a fetch stub (see noticedesc-429-failover.unit.test.ts)
 * or move the test to a `*.live.test.ts` file, which runs under vitest.live.config.ts.
 */
import net from 'node:net';

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|0\.0\.0\.0)$/i;

function targetOf(args: unknown[]): { host?: string; path?: string } {
  const [first, second] = args as [unknown, unknown];
  if (first && typeof first === 'object') {
    const o = first as { host?: string; hostname?: string; path?: string };
    return { host: o.host ?? o.hostname, path: o.path };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return { path: first }; // unix socket path
  return { host: typeof second === 'string' ? second : undefined };
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
  const { host, path } = targetOf(args);
  if (!path && host && !LOOPBACK.test(host)) {
    throw new Error(
      `[no-network] unit test attempted a real network connection to ${host}. ` +
        'Stub the dependency, or move the test to a *.live.test.ts file (npm run test:live).',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (originalConnect as any).apply(this, args);
} as typeof net.Socket.prototype.connect;
