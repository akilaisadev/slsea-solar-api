// Static reference data for the seed: Sri Lanka's 9 provinces and 25
// districts (real mapping), grid substations named after towns in each
// district, and a deterministic list of rooftop installations.
import { hashToUnit } from './solar-model.js';

export const PROVINCES = [
  { province_id: 'pv-01', name: 'Western' },
  { province_id: 'pv-02', name: 'Central' },
  { province_id: 'pv-03', name: 'Southern' },
  { province_id: 'pv-04', name: 'Northern' },
  { province_id: 'pv-05', name: 'Eastern' },
  { province_id: 'pv-06', name: 'North Western' },
  { province_id: 'pv-07', name: 'North Central' },
  { province_id: 'pv-08', name: 'Uva' },
  { province_id: 'pv-09', name: 'Sabaragamuwa' },
];

// centre = approximate district centroid, used to place installations.
// weight = relative share of rooftop installations (urban districts higher).
export const DISTRICTS = [
  { district_id: 'ds-01', name: 'Colombo', province_id: 'pv-01', centre: [6.93, 79.86], weight: 6, substations: ['Kolonnawa', 'Kelanitissa', 'Dehiwala'] },
  { district_id: 'ds-02', name: 'Gampaha', province_id: 'pv-01', centre: [7.09, 80.00], weight: 5, substations: ['Biyagama', 'Kotugoda'] },
  { district_id: 'ds-03', name: 'Kalutara', province_id: 'pv-01', centre: [6.60, 80.10], weight: 3, substations: ['Horana'] },
  { district_id: 'ds-04', name: 'Kandy', province_id: 'pv-02', centre: [7.29, 80.63], weight: 4, substations: ['Kiribathkumbura', 'Pallekele'] },
  { district_id: 'ds-05', name: 'Matale', province_id: 'pv-02', centre: [7.47, 80.62], weight: 1, substations: ['Matale'] },
  { district_id: 'ds-06', name: 'Nuwara Eliya', province_id: 'pv-02', centre: [6.97, 80.78], weight: 1, substations: ['Nuwara Eliya'] },
  { district_id: 'ds-07', name: 'Galle', province_id: 'pv-03', centre: [6.05, 80.22], weight: 3, substations: ['Galle'] },
  { district_id: 'ds-08', name: 'Matara', province_id: 'pv-03', centre: [5.95, 80.55], weight: 2, substations: ['Matara'] },
  { district_id: 'ds-09', name: 'Hambantota', province_id: 'pv-03', centre: [6.12, 81.12], weight: 2, substations: ['Hambantota'] },
  { district_id: 'ds-10', name: 'Jaffna', province_id: 'pv-04', centre: [9.66, 80.02], weight: 2, substations: ['Chunnakam'] },
  { district_id: 'ds-11', name: 'Kilinochchi', province_id: 'pv-04', centre: [9.39, 80.40], weight: 1, substations: ['Kilinochchi'] },
  { district_id: 'ds-12', name: 'Mannar', province_id: 'pv-04', centre: [8.98, 79.90], weight: 1, substations: ['Mannar'] },
  { district_id: 'ds-13', name: 'Vavuniya', province_id: 'pv-04', centre: [8.75, 80.50], weight: 1, substations: ['Vavuniya'] },
  { district_id: 'ds-14', name: 'Mullaitivu', province_id: 'pv-04', centre: [9.27, 80.81], weight: 1, substations: ['Mullaitivu'] },
  { district_id: 'ds-15', name: 'Batticaloa', province_id: 'pv-05', centre: [7.73, 81.69], weight: 1, substations: ['Valachchenai'] },
  { district_id: 'ds-16', name: 'Ampara', province_id: 'pv-05', centre: [7.30, 81.67], weight: 1, substations: ['Ampara'] },
  { district_id: 'ds-17', name: 'Trincomalee', province_id: 'pv-05', centre: [8.59, 81.21], weight: 1, substations: ['Trincomalee'] },
  { district_id: 'ds-18', name: 'Kurunegala', province_id: 'pv-06', centre: [7.49, 80.36], weight: 3, substations: ['Kurunegala', 'Pannala'] },
  { district_id: 'ds-19', name: 'Puttalam', province_id: 'pv-06', centre: [8.04, 79.83], weight: 2, substations: ['Puttalam'] },
  { district_id: 'ds-20', name: 'Anuradhapura', province_id: 'pv-07', centre: [8.31, 80.40], weight: 2, substations: ['Anuradhapura', 'Habarana'] },
  { district_id: 'ds-21', name: 'Polonnaruwa', province_id: 'pv-07', centre: [7.94, 81.00], weight: 1, substations: ['Polonnaruwa'] },
  { district_id: 'ds-22', name: 'Badulla', province_id: 'pv-08', centre: [6.99, 81.06], weight: 1, substations: ['Badulla'] },
  { district_id: 'ds-23', name: 'Monaragala', province_id: 'pv-08', centre: [6.87, 81.35], weight: 1, substations: ['Monaragala'] },
  { district_id: 'ds-24', name: 'Ratnapura', province_id: 'pv-09', centre: [6.68, 80.40], weight: 2, substations: ['Ratnapura', 'Balangoda'] },
  { district_id: 'ds-25', name: 'Kegalle', province_id: 'pv-09', centre: [7.25, 80.35], weight: 2, substations: ['Kegalle'] },
];

