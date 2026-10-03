// Domain limits used by request validation. The same values appear in the
// database CHECK constraints (db/schema.sql) and the OpenAPI schemas, so a
// value the API accepts can always be stored.

// Sri Lanka's bounding box, so an installation cannot be placed elsewhere.
export const SRI_LANKA_BOUNDS = Object.freeze({
  minLatitude: 5.8,
  maxLatitude: 10,
  minLongitude: 79.4,
  maxLongitude: 82,
});

// Rooftop systems are small: anything larger is a utility-scale plant.
export const MAX_CAPACITY_KW = 500;

// An inverter can briefly exceed its nameplate rating on a cold, clear day,
// but not by more than about a quarter.
export const MAX_POWER_TO_CAPACITY_RATIO = 1.25;

export const MAX_VOLTAGE_V = 500;

// How far ahead of the server clock a device timestamp may be.
export const CLOCK_SKEW_MS = 5 * 60 * 1000;
