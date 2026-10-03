# Data Model (WSO2 §3: the model comes before resources and URIs)

This model is implementation-independent. It names entities, attributes and cardinalities, but no storage types, formats or URIs. The physical schema in `db/schema.sql` is derived from it.

```mermaid
erDiagram
    PROVINCE ||--|{ DISTRICT : "contains"
    DISTRICT ||--|{ GRID_SUBSTATION : "contains"
    GRID_SUBSTATION ||--o{ SOLAR_INSTALLATION : "connects"
    SOLAR_INSTALLATION ||--o{ GENERATION_READING : "reports"
    PROVINCE |o--o{ USER : "scopes (province users)"
    DISTRICT |o--o{ USER : "scopes (district users)"

    PROVINCE {
        id province_id
        string name
    }
    DISTRICT {
        id district_id
        string name
    }
    GRID_SUBSTATION {
        id substation_id
        string name
    }
    SOLAR_INSTALLATION {
        id installation_id
        string inverter_id "meter identifier: an attribute, not an entity"
        decimal capacity_kw
        decimal latitude
        decimal longitude
        date commissioned_on
        enum status "active | maintenance | decommissioned"
        secret device_credential
    }
    GENERATION_READING {
        id reading_id
        instant recorded_at "device measurement time"
        decimal power_kw "instantaneous"
        decimal energy_kwh "cumulative lifetime counter"
        decimal voltage_v
        instant received_at "server arrival time"
    }
    USER {
        id user_id
        string username
        enum role "analyst | asset_admin"
        enum jurisdiction_level "national | province | district"
    }
```

## Cardinalities

| Relationship | Cardinality | Note |
|---|---|---|
| Province → District | 1 to 1..* | 9 provinces, 25 districts |
| District → GridSubstation | 1 to 1..* | every district has at least one substation |
| GridSubstation → SolarInstallation | 1 to 0..* | a new substation may have no sites yet |
| SolarInstallation → GenerationReading | 1 to 0..* | a newly registered site has no readings yet |
| User → jurisdiction | national: none; province: exactly 1 Province; district: exactly 1 District | enforced by a CHECK constraint |

## Decisions that carry marks

1. **`inverter_id` is an attribute of SolarInstallation, not a Device entity.** Each rooftop site has one reporting inverter, and the device only exists to report for that site. A Device entity would only earn its place if the system had to track device replacement, firmware or calibration history, which is out of scope. The device's credential is also stored on the installation, because the device authenticates *as* the installation.
2. **GenerationReading is its own append-only time series**, not `last_power` fields on the installation. Last-value fields would destroy the analytical (historical) scope. The "latest reading" is *derived* from the series, which gives the `last-reading` processing resource. Append-only is enforced by a database trigger that rejects UPDATE and DELETE.
3. **Added field `received_at`** (beyond the brief's minimum). `recorded_at` is the device's clock, used for analytics; `received_at` is the server's clock, used for audit. The gap between the two exposes device clock drift or replayed or buffered uploads without trusting the device.
4. **`energy_kwh` is cumulative**, as on a real meter. Daily energy is derived as the difference between the day's last and first counter values, which is robust to missed readings.
5. **Write and read concerns are separate entities.** Devices (write clients) are represented by the installation's credential. SLSEA people (read clients) are Users with a jurisdiction. The model has no path for a User to be a data producer.
6. **Deletion is soft.** Decommissioning an installation keeps its readings, because generation history is an audit record.
