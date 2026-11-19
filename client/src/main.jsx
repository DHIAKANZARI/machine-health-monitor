import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const MAX_POINTS = 90;

function Sparkline({ data, max, color }) {
  if (data.length < 2) return <svg width="100%" height="24" />;
  const lo = Math.min(...data), hi = Math.max(...data, max ?? -Infinity);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => `${(i / (MAX_POINTS - 1)) * 100},${22 - ((v - lo) / span) * 20}`).join(' ');
  const limitY = max !== undefined ? 22 - ((max - lo) / span) * 20 : null;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" width="100%" height="24">
      {limitY !== null && limitY >= 0 && <line x1="0" x2="100" y1={limitY} y2={limitY} stroke="#ef4444" strokeDasharray="2 2" strokeWidth="0.6" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function App() {
  const [machines, setMachines] = useState([]);
  const [spec, setSpec] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(false);
  const series = useRef({}); const [, force] = useState(0);

  useEffect(() => {
    fetch('/api/metrics-spec').then((r) => r.json()).then(setSpec);
    fetch('/api/alerts').then((r) => r.json()).then(setAlerts);
    const loadMachines = () => fetch('/api/machines').then((r) => r.json()).then(setMachines);
    loadMachines(); const t = setInterval(loadMachines, 3000);
    const es = new EventSource('/api/stream');
    es.onopen = () => setConnected(true); es.onerror = () => setConnected(false);
    es.addEventListener('metrics', (e) => {
      const latest = JSON.parse(e.data);
      for (const [id, m] of Object.entries(latest)) {
        const s = (series.current[id] ||= {});
        for (const [k, v] of Object.entries(m)) { if (k === 'at') continue; (s[k] ||= []).push(v); if (s[k].length > MAX_POINTS) s[k].shift(); }
      }
      force((x) => x + 1);
    });
    es.addEventListener('alert', (e) => setAlerts((a) => [JSON.parse(e.data), ...a].slice(0, 100)));
    return () => { es.close(); clearInterval(t); };
  }, []);

  const ack = async (id) => {
    const r = await fetch(`/api/alerts/${id}/ack`, { method: 'POST' });
    if (r.ok) setAlerts((a) => a.map((x) => (x.id === id ? { ...x, acknowledged: true } : x)));
  };
  const fault = (id, type) => fetch(`/api/machines/${id}/fault`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: type === 'server' ? 'diskLeak' : 'bearingWear' }) });

  const counts = useMemo(() => ({
    ok: machines.filter((m) => m.status === 'ok').length,
    warning: machines.filter((m) => m.status === 'warning').length,
    critical: machines.filter((m) => m.status === 'critical').length,
    open: alerts.filter((a) => !a.acknowledged).length,
  }), [machines, alerts]);

  return (
    <>
      <header>
        <h1>Machine Health Monitor</h1>
        <span className="live"><span className="dot" style={{ background: connected ? 'var(--ok)' : 'var(--crit)' }} />{connected ? 'Live' : 'Disconnected'}</span>
      </header>
      <main>
        <section>
          <div className="summary">
            <div className="pill"><b style={{ color: 'var(--ok)' }}>{counts.ok}</b>Healthy</div>
            <div className="pill"><b style={{ color: 'var(--warn)' }}>{counts.warning}</b>Warning</div>
            <div className="pill"><b style={{ color: 'var(--crit)' }}>{counts.critical}</b>Critical</div>
            <div className="pill"><b>{counts.open}</b>Open alerts</div>
          </div>
          <div className="grid">
            {machines.map((m) => (
              <div key={m.id} className={`card ${m.status}`} title="Double-click to simulate a fault" onDoubleClick={() => fault(m.id, m.type)}>
                <h3>{m.name} <span className={`status ${m.status}`}>{m.status}</span></h3>
                <small>{m.id} · {m.type === 'server' ? 'IT server' : 'Production machine'}</small>
                {m.metrics.map((k) => {
                  const data = series.current[m.id]?.[k] || []; const v = data[data.length - 1];
                  const hot = spec[k]?.max !== undefined && v >= spec[k].max * 0.9;
                  return (
                    <div className="metric" key={k}>
                      <span>{spec[k]?.label || k}</span>
                      <Sparkline data={data} max={spec[k]?.max} color={hot ? '#ef4444' : '#38bdf8'} />
                      <span className={`val ${hot ? 'hot' : ''}`}>{v !== undefined ? `${v.toFixed(1)} ${spec[k]?.unit || ''}` : '—'}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
        <aside className="alerts">
          <h2>Alerts</h2>
          {alerts.length === 0 && <small style={{ color: 'var(--muted)' }}>No alerts yet. Faults appear every ~90 s (or double-click a machine).</small>}
          {alerts.map((a) => (
            <div key={a.id} className={`alert ${a.severity} ${a.acknowledged ? 'ack' : ''}`}>
              <div><b>{machines.find((m) => m.id === a.machine)?.name || a.machine}</b> — {a.reason}</div>
              <div className="meta"><span>{new Date(a.at).toLocaleTimeString()} · {a.severity}</span>{!a.acknowledged && <button onClick={() => ack(a.id)}>Acknowledge</button>}</div>
            </div>
          ))}
        </aside>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
