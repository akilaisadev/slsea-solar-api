import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { allowOnly } from '../middleware/allow.js';
import { requireScope } from '../middleware/authenticate.js';
import { requireBodyType } from '../middleware/negotiate.js';
import { ApiError } from '../lib/errors.js';
import { parseQuery, parseBody } from '../lib/validate.js';
import { paginated, paginationParams } from '../lib/pagination.js';
import { sendRepresentation } from '../lib/respond.js';
import { absoluteUrl } from '../lib/urls.js';
import {
  listInstallationReadings, findReading, findReadingBefore, findReadingAt, insertReading,
} from '../repositories/readings.js';
import { toReading } from '../representations.js';
import { loadInstallation, loadDeviceInstallation } from './loaders.js';
import { timeWindowParams, timeWindowOf, order } from './queryParams.js';

// /installations/{installation-id}/readings: a scoped collection (§4.6,
// §5.6). A reading has no meaning without its installation, so the parent
// is part of the path rather than a query-string filter. It is also the
// only factory for readings: devices POST here, nowhere else.
export const installationReadingsRouter = Router({ mergeParams: true });

const listQuery = z.strictObject({
  ...paginationParams,
  ...timeWindowParams,
  sort: z.enum(['recorded_at', 'power_kw']).default('recorded_at'),
  order: order('desc'),
});

// What a device sends. The installation comes from the path (and must match
// the token); received_at and reading_id are set by the server.
const readingBody = z.strictObject({
  recorded_at: z.iso.datetime({ offset: true, error: 'must be an ISO 8601 date-time such as 2026-10-03T08:45:00Z' }),
  power_kw: z.number().min(0),
  energy_kwh: z.number().min(0),
  voltage_v: z.number().min(0).max(500),
});

const CLOCK_SKEW_MS = 5 * 60 * 1000;

function invalidField(field, message) {
  return new ApiError(40002, 'The request body is invalid.', { errors: [{ code: 40002, field, message }] });
}

const readingUri = (req, installationId, readingId) =>
  absoluteUrl(req, `${config.basePath}/installations/${installationId}/readings/${readingId}`);

installationReadingsRouter.route('/')
  .get(requireScope('readings:read'), async (req, res) => {
    const installation = await loadInstallation(req);
    const query = parseQuery(listQuery, req);
    const { offset, limit } = query;
    const page = await listInstallationReadings(req.app.locals.db, {
      installationId: installation.installation_id,
      window: timeWindowOf(query),
      sort: query.sort,
      order: query.order,
      offset,
      limit,
    });
    sendRepresentation(req, res, paginated(req, { count: page.count, offset, limit, items: page.rows.map(toReading) }), {
      lastModified: page.lastModified,
    });
  })
  // POST: a metering device appends one reading for its own installation.
  // 201 Created + Location of the new reading (WSO2 §7.3, §9).
  .post(requireScope('readings:write'), requireBodyType('application/json'), async (req, res) => {
    const db = req.app.locals.db;
    const installation = await loadDeviceInstallation(req);
    const reading = parseBody(readingBody, req);
    const recordedAt = new Date(reading.recorded_at);

    // Plausibility checks a schema cannot express.
    if (recordedAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw invalidField('recorded_at', 'cannot be in the future');
    }
    if (reading.power_kw > installation.capacity_kw * 1.25) {
      throw invalidField('power_kw', `exceeds 125% of the installation's ${installation.capacity_kw} kW capacity`);
    }
    const previous = await findReadingBefore(db, installation.installation_id, recordedAt);
    if (previous && reading.energy_kwh < previous.energy_kwh) {
      throw invalidField('energy_kwh', `is a cumulative counter and cannot fall below the previous reading (${previous.energy_kwh} kWh)`);
    }

    const created = await insertReading(db, installation.installation_id, { ...reading, recorded_at: recordedAt });
    if (!created) {
      // Same installation, same instant: a retried upload. The time series
      // keeps one value per instant, so the duplicate is refused (409) and
      // the client is told where the existing reading lives.
      const existing = await findReadingAt(db, installation.installation_id, recordedAt);
      throw new ApiError(40901, `A reading for ${recordedAt.toISOString()} already exists at ${readingUri(req, installation.installation_id, existing.reading_id)}.`);
    }

    res.set('Location', readingUri(req, installation.installation_id, created.reading_id));
    sendRepresentation(req, res, toReading(created), { status: 201, lastModified: created.received_at });
  })
  .all(allowOnly('GET', 'POST'));

// One reading: the URI a 201 Location header points to after ingestion.
// Readings are append-only, so this URI allows GET only (PUT/PATCH/DELETE
// get 405 with Allow, and the database rejects changes anyway).
installationReadingsRouter.route('/:readingId')
  .get(requireScope('readings:read'), async (req, res) => {
    const installation = await loadInstallation(req);
    const { readingId } = req.params;
    // A non-numeric id cannot name a reading; answer 404 rather than let
    // PostgreSQL reject the bigint cast as a 500.
    const reading = /^[0-9]{1,15}$/.test(readingId)
      ? await findReading(req.app.locals.db, installation.installation_id, Number(readingId))
      : null;
    if (!reading) {
      throw new ApiError(40401, `Reading '${readingId}' was not found for installation '${installation.installation_id}'.`);
    }
    sendRepresentation(req, res, toReading(reading), { lastModified: reading.received_at });
  })
  .all(allowOnly('GET'));
