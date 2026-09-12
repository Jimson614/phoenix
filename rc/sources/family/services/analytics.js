const repository = require('./repository')
const { isoNow } = require('../utils/date')

function track(eventName, context = {}) {
  return repository.insert('analyticsEvents', {
    user_id: context.userId || '',
    family_id: context.familyId || '',
    event_name: eventName,
    properties: context.properties || {},
    created_at: isoNow()
  })
}

function trackSession(userId) {
  if (!userId) return null
  const previous = repository.where('analyticsEvents', (event) => event.user_id === userId && event.event_name === 'app_session')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const now = new Date()
  const daysSincePrevious = previous ? Math.floor((now - new Date(previous.created_at)) / 86400000) : null
  const minutesSincePrevious = previous ? Math.floor((now - new Date(previous.created_at)) / 60000) : null
  if (minutesSincePrevious !== null && minutesSincePrevious < 5) return previous
  return track('app_session', {
    userId,
    properties: {
      days_since_previous: daysSincePrevious,
      returned_after_7d: daysSincePrevious !== null && daysSincePrevious >= 7,
      returned_after_30d: daysSincePrevious !== null && daysSincePrevious >= 30
    }
  })
}

module.exports = { track, trackSession }
