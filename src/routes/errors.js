import { Router } from 'express';
import { allowOnly } from '../middleware/allow.js';
import { ApiError, ERROR_CATALOGUE } from '../lib/errors.js';

// The target of every error body's more_info link (WSO2 §11): a stable,
// machine-readable explanation of each error code.
export const errorsRouter = Router();

function entry(code) {
  const { status, description, resolution } = ERROR_CATALOGUE[code];
  return { code: Number(code), http_status: status, description, resolution };
}

errorsRouter.route('/:errorCode')
  .get((req, res) => {
    const { errorCode } = req.params;
    if (!ERROR_CATALOGUE[errorCode]) {
      throw new ApiError(40401, `Error code ${errorCode} is not defined by this API.`);
    }
    res.json(entry(errorCode));
  })
  .all(allowOnly('GET'));
