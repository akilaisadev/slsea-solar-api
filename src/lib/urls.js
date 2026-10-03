// Absolute URLs for Location headers, pagination links and more_info.
// `trust proxy` is enabled in app.js, so behind Render's TLS proxy
// req.protocol reports "https" rather than the internal "http".

export function origin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

export function absoluteUrl(req, path) {
  return `${origin(req)}${path}`;
}
