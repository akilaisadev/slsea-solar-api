// Deterministic synthetic generation model, shared by the seed and the
// device simulator. Every value is a pure function of (installation, time),
// so the seed and the simulator always agree on what a device "measured" in
// any 15-minute slot: re-sending a slot is a true duplicate (409).

export const SLOT_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const COLOMBO_OFFSET_MS = 5.5 * HOUR_MS; // Sri Lanka is UTC+05:30, no DST

// Cumulative energy counters are integrated from this instant onward.
export const MODEL_EPOCH = Date.UTC(2026, 8, 1); // 2026-09-01T00:00:00Z

// Stable pseudo-random number in [0, 1) from any key parts (FNV-1a hash
// followed by a murmur3-style finaliser to spread the bits).
export function hashToUnit(...parts) {
  const key = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function floorToSlot(ms) {
  return Math.floor(ms / SLOT_MS) * SLOT_MS;
}

function colomboHour(ms) {
  return ((ms + COLOMBO_OFFSET_MS) % DAY_MS) / HOUR_MS;
}

function colomboDay(ms) {
  return Math.floor((ms + COLOMBO_OFFSET_MS) / DAY_MS);
}

// Diurnal bell curve: zero overnight, peaking around local solar noon,
// scaled by a per-district daily cloudiness and an hourly passing-cloud
// factor (so neighbouring sites move together), plus small per-site noise.
export function powerAt(inst, ms) {
  const hour = colomboHour(ms);
  const sun = Math.sin((Math.PI * (hour - 6.1)) / 12.1);
  if (sun <= 0) return 0;
  const day = colomboDay(ms);
  const dayClearness = 0.45 + 0.55 * hashToUnit(inst.district_id, 'day', day);
  const hourClearness = 0.75 + 0.25 * hashToUnit(inst.district_id, 'hour', day, Math.floor(hour));
  const noise = 0.97 + 0.06 * hashToUnit(inst.installation_id, 'power', ms);
  return inst.capacity_kw * 0.82 * sun ** 1.2 * dayClearness * hourClearness * noise;
}

// Grid voltage near 230 V: a fixed offset per substation feeder, a small
// rise while the site is exporting, and measurement noise.
export function voltageAt(inst, ms, power) {
  const feederOffset = (hashToUnit(inst.substation_id, 'feeder') - 0.5) * 6;
  const exportRise = (4 * power) / inst.capacity_kw;
  const noise = (hashToUnit(inst.installation_id, 'voltage', ms) - 0.5) * 3;
  return 229 + feederOffset + exportRise + noise;
}

// Lifetime energy already on the meter at MODEL_EPOCH (~1,350 kWh per kWp
// per year in Sri Lanka, varying by site).
function energyAtEpoch(inst) {
  const years = (MODEL_EPOCH - Date.parse(inst.commissioned_on)) / (365.25 * DAY_MS);
  const siteYield = 0.9 + 0.2 * hashToUnit(inst.installation_id, 'yield');
  return Math.max(0, years) * inst.capacity_kw * 1350 * siteYield;
}

// Readings for every slot in [fromMs, toMs]. Energy is integrated from
// MODEL_EPOCH in the same order every time, so the cumulative counter for a
// given slot is identical whether the seed or the simulator computes it.
export function* readingsBetween(inst, fromMs, toMs) {
  if (fromMs < MODEL_EPOCH) throw new Error('fromMs must not be before MODEL_EPOCH');
  let energy = energyAtEpoch(inst);
  for (let t = MODEL_EPOCH; t <= toMs; t += SLOT_MS) {
    const power = powerAt(inst, t);
    energy += power * 0.25; // kWh produced in the 15 minutes ending at t
    if (t >= fromMs) {
      yield {
        recorded_at: t,
        power_kw: round(power, 3),
        energy_kwh: round(energy, 3),
        voltage_v: round(voltageAt(inst, t, power), 1),
      };
    }
  }
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
