// One-off refresh (log in, fetch openings, download logos):  npm run pi:refresh
// Handy for checking that the login works on the Pi before starting the server.
require('./load-env');
const { refresh } = require('../lib/publisher');
refresh().then(
  () => process.exit(0),
  (err) => { console.error('refresh failed:', err.message); process.exit(1); }
);
