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
