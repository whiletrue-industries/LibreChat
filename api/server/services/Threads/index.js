const manage = require('./manage');
const hydrate = require('./hydrateHistory');

module.exports = {
  ...manage,
  ...hydrate,
};
