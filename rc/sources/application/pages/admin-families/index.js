const { repository } = require('../../services/demo-runtime')
const session = require('../../services/session')
const auth = require('../../services/auth')
const { dateLabel } = require('../../utils/date')
const runtime = require('../../config/runtime')

Page({
  data: { advisor: null, families: [], allFamilies: [], query: '' },
  onShow() { this.load() },
  onPullDownRefresh() { this.load(); wx.stopPullDownRefresh() },
  load() {
    if (!runtime.isDemo()) return wx.reLaunch({ url: '/pages/welcome/index' })
    const advisor = session.guard(['admin'])
    if (!advisor) return
    const families = repository.all('families').map((family) => {
      const overview = repository.familyOverview(family.id)
      const lastRequest = overview.requests[0]
      const lastEvent = overview.events[0]
      const lastNote = overview.notes[0]
      return {
        ...family, students: overview.students, reportCount: overview.reports.length,
        lastUpdate: lastEvent ? dateLabel(lastEvent.date) : dateLabel(family.created_at),
        followStatus: lastNote ? lastNote.follow_up_status : (lastRequest ? '待联系' : '未申请'),
        hasRequest: !!lastRequest
      }
    }).sort((a, b) => b.created_at.localeCompare(a.created_at))
    this.setData({ advisor, families, allFamilies: families })
  },
  search({ detail }) {
    const query = detail.value.trim().toLowerCase()
    const families = !query ? this.data.allFamilies : this.data.allFamilies.filter((family) =>
      `${family.family_name}${family.parent_name}${family.phone}${family.location}`.toLowerCase().includes(query)
    )
    this.setData({ query, families })
  },
  open({ currentTarget }) { wx.navigateTo({ url: `/pages/admin-family/index?id=${currentTarget.dataset.id}` }) },
  logout() { auth.logout(); wx.reLaunch({ url: '/pages/welcome/index' }) }
})
