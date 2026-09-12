import {
  RESULT_VERSION,
  type AssessmentInput,
  type GrowthSnapshot,
  type Interest,
} from "@/lib/compass/types";

export const RESULT_DISCLAIMER =
  "本结果基于有限自报信息，仅用于成长探索，不构成诊断、录取预测或专业规划结论。";

const ageLabels: Record<AssessmentInput["age_band"], string> = {
  under_6: "启蒙阶段",
  "6_8": "小学早期",
  "9_11": "小学成长阶段",
  "12_14": "初中成长阶段",
  "15_18": "高中成长阶段",
  over_18: "高等教育及以后阶段",
};

const curriculumLabels: Record<AssessmentInput["curriculum"], string> = {
  mainland: "内地课程",
  dse: "香港本地课程 / DSE",
  ib: "IB 课程",
  a_level: "A-Level 课程",
  btec: "BTEC 课程",
  other: "尚在确认的课程环境",
};

const interestMeta: Record<
  Interest,
  Readonly<{
    short: string;
    type: string;
    signal: string;
    direction: string;
    reason: string;
    action: string;
  }>
> = {
  technology: {
    short: "科技",
    type: "科技探索型",
    signal: "对系统、工具、原理或解决问题表现出投入意愿",
    direction: "科技问题小实验",
    reason: "科技兴趣更适合通过动手、拆解和真实问题来持续验证。",
    action: "选一个日常工具，记录它解决了什么问题，并画出改进草图。",
  },
  art: {
    short: "创意",
    type: "创意表达型",
    signal: "对视觉、语言、音乐或创作表达表现出投入意愿",
    direction: "一页创意作品",
    reason: "创作能让孩子把兴趣变成看得见、可讨论的表达。",
    action: "用喜欢的媒介完成一页作品，并说出最想表达的一件事。",
  },
  business: {
    short: "商业",
    type: "商业行动型",
    signal: "对组织、协作、资源或行动结果表现出投入意愿",
    direction: "迷你项目挑战",
    reason: "小型真实项目能观察计划、协作与复盘意愿，而不是提前下结论。",
    action: "设计一个 30 分钟家庭小项目，列出目标、分工和完成标准。",
  },
  education: {
    short: "人文",
    type: "人文连接型",
    signal: "对理解他人、分享知识或连接观点表现出投入意愿",
    direction: "观点连接练习",
    reason: "讲述与倾听能帮助家庭观察孩子如何理解信息和他人。",
    action: "选一个喜欢的话题，用三句话讲给家人，再记录一个新问题。",
  },
  health: {
    short: "生命",
    type: "生命关怀型",
    signal: "对生命科学、健康议题或照护表现出投入意愿",
    direction: "生命观察日志",
    reason: "从科学观察和责任感入手，比过早推断职业适配更可靠。",
    action: "连续三天观察一个健康或生命现象，只记录事实和新问题。",
  },
  exploring: {
    short: "多元",
    type: "多元探索型",
    signal: "兴趣仍在形成，当前更适合通过多种真实体验继续观察",
    direction: "三次微体验",
    reason: "尚在探索不是缺乏方向，而是需要低压力地积累可比较的体验。",
    action: "本周安排三次各 20 分钟的不同体验，记录哪一次最愿意继续。",
  },
};

const goalSignals: Record<AssessmentInput["family_goal"], string> = {
  discover_strengths: "家庭希望先发现可持续观察的优势信号",
  education_direction: "家庭希望把兴趣与下一阶段课程方向连接起来",
  career_exploration: "家庭希望为专业与职业探索建立早期线索",
  global_path: "家庭希望在不同地区与教育路径之间建立更清楚的比较框架",
  family_communication: "家庭希望用更好的观察与沟通支持孩子成长",
  unsure: "家庭希望先找到一个低压力、可行动的探索起点",
};

