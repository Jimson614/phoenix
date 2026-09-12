const { repository } = require('../../services/demo-runtime')
const session = require('../../services/session')
const { isoNow, dateLabel, dateTimeLabel } = require('../../utils/date')
const runtime = require('../../config/runtime')

Page({
  data: {
    familyId: '', overview: null, note: '',
    statuses: ['待联系', '跟进中', '等待家庭回复', '已完成本次跟进'], statusIndex: 0
  },
  onLoad(options) {
    if (!runtime.isDemo()) return wx.reLaunch({ url: '/pages/welcome/index' })
    if (!session.guard(['admin'])) return
    this.setData({ familyId: options.id })
  },
  onShow() { if (this.data.familyId) this.load() },
  load() {
    const overview = repository.familyOverview(this.data.familyId)
    if (!overview) return wx.navigateBack()
    overview.students = overview.students.map((student) => ({ ...student, initial: student.name.charAt(0) }))
    overview.reports = overview.reports.map((report) => ({ ...report, dateLabel: dateLabel(report.created_at) }))
    overview.events = overview.events.map((event) => ({ ...event, dateTimeLabel: dateTimeLabel(event.date) }))
    overview.notes = overview.notes.map((note) => ({ ...note, dateTimeLabel: dateTimeLabel(note.created_at) }))
    overview.requests = overview.requests.map((request) => ({ ...request, dateTimeLabel: dateTimeLabel(request.created_at) }))
    this.setData({ overview })
  },
  inputNote({ detail }) { this.setData({ note: detail.value }) },
  pickStatus({ detail }) { this.setData({ statusIndex: Number(detail.value) }) },
  addNote() {
    const note = this.data.note.trim()
    if (!note) return wx.showToast({ title: '请填写顾问备注', icon: 'none' })
    const advisor = session.currentUser()
    repository.insert('advisorNotes', {
      family_id: this.data.familyId, advisor_id: advisor.id, note,
      follow_up_status: this.data.statuses[this.data.statusIndex], created_at: isoNow()
    })
    repository.addTimeline(this.data.familyId, 'advisor_note', 'Phoenix 顾问已更新家庭跟进记录')
    this.setData({ note: '' })
    this.load()
    wx.showToast({ title: '备注已保存', icon: 'success' })
  },
  openReport({ currentTarget }) { wx.navigateTo({ url: `/pages/report/index?id=${currentTarget.dataset.id}` }) }
})
