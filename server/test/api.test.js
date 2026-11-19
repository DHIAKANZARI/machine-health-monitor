import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

test('REST API', async () => {
  const app = createApp({ intervalMs: 0 });
  for (let i = 0; i < 5; i++) app.locals.tick();
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const machines = await (await fetch(`${base}/api/machines`)).json();
    assert.equal(machines.length, 6); assert.ok(machines[0].latest);
    const hist = await (await fetch(`${base}/api/machines/cnc-01/history`)).json();
    assert.equal(hist.length, 5);
    assert.equal((await fetch(`${base}/api/machines/nope/fault`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${base}/api/alerts/999/ack`, { method: 'POST' })).status, 404);
  } finally { server.close(); app.locals.stop(); }
});
