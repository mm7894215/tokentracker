// Edge function: vibeusage-public-view-issue
// Retired: replaced by vibeusage-public-visibility.

'use strict';

const { handleOptions, json } = require('../shared/http');
const { withRequestLogging } = require('../shared/logging');

module.exports = withRequestLogging('vibeusage-public-view-issue', async function(request) {
  const opt = handleOptions(request);
  if (opt) return opt;
  return json({ error: 'Endpoint retired' }, 410);
});
