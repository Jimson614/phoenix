const fields = {
  name: '姓名／称呼', adultConfirmed: '成年确认', contact: '联系方式', 'contact.value': '联系方式',
  educationStatus: '学籍状态', institution: '本科院校', major: '本科专业', degree: '学位名称',
  graduationYear: '毕业年份', graduationDate: '毕业年月', academicScore: '学业成绩', averageScore: '百分制均分',
  gpa: 'GPA', gpaScale: 'GPA 满分制', classRank: '专业排名', languageType: '语言考试', languageStatus: '语言情况',
  languageScores: '语言成绩', 'languageScores.total': '语言总分', 'languageScores.examDate': '语言考试日期', 'languageScores.raw': '语言成绩说明',
  'languageScores.subscores.listening': '听力', 'languageScores.subscores.reading': '阅读',
  'languageScores.subscores.writing': '写作', 'languageScores.subscores.speaking': '口语',
  targetYear: '入学年份', targetMajors: '意向专业', targetInstitutions: '意向院校', targetPreference: '目标偏好',
  experiences: '相关经历', serviceConsent: '咨询资料授权', accuracyConfirmed: '资料准确确认',
  listening: '听力', reading: '阅读', writing: '写作', speaking: '口语', total: '总分', examDate: '考试日期', raw: '原始说明', subscores: '小分'
}
const values = {
  UNDECIDED: '尚未确定，希望顾问建议', ENROLLED: '本科在读', GRADUATED: '已毕业', NONE: '暂无', AVAILABLE: '已有成绩',
  RESUME: '个人简历', TRANSCRIPT: '本科成绩单', LANGUAGE: '语言成绩证明', ENROLLMENT: '在读证明',
  GRADUATION: '毕业证书', DEGREE: '学位证书', SUPPLEMENTAL: '补充证明',
  INTERNSHIP: '实习', RESEARCH: '科研', COMPETITION: '竞赛', STUDENT_WORK: '学生工作', OTHER: '其他',
  IELTS: '雅思', TOEFL: '托福', PENDING: '待确认', VERIFIED: '顾问已核验', NEEDS_REVIEW: '待核验'
}
function fieldLabel(value) { return fields[String(value || '').replace(/^profile\./, '')] || '资料项' }
function targetYearLabel(value) { return !value || value === 'UNDECIDED' ? values.UNDECIDED : String(value) }
function contactTypeLabel(value) { return { phone: '手机', wechat: '微信', email: '邮箱' }[value] || '联系方式' }
function studentValue(value) { return values[String(value)] || fields[String(value)] || String(value === undefined || value === null ? '待补' : value) }
module.exports = { fieldLabel, targetYearLabel, contactTypeLabel, studentValue }
