// Every JSON shape the API returns is defined here, in one place, so field
// names stay consistent across routes (WSO2 §6): snake_case, units in the
// name, foreign keys present so clients can walk up the hierarchy, and
// internal columns (secret hashes, audit timestamps) never leak out.

export const toProvince = (row) => ({
  province_id: row.province_id,
  name: row.name,
});

export const toDistrict = (row) => ({
  district_id: row.district_id,
  name: row.name,
  province_id: row.province_id,
});

export const toGridSubstation = (row) => ({
  substation_id: row.substation_id,
  name: row.name,
  district_id: row.district_id,
});

export const toInstallation = (row) => ({
  installation_id: row.installation_id,
  inverter_id: row.inverter_id,
  substation_id: row.substation_id,
  capacity_kw: row.capacity_kw,
  latitude: row.latitude,
  longitude: row.longitude,
  commissioned_on: row.commissioned_on,
  status: row.status,
});

// What DELETE returns: the installation as it was when it left service.
export const toDecommissionedInstallation = (row) => ({
  ...toInstallation(row),
  decommissioned_at: row.decommissioned_at,
});

export const toReading = (row) => ({
  reading_id: row.reading_id,
  installation_id: row.installation_id,
  recorded_at: row.recorded_at,
  power_kw: row.power_kw,
  energy_kwh: row.energy_kwh,
  voltage_v: row.voltage_v,
  received_at: row.received_at,
});

const round3 = (value) => Math.round(value * 1000) / 1000;

// Processing resource (WSO2 §4.5): aggregate generation for one district.
// "current_*" always describes now; "total_energy_kwh" describes `date`.
export const toGenerationSummary = (district, date, timezone, reportingWindowMinutes, s) => ({
  district_id: district.district_id,
  district_name: district.name,
  installation_count: s.installation_count,
  installed_capacity_kw: round3(s.installed_capacity_kw),
  reporting_installation_count: s.reporting_installation_count,
  reporting_window_minutes: reportingWindowMinutes,
  current_total_power_kw: round3(s.current_total_power_kw),
  as_of: s.as_of,
  date,
  timezone,
  total_energy_kwh: round3(s.total_energy_kwh),
});

// Composite resource (WSO2 §4.3): the installation plus what an operator
// always needs alongside it: where it sits in the grid hierarchy and its
// most recent reading. One reading only; the history lives in the readings
// sub-collection, never embedded here.
export const toInstallationComposite = (row, lastReading) => ({
  ...toInstallation(row),
  location: {
    grid_substation: { substation_id: row.substation_id, name: row.substation_name },
    district: { district_id: row.district_id, name: row.district_name },
    province: { province_id: row.province_id, name: row.province_name },
  },
  last_reading: lastReading ? toReading(lastReading) : null,
});
