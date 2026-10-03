-- SLSEA Solar Generation API: physical schema (PostgreSQL 16).
-- Derived from the implementation-independent model in docs/data-model.md:
--   Province 1-* District 1-* GridSubstation 1-* SolarInstallation 1-* GenerationReading
--   User (role + jurisdiction) reads within a province or district scope.
-- Idempotent: safe to run on every deploy.

CREATE TABLE IF NOT EXISTS province (
  province_id text PRIMARY KEY CHECK (province_id ~ '^pv-[0-9]{2}$'),
  name        text NOT NULL UNIQUE,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS district (
  district_id text PRIMARY KEY CHECK (district_id ~ '^ds-[0-9]{2}$'),
  name        text NOT NULL UNIQUE,
  province_id text NOT NULL REFERENCES province (province_id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS district_province_idx ON district (province_id);

CREATE TABLE IF NOT EXISTS grid_substation (
  substation_id text PRIMARY KEY CHECK (substation_id ~ '^gss-[0-9]{3}$'),
  name          text NOT NULL UNIQUE,
  district_id   text NOT NULL REFERENCES district (district_id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grid_substation_district_idx ON grid_substation (district_id);

-- The meter/inverter identifier is an attribute of the installation, not a
-- separate Device entity: each rooftop site has exactly one reporting
-- inverter, and the device's credential belongs to the installation it
-- reports for.
CREATE SEQUENCE IF NOT EXISTS installation_number_seq;

CREATE TABLE IF NOT EXISTS solar_installation (
  installation_id    text PRIMARY KEY
                     DEFAULT 'ins-' || lpad(nextval('installation_number_seq')::text, 4, '0')
                     CHECK (installation_id ~ '^ins-[0-9]{4,}$'),
  inverter_id        text NOT NULL UNIQUE,
  substation_id      text NOT NULL REFERENCES grid_substation (substation_id),
  capacity_kw        numeric(6, 2) NOT NULL CHECK (capacity_kw > 0 AND capacity_kw <= 500),
  latitude           numeric(8, 5) NOT NULL CHECK (latitude BETWEEN 5.8 AND 10.0),
  longitude          numeric(8, 5) NOT NULL CHECK (longitude BETWEEN 79.4 AND 82.0),
  commissioned_on    date NOT NULL,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'maintenance', 'decommissioned')),
  decommissioned_at  timestamptz,
  device_secret_hash text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decommission_consistent
    CHECK ((status = 'decommissioned') = (decommissioned_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS solar_installation_substation_idx ON solar_installation (substation_id);

-- GenerationReading is an append-only time series, not last-value fields on
-- the installation. recorded_at is the device's measurement time; received_at
-- is set by the server on arrival, so device clock drift can be audited.
CREATE TABLE IF NOT EXISTS generation_reading (
  reading_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id text NOT NULL REFERENCES solar_installation (installation_id),
  recorded_at     timestamptz NOT NULL,
  power_kw        numeric(8, 3) NOT NULL CHECK (power_kw >= 0),
  energy_kwh      numeric(12, 3) NOT NULL CHECK (energy_kwh >= 0),
  voltage_v       numeric(5, 1) NOT NULL CHECK (voltage_v BETWEEN 0 AND 500),
  received_at     timestamptz NOT NULL DEFAULT now(),
  -- One reading per installation per instant; also the index that serves
  -- "history for one installation ordered by time" in either direction.
  CONSTRAINT generation_reading_unique_instant UNIQUE (installation_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS generation_reading_recorded_at_idx ON generation_reading (recorded_at);

-- Append-only is enforced by the database, not just by the absence of
-- PUT/DELETE routes: any row-level UPDATE or DELETE is rejected.
CREATE OR REPLACE FUNCTION reject_reading_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'generation_reading is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE OR REPLACE TRIGGER generation_reading_append_only
  BEFORE UPDATE OR DELETE ON generation_reading
  FOR EACH ROW EXECUTE FUNCTION reject_reading_change();

-- An SLSEA user reads within exactly one jurisdiction: the whole country,
-- one province, or one district. Only national users may manage assets.
CREATE TABLE IF NOT EXISTS app_user (
  user_id            text PRIMARY KEY CHECK (user_id ~ '^usr-[0-9]{2,}$'),
  username           text NOT NULL UNIQUE,
  display_name       text NOT NULL,
  password_hash      text NOT NULL,
  role               text NOT NULL CHECK (role IN ('analyst', 'asset_admin')),
  jurisdiction_level text NOT NULL CHECK (jurisdiction_level IN ('national', 'province', 'district')),
  province_id        text REFERENCES province (province_id),
  district_id        text REFERENCES district (district_id),
  CONSTRAINT jurisdiction_consistent CHECK (
       (jurisdiction_level = 'national' AND province_id IS NULL AND district_id IS NULL)
    OR (jurisdiction_level = 'province' AND province_id IS NOT NULL AND district_id IS NULL)
    OR (jurisdiction_level = 'district' AND district_id IS NOT NULL AND province_id IS NULL)
  ),
  CONSTRAINT admin_is_national CHECK (role <> 'asset_admin' OR jurisdiction_level = 'national')
);

-- Keeps updated_at (the source of Last-Modified) honest on every change.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER solar_installation_touch
  BEFORE UPDATE ON solar_installation
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
