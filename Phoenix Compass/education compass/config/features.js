// 客户端功能可见性开关。
//
// 这里控制的是"入口是否露出"，不是权限：真正的授权判断始终在服务端
// （报告权益、AI 同意、限量等），关掉开关只是不给用户一个点进去必然失败的按钮。
//
// pdfExport
//   服务端的 PDF 仍是占位实现（server/src/pdf/simple-pdf.ts）：只用 Helvetica 与
//   ASCII 写报告 ID、数据日期和六个模块 key，无法渲染中文正文。补齐真正的中文
//   PDF 之前不对外露出导出入口，避免付费用户拿到一份空壳文件。
//
// paidReportAnalysis
//   已购报告 AI 总分析依赖真实的 AGENT_PROVIDER。默认 mock 时服务端会拒绝，
//   页面只会显示"暂未开启"，对刚付过款的家庭是个死胡同，因此先收起入口。
const FLAGS = {
  pdfExport: false,
  paidReportAnalysis: false
}

function enabled(name) {
  return FLAGS[name] === true
}

module.exports = { FLAGS, enabled, pdfExport: FLAGS.pdfExport, paidReportAnalysis: FLAGS.paidReportAnalysis }