const todayActions: Record<AssessmentInput["family_goal"], string> = {
  discover_strengths: "今晚用 10 分钟回顾：孩子最近哪件事做完后还主动想继续？只记录行为，不急着评价。",
  education_direction: "列出一门当前课程和一个兴趣，问孩子：哪一个真实任务最能把两者连接起来？",
  career_exploration: "一起找一个相关职业的真实日常任务，讨论“想试什么”和“还想知道什么”。",
  global_path: "先列出家庭最重视的三个路径条件，例如学习体验、连续性与支持网络，不急着选学校。",
  family_communication: "进行一次 10 分钟倾听：家长只问“最近什么最吸引你”，不纠正、不建议，最后复述所听见的内容。",
  unsure: "本周选三种不同的小体验，每次结束只问两个问题：愿不愿继续？哪部分最投入？",
};

function secondaryDirection(input: AssessmentInput) {
  if (input.family_goal === "family_communication") {
    return {
      title: "家庭观察对话",
      reason: "把评价换成具体观察，有助于看见兴趣在什么情境下持续出现。",
      micro_action: "本周选一个晚餐时间，只分享观察到的行为，并请孩子补充自己的感受。",
    };
  }
  if (input.family_goal === "global_path" || input.family_goal === "education_direction") {
    return {
      title: "路径条件清单",
      reason: "先明确家庭真正重视的条件，再比较课程与地区，能减少信息噪音。",
      micro_action: "列出三个必须条件和两个可调整条件，下次查资料时只围绕这些条件记录。",
    };
  }
  return {
    title: "投入时刻记录",
    reason: "跨场景重复出现的投入行为，比一次选择更值得继续观察。",
    micro_action: "连续七天记录一次“主动开始、持续投入或主动追问”的具体时刻。",
  };
}

export function createSafeFallback(input: AssessmentInput): GrowthSnapshot {
  const selected = input.interests.map((interest) => interestMeta[interest]);
  const growthTitle =
    selected.length === 2 ? `${selected[0].short} × ${selected[1].short}探索型` : selected[0].type;
  const interestPhrase = selected.map((item) => item.short).join("与");
  const directions = selected.map((item) => ({
    title: item.direction,
    reason: item.reason,
    micro_action: item.action,
  }));
  if (directions.length < 3) directions.push(secondaryDirection(input));

  return {
    result_version: RESULT_VERSION,
    growth_type: {
      title: growthTitle,
      summary: `${ageLabels[input.age_band]}、${curriculumLabels[input.curriculum]}情境下，孩子当前对${interestPhrase}相关体验表现出更愿意投入的信号。这个标签只是一份方向快照，值得在真实行动中继续观察。`,
    },
    strength_signals: [
      {
        title: "主动投入线索",
        evidence: selected[0].signal + "，这是当前最直接的兴趣依据。",
      },
      selected.length === 2
        ? {
            title: "跨方向连接",
            evidence: `${selected[0].short}与${selected[1].short}同时被选择，说明组合体验可能比单一路径更值得尝试。`,
          }
        : {
            title: "持续观察空间",
            evidence: "目前只有有限结构化回答，真正稳定的优势仍需要在不同任务和时间中继续观察。",
          },
      {
        title: "家庭关注焦点",
        evidence: `${goalSignals[input.family_goal]}，因此本次建议优先帮助家庭形成可执行的下一步。`,
      },
    ],
    possible_directions: directions.slice(0, 3),
    today_action: todayActions[input.family_goal],
    disclaimer: RESULT_DISCLAIMER,
  };
}

export function normalizeGrowthSnapshot(result: GrowthSnapshot): GrowthSnapshot {
  return {
    result_version: RESULT_VERSION,
    growth_type: {
      title: result.growth_type.title,
      summary: result.growth_type.summary,
    },
    strength_signals: result.strength_signals.map((signal) => ({
      title: signal.title,
      evidence: signal.evidence,
    })),
    possible_directions: result.possible_directions.map((direction) => ({
      title: direction.title,
      reason: direction.reason,
      micro_action: direction.micro_action,
    })),
    today_action: result.today_action,
    disclaimer: RESULT_DISCLAIMER,
  };
}
