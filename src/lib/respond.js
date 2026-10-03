// Sends a representation with its validators (WSO2 §8.2). Last-Modified
// comes from the data itself (updated_at / received_at), not from the clock.
export function sendRepresentation(req, res, body, { lastModified } = {}) {
  if (lastModified) res.set('Last-Modified', new Date(lastModified).toUTCString());
  res.json(body);
}
