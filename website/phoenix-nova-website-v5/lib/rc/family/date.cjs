function pad(value) { return String(value).padStart(2, '0') }

function isoNow() { return new Date().toISOString() }

function dateLabel(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return value || ''
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function dateTimeLabel(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return value || ''
  return `${dateLabel(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

module.exports = { isoNow, dateLabel, dateTimeLabel }
