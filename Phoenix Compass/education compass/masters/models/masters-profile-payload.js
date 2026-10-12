const { normalizeProfile } = require('./masters-intake')

// UI blanks are unknown facts, not invalid date strings or invented scores.
function optionalDate(value) { return String(value || '').trim() || null }
module.exports = function profilePayload(profile) {
  const value = normalizeProfile(profile)
  return {
    ...value,
    contact: value.contact.value.trim() ? value.contact : null,
    graduationYear: optionalDate(value.graduationYear),
    graduationDate: optionalDate(value.graduationDate),
    languageScores: value.languageStatus === 'NONE' || value.languageType === 'NONE' ? null : {
      ...value.languageScores, examDate: optionalDate(value.languageScores.examDate)
    },
    experiences: value.experiences.map(item => ({ ...item, startDate: optionalDate(item.startDate), endDate: optionalDate(item.endDate) }))
  }
}
