import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Monitor } from './detector.js';
import { MACHINES, METRICS, Plant } from './simulator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ plant = new Plant(), monitor = new Monitor(METRICS), intervalMs = 1000 } = {}) {
  const app = express();
  app.use(express.json());
  const latest = new Map(); const history = new Map(); const clients = new Set();

  const tick = () => {
    const now = Date.now();
    for (const { id, metrics } of plant.step()) {
      latest.set(id, { ...metrics, at: now });
      const h = history.get(id) || []; h.push({ at: now, ...metrics }); if (h.length > 120) h.shift(); history.set(id, h);
      const raised = monitor.ingest(id, metrics, now);
      for (const a of raised) broadcast('alert', a);
    }
    broadcast('metrics', Object.fromEntries(latest));
  };
  const broadcast = (event, data) => { for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const timer = intervalMs ? setInterval(tick, intervalMs) : null;

  const statusOf = (id) => {
    const open = monitor.alerts.filter((a) => a.machine === id && !a.acknowledged && Date.now() - a.at < 5 * 60_000);
    return open.some((a) => a.severity === 'critical') ? 'critical' : open.length ? 'warning' : 'ok';
  };

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/metrics-spec', (req, res) => res.json(METRICS));
  app.get('/api/machines', (req, res) => res.json(MACHINES.map((m) => ({ ...m, status: statusOf(m.id), latest: latest.get(m.id) || null }))));
  app.get('/api/machines/:id/history', (req, res) => res.json(history.get(req.params.id) || []));
  app.get('/api/alerts', (req, res) => res.json(monitor.alerts.slice(0, Number(req.query.limit) || 50)));
  app.post('/api/alerts/:id/ack', (req, res) => {
    const a = monitor.acknowledge(Number(req.params.id));
    return a ? res.json(a) : res.status(404).json({ error: 'Alert not found' });
  });
  app.post('/api/machines/:id/fault', (req, res) => { // demo helper
    if (!MACHINES.some((m) => m.id === req.params.id)) return res.status(404).json({ error: 'Unknown machine' });
    plant.injectFault(req.params.id, req.body?.kind || 'overheat');
    return res.json({ ok: true });
  });
  app.get('/api/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders(); clients.add(res); req.on('close', () => clients.delete(res));
  });

  const dist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html'))); }

  app.locals.tick = tick; app.locals.stop = () => timer && clearInterval(timer);
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 4100;
  createApp().listen(port, () => console.log(`Machine Health Monitor on http://localhost:${port}`));
}
