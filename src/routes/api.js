import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { provincesRouter } from './provinces.js';
import { districtsRouter } from './districts.js';
import { gridSubstationsRouter } from './gridSubstations.js';
import { installationsRouter } from './installations.js';
import { readingsRouter } from './readings.js';

// Everything under the versioned base path /solar/v1 (WSO2 §5.4–5.5).
// No resource here is public: every request must present a valid bearer
// token, and each route then checks the scope it needs.
export const apiRouter = Router();

apiRouter.use(authenticate);
apiRouter.use('/provinces', provincesRouter);
apiRouter.use('/districts', districtsRouter);
apiRouter.use('/grid-substations', gridSubstationsRouter);
apiRouter.use('/installations', installationsRouter);
apiRouter.use('/readings', readingsRouter);
