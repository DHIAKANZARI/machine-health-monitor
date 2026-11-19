import test from 'node:test';
import assert from 'node:assert/strict';
import { EwmaDetector, linearFit, Monitor, timeToLimit } from '../src/detector.js';
import { Plant } from '../src/simulator.js';

test('EWMA flags a spike after warm-up but not normal noise', () => {
  const d = new EwmaDetector({ warmup: 20 });
  let maxNormal = 0;
  for (let i = 0; i < 200; i++) maxNormal = Math.max(maxNormal, Math.abs(d.update(50 + Math.sin(i) * 0.5)));
  assert.ok(maxNormal < 4);
  assert.ok(d.update(70) > 4);
});

test('linear fit and time to limit', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ t: i, y: 60 + 2 * i }));
  assert.equal(Math.round(linearFit(pts).slope), 2);
  assert.equal(Math.round(timeToLimit(pts, 90)), 6); // last y = 78 -> 12 more at 2/s
  assert.equal(timeToLimit(pts.map((p) => ({ ...p, y: 80 - p.t })), 90), null);
});

test('monitor raises critical, warning and forecast alerts with cooldown', () => {
  const m = new Monitor({ temp: { label: 'Temperature', unit: '°C', max: 85 }, disk: { label: 'Disk', unit: '%', max: 90, forecast: true } }, { cooldownMs: 10_000 });
  let t = 0;
  for (let i = 0; i < 50; i++) m.ingest('a', { temp: 50 + (i % 3) * 0.2 }, (t += 1000));
  const crit = m.ingest('a', { temp: 90 }, (t += 1000));
  assert.equal(crit[0].severity, 'critical');
  assert.equal(m.ingest('a', { temp: 91 }, (t += 1000)).length, 0, 'cooldown');
  let forecast = [];
  for (let i = 0; i < 60; i++) forecast = forecast.concat(m.ingest('srv', { disk: 70 + i * 0.1 }, (t += 1000)));
  assert.ok(forecast.some((a) => /trending up/.test(a.reason)));
  assert.equal(m.acknowledge(crit[0].id).acknowledged, true);
});

test('simulated bearing wear is detected', () => {
  const plant = new Plant({ seed: 1 }); const mon = new Monitor({ vibration: { label: 'Vibration', unit: 'mm/s', max: 11 } }, { cooldownMs: 0 });
  for (let i = 0; i < 60; i++) for (const { id, metrics } of plant.step()) if (id === 'cnc-01') mon.ingest(id, { vibration: metrics.vibration }, i * 1000);
  plant.injectFault('cnc-01', 'bearingWear');
  let hit = false;
  for (let i = 60; i < 200 && !hit; i++) for (const { id, metrics } of plant.step()) if (id === 'cnc-01' && mon.ingest(id, { vibration: metrics.vibration }, i * 1000).length) hit = true;
  assert.ok(hit);
});
