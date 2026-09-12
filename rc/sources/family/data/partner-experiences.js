// @ts-check
/** Partner Experience Layer content configuration. Pages keep partner copy out of templates. */

/** @type {import('../models/partner-experience').PartnerExperience} */
const yuanchao = {
  id: 'partner_exp_yuanchao_v01',
  slug: 'yuanchao',
  partnerName: '郭元朝',
  partnerRole: '艺术与创作导师',
  partnerCredentials: ['潮州原创音乐人', '音乐教育导师', 'Phoenix Nova™ 艺术合作人', '少年音乐创造力导师', '潮语文化与音乐表达合作伙伴'],
  projectName: '凤城少年启航™',
  englishName: 'Phoenix Young Creators',
  collaborationLabel: '郭元朝 × Phoenix Nova™',
  subtitle: '少年音乐创造力与家庭成长计划',
  theme: 'music',
  heroCopy: {
    eyebrow: '联合成长计划',
    headline: '让兴趣成为能力，\n让作品记录成长。',
    description: '从潮州出发，通过声音、旋律、创作与舞台表达，帮助孩子发现自己的兴趣、优势与成长方向。',
    supporting: '从潮州出发，听见孩子自己的声音。'
  },
  tags: ['音乐创造力', '潮州文化', '原创作品', '成长档案'],
  capabilityCards: [
    {
      number: '01', title: '发现声音', english: 'Discover',
      description: '从节奏、旋律、表达和文化兴趣中，发现孩子对音乐的真实反应。',
      tags: ['节奏感', '旋律感', '表达力', '文化兴趣']
    },
    {
      number: '02', title: '创作作品', english: 'Create',
      description: '让孩子从“学习一首歌”走向“表达自己的想法”，逐步形成原创作品。',
      tags: ['作词', '作曲', '演唱', '舞台表达']
    },
    {
      number: '03', title: '记录成长', english: 'Grow',
      description: '每一次创作、演出和导师观察，都成为孩子长期成长档案的一部分。',
      tags: ['原创作品', '导师记录', '成长里程碑', '家庭时间线']
    }
  ],
  journeySteps: [
    { number: '01', english: 'Explore', chinese: '探索', title: '进入联合体验' },
    { number: '02', english: 'Discover', chinese: '发现', title: '完成音乐创造力探索' },
    { number: '03', english: 'Create', chinese: '创作', title: '形成音乐成长画像' },
    { number: '04', english: 'Perform', chinese: '呈现', title: '进入导师共创计划' },
    { number: '05', english: 'Grow', chinese: '成长', title: '作品与里程碑写入家庭档案' }
  ],
  responsibilities: [
    {
      owner: '郭元朝', role: '艺术与创作导师',
      items: ['音乐创造力启发', '作词与旋律创作', '潮语文化表达', '原创作品指导', '舞台与作品呈现', '导师成长观察']
    },
    {
      owner: 'Phoenix Nova™', role: '家庭成长系统',
      items: ['Family Profile', 'Phoenix Compass™ 成长画像', 'AI Growth Insight', '作品与成长档案', 'Family Timeline', '家庭长期发展规划', '国际教育与成长资源连接']
    }
  ],
  collaborationStatement: '郭元朝提供真实的艺术创造与导师陪伴，Phoenix Nova™ 负责把这些经历转化为可持续积累的家庭成长资产。',
  outcomes: [
    { number: '01', title: '音乐创造力画像', items: ['音乐兴趣方向', '表达特点', '创作倾向', '导师观察'], note: '探索记录预览' },
    { number: '02', title: '第一件原创作品', items: ['作品名称', '作词记录', '旋律草稿', '创作日期'], note: '作品档案结构预览' },
    { number: '03', title: '舞台成长记录', items: ['活动名称', '舞台照片占位', '导师反馈', '家庭感受'], note: '成长记录结构预览' },
    { number: '04', title: 'Family Timeline 里程碑', items: ['2026 年 9 月｜完成第一首原创潮语歌曲'], note: '演示文案 · 非真实儿童资料' }
  ],
  cta: {
    headline: '让孩子完成第一件真正属于自己的作品',
    description: '从兴趣发现开始，在导师陪伴中完成创作，并把这段经历写入家庭成长档案。',
    primary: '申请联合体验',
    secondary: '保存至家庭计划'
  },
  status: 'preview'
}

const experiences = [yuanchao]

/** @param {string} slug */
function getPartnerExperience(slug) {
  return experiences.find((item) => item.slug === slug) || null
}

module.exports = { experiences, getPartnerExperience }
