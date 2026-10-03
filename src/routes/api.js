import { Router } from 'express';
import { provincesRouter } from './provinces.js';
import { districtsRouter } from './districts.js';
import { gridSubstationsRouter } from './gridSubstations.js';
import { installationsRouter } from './installations.js';
import { readingsRouter } from './readings.js';

// Everything under the versioned base path /solar/v1 (WSO2 §5.4–5.5).
export const apiRouter = Router();

apiRouter.use('/provinces', provincesRouter);
apiRouter.use('/districts', districtsRouter);
apiRouter.use('/grid-substations', gridSubstationsRouter);
apiRouter.use('/installations', installationsRouter);
apiRouter.use('/readings', readingsRouter);
