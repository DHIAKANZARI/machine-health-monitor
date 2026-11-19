// Simulated plant: automation machines and IT servers with injected faults.

export const METRICS = {
  temperature: { label: 'Temperature', unit: '°C', max: 85 },
  vibration: { label: 'Vibration', unit: 'mm/s', max: 11 },
  load: { label: 'Spindle load', unit: '%', max: 98 },
  cycleTime: { label: 'Cycle time', unit: 's' },
  cpu: { label: 'CPU', unit: '%', max: 95 },
  memory: { label: 'Memory', unit: '%', max: 92 },
  disk: { label: 'Disk usage', unit: '%', max: 90, forecast: true },
};

export const MACHINES = [
  { id: 'cnc-01', name: 'CNC milling #1', type: 'machine', metrics: ['temperature', 'vibration', 'load', 'cycleTime'] },
  { id: 'cnc-02', name: 'CNC milling #2', type: 'machine', metrics: ['temperature', 'vibration', 'load', 'cycleTime'] },
  { id: 'rob-01', name: 'Assembly robot', type: 'machine', metrics: ['temperature', 'vibration', 'cycleTime'] },
  { id: 'conv-01', name: 'Conveyor line', type: 'machine', metrics: ['vibration', 'load'] },
  { id: 'srv-scada', name: 'SCADA server', type: 'server', metrics: ['cpu', 'memory', 'disk'] },
  { id: 'srv-erp', name: 'ERP server', type: 'server', metrics: ['cpu', 'memory', 'disk'] },
];

const BASE = { temperature: 55, vibration: 3.5, load: 60, cycleTime: 42, cpu: 30, memory: 55, disk: 62 };
const NOISE = { temperature: 0.8, vibration: 0.25, load: 4, cycleTime: 0.6, cpu: 6, memory: 1.5, disk: 0.05 };

function gauss(rng) { // Box–Muller
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Plant {
  constructor({ seed = 42 } = {}) {
    let s = seed; this.rng = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    this.tick = 0; this.faults = new Map(); // id -> { kind, start }
    this.disk = Object.fromEntries(MACHINES.filter((m) => m.type === 'server').map((m) => [m.id, BASE.disk]));
  }

  injectFault(machineId, kind) { this.faults.set(machineId, { kind, start: this.tick }); }
  clearFault(machineId) { this.faults.delete(machineId); }

  /** Advance one second; returns [{ id, metrics }]. */
  step() {
    this.tick += 1;
    // Occasionally start a realistic fault somewhere.
    if (this.tick % 90 === 0) {
      const m = MACHINES[Math.floor(this.rng() * MACHINES.length)];
      if (!this.faults.has(m.id)) this.injectFault(m.id, m.type === 'server' ? (this.rng() < .5 ? 'diskLeak' : 'cpuSpike') : (this.rng() < .5 ? 'bearingWear' : 'overheat'));
    }
    return MACHINES.map((m) => {
      const f = this.faults.get(m.id); const age = f ? this.tick - f.start : 0;
      const metrics = {};
      for (const k of m.metrics) {
        let v = BASE[k] + NOISE[k] * gauss(this.rng);
        if (k === 'disk') { this.disk[m.id] += 0.002 + (f?.kind === 'diskLeak' ? 0.12 : 0); v = this.disk[m.id]; }
        if (f?.kind === 'bearingWear' && k === 'vibration') v += age * 0.06;
        if (f?.kind === 'bearingWear' && k === 'temperature') v += age * 0.08;
        if (f?.kind === 'overheat' && k === 'temperature') v += Math.min(age * 0.5, 40);
        if (f?.kind === 'overheat' && k === 'cycleTime') v += Math.min(age * 0.05, 6);
        if (f?.kind === 'cpuSpike' && k === 'cpu') v = 97 + this.rng() * 3;
        metrics[k] = Math.max(0, Math.round(v * 100) / 100);
      }
      // Faults resolve after a while (maintenance done) so the demo keeps moving.
      if (f && age > 150) { this.clearFault(m.id); if (m.type === 'server') this.disk[m.id] = BASE.disk; }
      return { id: m.id, metrics };
    });
  }
}
