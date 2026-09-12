import type { MastersReportPayload } from '../../src/domain/masters/contracts'

/**
 * Public catalog manually read on 2026-09-05. This is a fixed test fixture,
 * not a runtime source catalog/search adapter or a recommendation to a client.
 * https://prog-crs.hkust.edu.hk/pgprog/2027-28/msc-bdt
 * Sections: Admission Requirements; Application / 2027/28 Fall Term Intake.
 */
export const sourcedProgram: MastersReportPayload['candidatePrograms'][number] = {
  institution: '香港科技大学',
  program: 'Master of Science in Big Data Technology',
  intakeYear: '2027',
  requirements: '须有认可院校学士学位。计算机工程、计算机科学、数学或相关学科可申请；其他学科需相关 IT 与数学工作经验。雅思学术类总分至少 6.5、各小分至少 5.5（官网另列其他英语资格及豁免条件，需逐人核对）。',
  matchReason: '仅针对本测试虚构学生：本科方向为计算机科学，与官网列出的相关专业方向相符；学位和语言资格仍须对原件核验。',
  risks: ['具备最低条件不保证录取。', '虚构学生暂无语言成绩，需核对英语资格；不得将待补材料标成已满足。'],
  officialUrl: 'https://prog-crs.hkust.edu.hk/pgprog/2027-28/msc-bdt',
  verifiedAt: '2026-09-05',
  sourceStatus: 'VERIFIED',
  studentAccepted: 'PENDING'
}

export const assistedReportPatch: Partial<MastersReportPayload> = {
  backgroundSummary: '完全虚构的计算机科学本科申请人，拟于 2027 年入学；暂无语言成绩。此记录只用于工程验收。',
  strengthsAndGaps: { strengths: ['学生在虚构测试档案中提供了计算机科学本科方向'], gaps: ['语言资格与原件待核验，不作已满足判断'] },
  suggestedDirections: ['将大数据技术作为一项待学生确认的方向，由顾问核对课程与经历'],
  candidatePrograms: [sourcedProgram],
  preparationPlan: ['补交语言成绩或可用的英语授课证明，核对官网豁免条件', '顾问核对学位、成绩单与 2027 入学要求'],
  nextStepsAndLimitations: ['官网要求于 2026-09-05 人工查阅；日后变更须重新核验。', '这是带明确资料限制的人工核验辅助方案，不是自动选校或录取承诺。']
}
