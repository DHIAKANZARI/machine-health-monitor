// Streaming anomaly detection: EWMA baseline + z-score, hard limits, and trend forecasting.

export class EwmaDetector {
  constructor({ alpha = 0.05, z = 4, warmup = 30 } = {}) {
    this.alpha = alpha; this.zLimit = z; this.warmup = warmup;
    this.mean = null; this.var = 0; this.n = 0;
  }

  /** Returns the z-score of x against the learned baseline (0 during warm-up). */
  update(x) {
    this.n += 1;
    if (this.mean === null) { this.mean = x; return 0; }
    const diff = x - this.mean;
    const std = Math.sqrt(this.var) || 1e-9;
    const z = this.n > this.warmup ? diff / std : 0;
    // Do not let a clear anomaly pollute the baseline.
    if (Math.abs(z) < this.zLimit) {
      this.mean += this.alpha * diff;
      this.var = (1 - this.alpha) * (this.var + this.alpha * diff * diff);
    }
    return z;
  }
}

/** Least-squares slope over (t, y) points; returns { slope, intercept }. */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };
  let st = 0, sy = 0, stt = 0, sty = 0;
  for (const { t, y } of points) { st += t; sy += y; stt += t * t; sty += t * y; }
  const den = n * stt - st * st;
  const slope = den === 0 ? 0 : (n * sty - st * sy) / den;
  return { slope, intercept: (sy - slope * st) / n };
}

/** Seconds until the trend reaches `limit` (null if not heading there). */
export function timeToLimit(points, limit) {
  const { slope } = linearFit(points);
  const last = points[points.length - 1];
  if (!last || slope <= 0 || last.y >= limit) return last && last.y >= limit ? 0 : null;
  return (limit - last.y) / slope;
}

/**
 * Watches every metric of every machine and raises de-duplicated alerts.
 * metricSpec: { [metric]: { max?: number, label: string, unit: string, forecast?: boolean } }
 */
export class Monitor {
  constructor(metricSpec, { cooldownMs = 60_000, history = 120 } = {}) {
    this.spec = metricSpec; this.cooldownMs = cooldownMs; this.historyLen = history;
    this.state = new Map(); // key machine:metric -> { det, hist, lastAlert }
    this.alerts = []; this.nextId = 1;
  }

  _st(machine, metric) {
    const k = `${machine}:${metric}`;
    if (!this.state.has(k)) this.state.set(k, { det: new EwmaDetector(), hist: [], lastAlert: -Infinity });
    return this.state.get(k);
  }

  ingest(machine, metrics, now = Date.now()) {
    const raised = [];
    for (const [metric, value] of Object.entries(metrics)) {
      const spec = this.spec[metric]; if (!spec) continue;
      const st = this._st(machine, metric);
      st.hist.push({ t: now / 1000, y: value });
      if (st.hist.length > this.historyLen) st.hist.shift();
      const z = st.det.update(value);
      let alert = null;
      if (spec.max !== undefined && value >= spec.max) {
        alert = { severity: 'critical', reason: `${spec.label} at ${value.toFixed(1)} ${spec.unit} (limit ${spec.max})` };
      } else if (Math.abs(z) >= st.det.zLimit) {
        alert = { severity: 'warning', reason: `Unusual ${spec.label.toLowerCase()}: ${value.toFixed(1)} ${spec.unit} (${z.toFixed(1)}σ from normal)` };
      } else if (spec.forecast && spec.max !== undefined && st.hist.length >= 30) {
        const eta = timeToLimit(st.hist.slice(-60), spec.max);
        if (eta !== null && eta < 15 * 60) {
          alert = { severity: 'warning', reason: `${spec.label} trending up: limit reached in ~${Math.max(1, Math.round(eta / 60))} min` };
        }
      }
      if (alert && now - st.lastAlert >= this.cooldownMs) {
        st.lastAlert = now;
        const a = { id: this.nextId++, machine, metric, value, at: now, acknowledged: false, ...alert };
        this.alerts.unshift(a); raised.push(a);
        if (this.alerts.length > 200) this.alerts.pop();
      }
    }
    return raised;
  }

  acknowledge(id) {
    const a = this.alerts.find((x) => x.id === id);
    if (a) a.acknowledged = true;
    return a;
  }
}
