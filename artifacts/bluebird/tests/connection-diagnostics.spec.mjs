import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runConnectionDiagnostics } from '../scripts/.connection-diagnostics.test.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const reference = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const token = 'test-token-not-a-session';

test('read-only checks report shape and counts without identities', async () => {
  const calls = [];
  const results = await runConnectionDiagnostics({
    environment: 'production',
    baseUrl: 'https://bluebirdjets.com/api',
    getAccessToken: async () => token,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/me/connections/queue-status')) {
        return json(200, {
          relationships: [{
            connectionId: 73,
            emptyLegId: 22655,
            status: 'pending',
            direction: 'outgoing',
            updatedAt: '2026-11-05T12:00:00.000Z',
            userId: 'user_secret',
            email: 'member@example.com',
          }],
        });
      }
      if (path.endsWith('/me/connections/requests/incoming')) {
        return json(200, { requests: [{ name: 'Avery Lang' }, { phone: '+15555550100' }] });
      }
      if (path.endsWith('/me/connections/blocks')) {
        return json(401, { code: 'unauthorized', message: 'member@example.com', token });
      }
      if (path.endsWith('/me/connections')) {
        return json(200, { connections: [{ member: { name: 'Avery Lang', email: 'member@example.com' } }] });
      }
      if (path.endsWith('/empty-legs/22655/queue')) {
        return json(200, [{
          position: 1,
          initials: 'AL',
          connectionTargetReference: reference,
          name: 'Avery Lang',
        }]);
      }
      return json(404, { code: 'not_found' });
    },
  });

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'GET', 'GET', 'GET', 'GET']);
  assert.equal(calls.every((call) => call.body === undefined), true);
  assert.equal(results.find((item) => item.id === 'queue-status')?.valid, true);
  assert.equal(results.find((item) => item.id === 'queue-status')?.count, 1);
  assert.equal(results.find((item) => item.id === 'queue-status')?.status, 200);
  assert.equal(results.find((item) => item.id === 'accepted')?.count, 1);
  assert.equal(results.find((item) => item.id === 'incoming')?.count, 2);
  assert.equal(results.find((item) => item.id === 'blocks')?.status, 401);
  assert.equal(results.find((item) => item.id === 'blocks')?.errorCode, 'unauthorized');
  assert.equal(results.find((item) => item.id === 'blocks')?.valid, false);
  assert.equal(results.find((item) => item.id === 'queue')?.hasConnectionTargetReference, true);
  assert.equal(results.find((item) => item.id === 'queue')?.count, 1);
  const rendered = JSON.stringify(results);
  assert.equal(rendered.includes(reference), false);
  assert.equal(rendered.includes(token), false);
  assert.equal(rendered.includes('user_secret'), false);
  assert.equal(rendered.includes('member@example.com'), false);
  assert.equal(rendered.includes('Avery'), false);
  assert.equal(rendered.includes('+15555550100'), false);
  assert.equal(rendered.includes('AL'), false);
});

test('a missing relationships array is an invalid queue-status shape', async () => {
  const results = await runConnectionDiagnostics({
    environment: 'production',
    baseUrl: 'https://bluebirdjets.com/api',
    getAccessToken: async () => token,
    fetcher: async () => json(200, { relationships: { connectionId: 1 } }),
  });
  assert.equal(results[0]?.id, 'queue-status');
  assert.equal(results[0]?.valid, false);
  assert.equal(results[0]?.count, null);
});

test('the diagnostics screen stays manual and development-only', () => {
  const screen = readFileSync(resolve(projectRoot, 'app/dev/connection-diagnostics.tsx'), 'utf8');
  const entry = readFileSync(resolve(projectRoot, 'components/MemberConnectionsScreen.tsx'), 'utf8');
  const runner = readFileSync(resolve(projectRoot, 'lib/connectionDiagnostics.ts'), 'utf8');
  assert.match(screen, /if \(!__DEV__\)/);
  assert.match(screen, /Run Read-Only Checks/);
  assert.doesNotMatch(screen, /useEffect|console\.(log|debug|info|warn|error)/);
  assert.doesNotMatch(entry, /\/dev\/connection-diagnostics|dev-connection-diagnostics-open/);
  assert.match(runner, /method: 'GET'/);
  assert.doesNotMatch(runner, /method: 'POST'|method: 'PUT'|method: 'PATCH'|method: 'DELETE'/);
  assert.doesNotMatch(screen, /console\./);
  assert.doesNotMatch(runner, /console\./);
});

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
