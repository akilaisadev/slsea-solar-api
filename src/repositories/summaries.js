// District generation summary: a processing-style resource computed across
// every registered (not decommissioned) installation in a district.
//
// Current power: the sum of each site's latest power_kw, counting only sites
// whose latest reading is recent enough to be "now" (REPORTING_WINDOW).
//
// Daily energy: energy_kwh is a cumulative meter counter, so a site's
// energy for a Colombo calendar day is
//   (last counter value during the day) - (last value before the day began)
// falling back to the day's first value for a site with no earlier reading.
// Using counter differences rather than summing power x 15 minutes keeps
// the total correct even when some readings are missing.

export const REPORTING_WINDOW_MINUTES = 60;

export async function districtGenerationSummary(db, districtId, date) {
  const { rows } = await db.query(
    `WITH day AS (
       SELECT ($2::date)::timestamp AT TIME ZONE 'Asia/Colombo'       AS starts,
              ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Colombo'   AS ends
     ),
     sites AS (
       SELECT i.installation_id, i.capacity_kw
       FROM solar_installation i JOIN grid_substation s ON s.substation_id = i.substation_id
       WHERE s.district_id = $1 AND i.status <> 'decommissioned'
     ),
     per_site AS (
       SELECT st.installation_id, st.capacity_kw, latest.recorded_at, latest.power_kw, latest.received_at,
              day_end.energy_kwh                                    AS day_last_kwh,
              COALESCE(before_day.energy_kwh, day_first.energy_kwh) AS day_start_kwh
       FROM sites st CROSS JOIN day
       LEFT JOIN LATERAL (SELECT r.recorded_at, r.power_kw, r.received_at FROM generation_reading r
                          WHERE r.installation_id = st.installation_id
                          ORDER BY r.recorded_at DESC LIMIT 1) latest ON TRUE
       LEFT JOIN LATERAL (SELECT r.energy_kwh FROM generation_reading r
                          WHERE r.installation_id = st.installation_id
                            AND r.recorded_at >= day.starts AND r.recorded_at < day.ends
                          ORDER BY r.recorded_at DESC LIMIT 1) day_end ON TRUE
       LEFT JOIN LATERAL (SELECT r.energy_kwh FROM generation_reading r
                          WHERE r.installation_id = st.installation_id AND r.recorded_at < day.starts
                          ORDER BY r.recorded_at DESC LIMIT 1) before_day ON TRUE
       LEFT JOIN LATERAL (SELECT r.energy_kwh FROM generation_reading r
                          WHERE r.installation_id = st.installation_id
                            AND r.recorded_at >= day.starts AND r.recorded_at < day.ends
                          ORDER BY r.recorded_at ASC LIMIT 1) day_first ON TRUE
     )
     SELECT count(*)                                                   AS installation_count,
            COALESCE(sum(capacity_kw), 0)                              AS installed_capacity_kw,
            count(*) FILTER (WHERE recorded_at >= now() - make_interval(mins => $3)) AS reporting_installation_count,
            COALESCE(sum(power_kw) FILTER (WHERE recorded_at >= now() - make_interval(mins => $3)), 0) AS current_total_power_kw,
            max(recorded_at) FILTER (WHERE recorded_at >= now() - make_interval(mins => $3)) AS as_of,
            COALESCE(sum(day_last_kwh - day_start_kwh), 0)             AS total_energy_kwh,
            max(received_at)                                           AS last_modified
     FROM per_site`,
    [districtId, date, REPORTING_WINDOW_MINUTES],
  );
  return rows[0];
}