export const SUBSTATIONS = DISTRICTS.flatMap((d) => d.substations.map((town) => ({ town, district: d })))
  .map(({ town, district }, i) => ({
    substation_id: `gss-${String(i + 1).padStart(3, '0')}`,
    name: `${town} Grid Substation`,
    district_id: district.district_id,
    district,
  }));

export const INSTALLATION_COUNT = 240;
const MIN_PER_SUBSTATION = 3;
// Typical rooftop sizes in kW: mostly residential, a few small commercial.
const CAPACITIES = [2, 3, 3, 4, 5, 5, 5, 6, 8, 10, 10, 12, 15, 20, 30, 40];

// Every substation gets at least MIN_PER_SUBSTATION sites; the rest are
// spread by district weight. Output is sorted by substation so IDs group
// geographically (ins-0001.. are in Colombo).
export function buildInstallations({ today, includeEmptyHistory = false }) {
  const counts = SUBSTATIONS.map(() => MIN_PER_SUBSTATION);
  // A district's weight is shared equally between its substations.
  const weights = SUBSTATIONS.map((s) => s.district.weight / s.district.substations.length);
  const extra = INSTALLATION_COUNT - counts.reduce((a, b) => a + b, 0);
  for (let n = 0; n < extra; n++) {
    counts[pickWeighted(weights, hashToUnit('substation-pick', n))] += 1;
  }

  const installations = [];
  SUBSTATIONS.forEach((substation, s) => {
    for (let k = 0; k < counts[s]; k++) {
      const n = installations.length + 1;
      const id = `ins-${String(n).padStart(4, '0')}`;
      const [lat, lng] = substation.district.centre;
      const commissionedDays = Math.floor(hashToUnit(id, 'commissioned') * 3800); // up to ~10 years
      installations.push({
        installation_id: id,
        inverter_id: `INV-${Math.floor(hashToUnit(id, 'inverter') * 0xffffffff).toString(16).toUpperCase().padStart(8, '0')}`,
        substation_id: substation.substation_id,
        district_id: substation.district_id,
        capacity_kw: CAPACITIES[Math.floor(hashToUnit(id, 'capacity') * CAPACITIES.length)],
        latitude: round(lat + (hashToUnit(id, 'lat') - 0.5) * 0.16, 5),
        longitude: round(lng + (hashToUnit(id, 'lng') - 0.5) * 0.16, 5),
        commissioned_on: isoDate(new Date(Date.UTC(2026, 5, 30) - commissionedDays * 86_400_000)),
        status: 'active',
        reporting: 'normal',
      });
    }
  });

  // Maintenance sites retain a full week of historical readings. The
  // coursework dataset must give every installation at least a week;
  // a newly registered site with empty history belongs only in test data.
  for (const n of [17, 101, 187]) {
    installations[n - 1].status = 'maintenance';
    installations[n - 1].reporting = 'stopped-2-days-ago';
  }
  if (includeEmptyHistory) {
    const newest = installations[installations.length - 1];
    newest.commissioned_on = today;
    newest.reporting = 'none';
  }
  return installations;
}

// Demo SLSEA users, one per jurisdiction level, plus an asset administrator.
export const USERS = [
  { user_id: 'usr-01', username: 'national.analyst', display_name: 'National Analyst', role: 'analyst', jurisdiction_level: 'national', province_id: null, district_id: null },
  { user_id: 'usr-02', username: 'western.analyst', display_name: 'Western Province Analyst', role: 'analyst', jurisdiction_level: 'province', province_id: 'pv-01', district_id: null },
  { user_id: 'usr-03', username: 'colombo.analyst', display_name: 'Colombo District Analyst', role: 'analyst', jurisdiction_level: 'district', province_id: null, district_id: 'ds-01' },
  { user_id: 'usr-04', username: 'kandy.analyst', display_name: 'Kandy District Analyst', role: 'analyst', jurisdiction_level: 'district', province_id: null, district_id: 'ds-04' },
  { user_id: 'usr-05', username: 'asset.admin', display_name: 'SLSEA Asset Administrator', role: 'asset_admin', jurisdiction_level: 'national', province_id: null, district_id: null },
];

// Maps a uniform value u in [0, 1) to an index, with probability
// proportional to each weight.
function pickWeighted(weights, u) {
  let target = u * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i];
    if (target < 0) return i;
  }
  return weights.length - 1;
}

function round(value, places) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
