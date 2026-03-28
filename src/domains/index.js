/**
 * Domain Index — single import point for all domain modules
 */
module.exports = {
  plan: require('./plan'),
  node: require('./node'),
  decision: require('./decision'),
  dependency: require('./dependency'),
  goal: require('./goal'),
  knowledge: require('./knowledge'),
  collaboration: require('./collaboration'),
  search: require('./search'),
};
