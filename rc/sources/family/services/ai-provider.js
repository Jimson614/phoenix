const localInsight = require('./insight')

const PROVIDER_MODE = 'local_rules'

function generateGrowthInsight(student, answers) {
  // Stable provider boundary for a later trusted cloud function.
  // The MVP deliberately uses a deterministic, explainable local engine.
  return localInsight.generate(student, answers)
}

module.exports = { PROVIDER_MODE, generateGrowthInsight }
