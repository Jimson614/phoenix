// This adapter exists only for the source/demo project. `npm run build:release`
// replaces it with an empty remote-only adapter and excludes the local store,
// demo report generator and advisor demo pages from the publishable package.
const repository = require('./repository')
const aiProvider = require('./ai-provider')

module.exports = { repository, aiProvider }
