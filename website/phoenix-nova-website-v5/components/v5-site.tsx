import Image from "next/image";
import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { FamilyDashboardPreview } from "./family-dashboard-preview";
import { PatternMedallion } from "./pattern-medallion";

export const pageIds = [
  "compass",
  "lighthouse",
  "services",
  "insights",
  "oriental",
  "about",
  "family-center",
] as const;

export type PageId = "home" | (typeof pageIds)[number];
export type Locale = "zh" | "en";

const routeLabels = {
  home: ["首页", "Home"],
  compass: ["凤启罗盘", "Compass"],
  lighthouse: ["成长灯塔", "Growth Lighthouse"],
  services: ["专业服务", "Services"],
  insights: ["凤启洞察", "Insights"],
  oriental: ["凤启东方", "Phoenix Oriental"],
  about: ["关于凤启", "About"],
  "family-center": ["家庭中心", "Family Center"],
} as const;

export const routeMetadata = {
  compass: { zh: "凤启罗盘", en: "Phoenix Compass" },
  lighthouse: { zh: "成长灯塔", en: "Growth Lighthouse" },
  services: { zh: "专业服务", en: "Professional Services" },
  insights: { zh: "凤启洞察", en: "Phoenix Insights" },
  oriental: { zh: "凤启东方", en: "Phoenix Oriental" },
  about: { zh: "关于凤启", en: "About Phoenix Nova" },
  "family-center": { zh: "家庭中心", en: "Family Center" },
} as const;

const digitalWorldUrl = "https://fengqi-research-institute.yvettfang.chatgpt.site";

const primaryNavigation = [
  { kind: "internal", page: "home" },
  { kind: "internal", page: "compass" },
  { kind: "internal", page: "lighthouse" },
  { kind: "internal", page: "services" },
  { kind: "internal", page: "insights" },
  { kind: "internal", page: "oriental" },
  { kind: "external", id: "digital" },
  { kind: "internal", page: "about" },
] as const;

const journeyData = [
  {
    no: "01",
    zh: "下一代成长",
    en: "Next Generation",
    zhDescription: "从学习方式、课程体系到升学与职业方向，陪孩子形成可持续的成长路径。",
    enDescription: "From learning and curricula to admissions and future direction, build a path that can keep evolving.",
    zhDetail: "DSE、A-Level、IB、国际学校、大学规划、ASKWISE、面试与职业方向",
    enDetail: "DSE, A-Level, IB, international schools, university planning, ASKWISE, interviews and career direction",
  },
  {
    no: "02",
    zh: "来港启程",
    en: "Hong Kong Pathway",
    zhDescription: "把身份路径、家庭落地与长期居住节点放在同一张行动地图上。",
    enDescription: "Bring identity pathways, family landing and long-term residence milestones into one action map.",
    zhDetail: "高才、优才、企业家、专才、受养人、续签、永居与落地协作",
    enDetail: "Talent, entrepreneur, professional and dependant pathways, renewal, residence and landing coordination",
  },
  {
    no: "03",
    zh: "家庭保障",
    en: "Family Protection",
    zhDescription: "从真实家庭情境出发，统筹健康支持、风险保障与关键文件。",
    enDescription: "Coordinate health support, protection needs and essential records around the family's real situation.",
    zhDetail: "医疗协作、危疾与长期保障、理赔资料与医生预约",
    enDetail: "Healthcare coordination, critical and long-term protection, claims records and appointments",
  },
  {
    no: "04",
    zh: "企业发展",
    en: "Business Growth",
    zhDescription: "让来港发展、企业运营与家庭安排不再彼此割裂。",
    enDescription: "Connect Hong Kong business development, operations and family arrangements as one coherent journey.",
    zhDetail: "公司设立、银行协调、周年事项、审计税务、雇员福利与企业文件",
    enDetail: "Company setup, banking coordination, annual matters, audit and tax, employee benefits and records",
  },
  {
    no: "05",
    zh: "全球规划",
    en: "Global Planning",
    zhDescription: "围绕家庭目标，协调身份、教育、医疗与迁居选择。",
    enDescription: "Coordinate identity, education, healthcare and relocation choices around the family's goals.",
    zhDetail: "香港、大湾区与全球生活路径的综合规划",
    enDetail: "Integrated planning across Hong Kong, the Greater Bay Area and global living pathways",
  },
  {
    no: "06",
    zh: "家族传承",
    en: "Family Legacy",
    zhDescription: "把财富保护、家庭共识与代际安排放进长期视野。",
    enDescription: "Place wealth protection, family alignment and intergenerational arrangements in a long-term view.",
    zhDetail: "财富保护、家族治理、代际安排与家办协同",
    enDetail: "Wealth protection, family governance, intergenerational planning and family-office coordination",
  },
] as const;

const insightData = [
  {
    zhTag: "家庭与未来",
    enTag: "Family & Future",
    zhTitle: "选择很多，为什么家庭仍然缺少方向？",
    enTitle: "Why do families still lack direction when options keep multiplying?",
    zhBody: "从真实家庭问题出发，理解教育、身份与长期成长之间的关系。",
    enBody: "Understand how education, identity and long-term growth connect through real family questions.",
  },
  {
    zhTag: "香港与选择",
    enTag: "Hong Kong & Choice",
    zhTitle: "香港不是单一目的地，而是一组家庭选择。",
    enTitle: "Hong Kong is not one destination, but a set of family choices.",
    zhBody: "把政策信息放回家庭目标、时间与执行条件中重新理解。",
    enBody: "Read policy information in the context of family goals, timing and real execution conditions.",
  },
  {
    zhTag: "连载小说",
    enTag: "Serial Fiction",
    zhTitle: "《维港之上》：用故事写尽现实没有说完的部分。",
    enTitle: "Above Victoria Harbour: the truths reality leaves unfinished, told through fiction.",
    zhBody: "关于关系、信任、家庭与财富选择的叙事入口；归入凤启洞察，不进入服务导航。",
    enBody: "A narrative lens on relationships, trust, family and wealth choices—part of Insights, never the service navigation.",
  },
  {
    zhTag: "AI 与家庭成长",
    enTag: "AI & Family Growth",
    zhTitle: "AI 可以提高效率，但方向仍需要人的判断。",
    enTitle: "AI can improve efficiency; direction still needs human judgement.",
    zhBody: "记录 Phoenix Nova™ 如何把知识、数据与顾问温度连接成长期系统。",
    enBody: "How Phoenix Nova™ connects knowledge, data and human care into a system built for continuity.",
  },
] as const;

function pick(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

function hrefFor(locale: Locale, page: PageId) {
  return page === "home" ? `/${locale}` : `/${locale}/${page}`;
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function SectionIntro({
  index,
  eyebrow,
  title,
  body,
  inverse = false,
}: {
  index: string;
  eyebrow: string;
  title: string;
  body?: string;
  inverse?: boolean;
}) {
  return (
    <header className={`section-intro ${inverse ? "section-intro--inverse" : ""}`}>
      <div className="section-intro__meta"><span>{index}</span><i /><span>{eyebrow}</span></div>
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
    </header>
  );
}

function SiteHeader({ locale, page, inverse = false }: { locale: Locale; page: PageId; inverse?: boolean }) {
  const otherLocale: Locale = locale === "zh" ? "en" : "zh";
  return (
    <header className={`site-header ${inverse ? "site-header--inverse" : ""}`}>
      <div className="site-header__inner shell">
        <BrandMark
          compact
          inverse={inverse}
          href={`/${locale}`}
        />
        <nav className="desktop-nav" aria-label={pick(locale, "主导航", "Primary navigation")}>
          {primaryNavigation.map((item) => item.kind === "internal" ? (
            <Link className={page === item.page ? "is-active" : ""} href={hrefFor(locale, item.page)} key={item.page}>
              {routeLabels[item.page][locale === "zh" ? 0 : 1]}
            </Link>
          ) : (
            <a href={digitalWorldUrl} key={item.id} rel="noreferrer" target="_blank">
              {pick(locale, "数字凤启", "Digital World")}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <Link className="locale-switch" href={hrefFor(otherLocale, page)} aria-label={pick(locale, "EN，切换至英文", "中文，switch to Chinese")}>
            {locale === "zh" ? "EN" : "中文"}
          </Link>
          <Link className="portal-link" href={hrefFor(locale, "family-center")}>
            {routeLabels["family-center"][locale === "zh" ? 0 : 1]} <Arrow />
          </Link>
          <details className="mobile-menu">
            <summary aria-label={pick(locale, "打开导航", "Open navigation")}><span /><span /></summary>
            <nav aria-label={pick(locale, "移动端导航", "Mobile navigation")}>
              {primaryNavigation.map((item, index) => item.kind === "internal" ? (
                <Link href={hrefFor(locale, item.page)} key={item.page}>
                  <span>{String(index + 1).padStart(2, "0")}</span>{routeLabels[item.page][locale === "zh" ? 0 : 1]}
                </Link>
              ) : (
                <a href={digitalWorldUrl} key={item.id} rel="noreferrer" target="_blank">
                  <span>{String(index + 1).padStart(2, "0")}</span>{pick(locale, "数字凤启", "Digital World")} <Arrow />
                </a>
              ))}
              <Link href={hrefFor(locale, "family-center")}>
                <span>09</span>{routeLabels["family-center"][locale === "zh" ? 0 : 1]}
              </Link>
              <Link className="mobile-locale" href={hrefFor(otherLocale, page)}>{locale === "zh" ? "English" : "中文"}</Link>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function SiteFooter({ locale }: { locale: Locale }) {
  return (
    <footer className="site-footer">
      <div className="shell site-footer__top">
        <div className="site-footer__brand">
          <BrandMark inverse href={`/${locale}`} />
          <p>For Every Beginning.</p>
          <span>{pick(locale, "每一次启程，都值得更好的未来。", "Every beginning deserves a better future.")}</span>
        </div>
        <nav aria-label={pick(locale, "页脚导航", "Footer navigation")}>
          {primaryNavigation.slice(1).map((item) => item.kind === "internal"
            ? <Link href={hrefFor(locale, item.page)} key={item.page}>{routeLabels[item.page][locale === "zh" ? 0 : 1]}</Link>
            : <a href={digitalWorldUrl} key={item.id} rel="noreferrer" target="_blank">{pick(locale, "数字凤启", "Digital World")} <Arrow /></a>)}
        </nav>
        <div className="site-footer__company">
          <small>{pick(locale, "公司主体", "Company")}</small>
          <strong>{pick(locale, "凤启环球信息科技（深圳）有限公司", "Phoenix Nova™")}</strong>
          <p>{pick(locale, "公开信息仅用于方向理解，不构成录取、身份、医疗、法律或收益保证。", "Public information supports understanding only and is not a guarantee of admission, immigration, medical, legal or financial outcomes.")}</p>
        </div>
      </div>
      <div className="shell site-footer__bottom"><span>© 2026 Phoenix Nova™</span><span>Phoenix Nova website V5 · Private Review</span></div>
    </footer>
  );
}

function HomePage({ locale }: { locale: Locale }) {
  const heroPortals = [
    ["01", "找到方向", "Find direction", "Phoenix Compass™", "compass"],
    ["02", "形成蓝图", "Shape a blueprint", "Growth Lighthouse", "lighthouse"],
    ["03", "协同支持", "Coordinate support", "Professional Services", "services"],
    ["04", "长期同行", "Grow with continuity", "Phoenix Family OS™", "family-center"],
  ] as const;
  const journey = [
    ["01", "看见当下", "See the present", "Phoenix Compass™", "compass"],
    ["02", "理解选择", "Understand choices", "Growth Insight", "insights"],
    ["03", "形成蓝图", "Shape the blueprint", "Growth Blueprint", "lighthouse"],
    ["04", "长期同行", "Grow with continuity", "Phoenix Family OS™", "family-center"],
  ] as const;

  return (
    <>
      <section className="gateway-hero">
        <SiteHeader locale={locale} page="home" inverse />
        <div className="gateway-hero__main shell">
          <div className="gateway-hero__identity">
            <p className="candidate-tag">V5 CANDIDATE · PRIVATE REVIEW</p>
            <p className="eyebrow">Phoenix Nova™ · Global Family Growth Platform</p>
            <h1>{pick(locale, "一个入口，\n走进凤启世界。", "One gateway.\nEvery Phoenix Nova world.")}</h1>
            <p className="gateway-hero__lead">{pick(locale,
              "Phoenix Nova™ 把家庭成长罗盘、行动蓝图、专业服务、家庭中心与品牌内容汇聚在同一个门户，让每一次启程都有清晰入口。",
              "Phoenix Nova™ brings the family compass, action blueprint, professional support, Family Center and brand worlds into one clear portal for every beginning."
            )}</p>
            <div className="gateway-hero__actions">
              <a className="button button--gold" href="#portal-directory">{pick(locale, "浏览凤启门户", "Explore the portal")} <Arrow /></a>
              <Link className="text-action" href={hrefFor(locale, "about")}>{pick(locale, "认识 Phoenix Nova", "Meet Phoenix Nova")} <Arrow /></Link>
            </div>
          </div>
          <div className="gateway-hero__visual" role="img" aria-label={pick(locale, "Phoenix Nova 官方凤凰罗盘", "Phoenix Nova official phoenix compass")}>
            <span className="gateway-hero__coordinate gateway-hero__coordinate--top">22.3193° N · 114.1694° E</span>
            <PatternMedallion variant="master" size="hero" />
            <div className="gateway-hero__mark"><Image src="/brand/phoenix-nova-mark-official.png" alt="" width={145} height={145} priority unoptimized /></div>
            <span className="gateway-hero__coordinate gateway-hero__coordinate--bottom">DIRECTION · GROWTH · CONTINUITY</span>
          </div>
        </div>
        <div className="gateway-hero__dock-frame">
          <nav className="gateway-hero__dock shell" aria-label={pick(locale, "首页快捷入口", "Homepage quick links")}>
            {heroPortals.map(([no, zh, en, product, destination]) => (
              <Link href={hrefFor(locale, destination)} key={no}>
                <span>{no}</span>
                <div><strong>{pick(locale, zh, en)}</strong><small>{product}</small></div>
                <Arrow />
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <section className="portal-directory" id="portal-directory">
        <div className="shell portal-directory__heading">
          <SectionIntro
            index="01"
            eyebrow="Phoenix Nova Portal"
            title={pick(locale, "从这里，进入每一个凤启世界。", "Enter every Phoenix Nova world from here.")}
            body={pick(locale, "按家庭当下的问题、长期成长阶段或内容兴趣，选择最接近你的入口。", "Choose the doorway closest to your family's question, growth stage or curiosity.")}
          />
          <Link className="portal-directory__about" href={hrefFor(locale, "about")}>
            <span>{pick(locale, "了解平台全貌", "See the whole platform")}</span><Arrow />
          </Link>
        </div>

        <div className="shell portal-directory__grid">
          <Link className="portal-tile portal-tile--compass" href={hrefFor(locale, "compass")}>
            <Image src="/images/phoenix-compass-hero.webp" alt="" fill sizes="(max-width: 980px) 100vw, 58vw" unoptimized />
            <span className="portal-tile__shade" />
            <span className="portal-tile__number">01 / DIRECTION</span>
            <div className="portal-tile__content">
              <small>Phoenix Compass™</small>
              <h2>{pick(locale, "凤启罗盘", "Phoenix Compass")}</h2>
              <p>{pick(locale, "看见孩子、教育与家庭的当下位置，找到下一步方向。", "See the family's present clearly and find the next direction that matters.")}</p>
              <strong>{pick(locale, "进入罗盘", "Enter Compass")} <Arrow /></strong>
            </div>
          </Link>

          <Link className="portal-tile portal-tile--lighthouse portal-tile--light" href={hrefFor(locale, "lighthouse")}>
            <span className="portal-tile__number">02 / BLUEPRINT</span>
            <div className="portal-tile__content">
              <small>Growth Blueprint</small>
              <h2>{pick(locale, "成长灯塔", "Growth Lighthouse")}</h2>
              <p>{pick(locale, "把判断整理成能讨论、能排序、能行动的成长蓝图。", "Turn insight into a blueprint a family can discuss, sequence and act on.")}</p>
              <strong>{pick(locale, "查看蓝图路径", "Explore the blueprint")} <Arrow /></strong>
            </div>
          </Link>

          <Link className="portal-tile portal-tile--family portal-tile--navy" href={hrefFor(locale, "family-center")}>
            <span className="portal-tile__number">03 / CONTINUITY</span>
            <div className="portal-tile__content">
              <small>Phoenix Family OS™</small>
              <h2>{pick(locale, "家庭中心", "Family Center")}</h2>
              <p>{pick(locale, "让档案、评估与关键节点留在同一份长期成长记录里。", "Keep profiles, assessments and milestones in one living record of growth.")}</p>
              <strong>{pick(locale, "预览家庭中心", "Preview Family Center")} <Arrow /></strong>
            </div>
          </Link>

          <Link className="portal-tile portal-tile--services portal-tile--light" href={hrefFor(locale, "services")}>
            <span className="portal-tile__number">04 / EXPERTISE</span>
            <div className="portal-tile__content">
              <small>Professional Services</small>
              <h2>{pick(locale, "专业服务", "Professional Services")}</h2>
              <p>{pick(locale, "六段家庭旅程，由五种专业能力协同支持。", "Six family journeys supported by five connected capabilities.")}</p>
              <strong>{pick(locale, "查看服务旅程", "View the journeys")} <Arrow /></strong>
            </div>
          </Link>

          <Link className="portal-tile portal-tile--insights portal-tile--ink" href={hrefFor(locale, "insights")}>
            <span className="portal-tile__number">05 / EDITORIAL</span>
            <div className="portal-tile__content">
              <small>Phoenix Insights</small>
              <h2>{pick(locale, "凤启洞察", "Phoenix Insights")}</h2>
              <p>{pick(locale, "阅读家庭、香港、AI 与《维港之上》。", "Read perspectives on family, Hong Kong, AI and Above Victoria Harbour.")}</p>
              <strong>{pick(locale, "进入洞察", "Enter Insights")} <Arrow /></strong>
            </div>
          </Link>

          <Link className="portal-tile portal-tile--oriental portal-tile--sand" href={hrefFor(locale, "oriental")}>
            <span className="portal-tile__number">06 / CULTURE</span>
            <div className="portal-tile__content">
              <small>Phoenix Oriental</small>
              <h2>{pick(locale, "凤启东方", "Phoenix Oriental")}</h2>
              <p>{pick(locale, "走入相对独立的东方文化衍生世界。", "Step into a distinct world of contemporary Eastern culture.")}</p>
              <strong>{pick(locale, "走近东方", "Approach the East")} <Arrow /></strong>
            </div>
          </Link>

          <a className="portal-tile portal-tile--digital" href={digitalWorldUrl} rel="noreferrer" target="_blank">
            <Image
              src="/images/fengqi-digital-immortals.webp"
              alt={pick(locale, "数字凤启仙兽图：鹤潼引路、凤凰执中、九大仙灵共栖山海", "Phoenix Nova Digital World: the guide, phoenix and nine immortal guardians")}
              fill
              sizes="100vw"
              unoptimized
            />
            <span className="portal-tile__shade" />
            <span className="portal-tile__number">07 / PHOENIX NOVA DIGITAL WORLD</span>
            <div className="portal-tile__content">
              <small>{pick(locale, "仙兽图 · 东方启境", "Immortal Guardians · Eastern Realm")}</small>
              <h2>{pick(locale, "数字凤启", "Digital World")}</h2>
              <p>{pick(locale, "鹤潼引路，凤凰执中，九大仙灵各守其境。", "The guide leads, the phoenix holds the centre, and nine immortal guardians keep their realms.")}</p>
              <strong>{pick(locale, "进入仙兽图", "Enter the digital world")} <Arrow /></strong>
            </div>
          </a>
        </div>
      </section>

      <section className="system-map-section">
        <div className="shell system-map__heading">
          <SectionIntro
            index="02"
            eyebrow="One connected journey"
            inverse
            title={pick(locale, "门户各有入口，\n家庭成长始终沿着一条主线。", "Many doorways.\nOne connected family journey.")}
            body={pick(locale, "从看见当下到形成蓝图，再把重要结果带入家庭中心持续更新。", "See the present, shape a blueprint, then carry what matters into the Family Center for continuity.")}
          />
        </div>
        <ol className="shell system-map__rail">
          {journey.map(([number, zh, en, product, destination]) => (
            <li key={number}>
              <Link href={hrefFor(locale, destination)}>
                <span>{number}</span>
                <div><h3>{pick(locale, zh, en)}</h3><p>{product}</p></div>
                <Arrow />
              </Link>
            </li>
          ))}
        </ol>
        <div className="shell system-map__lower">
          <div className="system-map__journeys">
            <span>Six family journeys</span>
            <div>{journeyData.map((item) => <Link href={hrefFor(locale, "services")} key={item.no}><small>{item.no}</small>{pick(locale, item.zh, item.en)}</Link>)}</div>
          </div>
          <div className="system-map__continuity">
            <p>{pick(locale, "需要时进入专业支持，重要结果持续回到家庭中心。", "Professional support when needed; lasting outcomes return to the Family Center.")}</p>
            <Link className="button button--gold" href={hrefFor(locale, "family-center")}>{pick(locale, "查看家庭中心", "View Family Center")} <Arrow /></Link>
          </div>
        </div>
      </section>

      <section className="final-section">
        <div className="final-section__orbit" aria-hidden="true"><PatternMedallion variant="master" size="hero" /></div>
        <div className="shell final-section__content">
          <p>For Every Beginning.</p>
          <h2>{pick(locale, "选择最接近当下的入口，\n开始下一段旅程。", "Choose the doorway closest to now.\nBegin the next journey.")}</h2>
          <div className="final-section__actions">
            <Link className="button button--gold" href={hrefFor(locale, "compass")}>{pick(locale, "开始 Phoenix Compass™", "Begin Phoenix Compass™")} <Arrow /></Link>
            <a className="text-action" href={digitalWorldUrl} rel="noreferrer" target="_blank">{pick(locale, "进入数字凤启", "Enter Digital World")} <Arrow /></a>
          </div>
        </div>
      </section>
    </>
  );
}

function PageHero({ locale, page, eyebrow, title, lead, image }: { locale: Locale; page: PageId; eyebrow: string; title: string; lead: string; image?: "compass" | "oriental" }) {
  const inverse = image === "oriental";
  return (
    <section className={`page-hero ${inverse ? "page-hero--inverse" : ""} ${image ? `page-hero--${image}` : ""}`}>
      <SiteHeader locale={locale} page={page} inverse={inverse} />
      {image ? <div className="page-hero__image" aria-hidden="true"><Image src={image === "compass" ? "/images/phoenix-compass-hero.webp" : "/images/phoenix-departure-hero.png"} alt="" fill sizes="100vw" priority unoptimized /></div> : null}
      <div className="shell page-hero__content">
        <p className="candidate-tag">V5 CANDIDATE</p>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
    </section>
  );
}

function CompassPage({ locale }: { locale: Locale }) {
  const compasses = [
    ["01", "Child Compass™", "孩子成长罗盘", "从孩子的兴趣、状态与成长信号开始。", "Begin with the child's interests, current state and growth signals."],
    ["02", "Education Compass™", "教育成长罗盘", "把课程体系、学习表现与升学目标放在同一条路径上。", "Bring curricula, learning performance and admissions goals onto one pathway."],
    ["03", "Family Compass™", "家庭成长罗盘", "看见家庭整体目标、关键节点与需要协同的选择。", "See the family's shared goals, milestones and choices that need coordination."],
  ] as const;
  return (
    <>
      <PageHero locale={locale} page="compass" eyebrow="Phoenix Compass™" image="compass" title={pick(locale, "先理解家庭，\n再判断方向。", "Understand the family.\nThen find direction.")} lead={pick(locale, "不是一次性答案，而是把问题放进真实家庭情境中重新看清。", "Not a one-off answer, but a clearer view of the question inside the family's real context.")} />
      <section className="editorial-section">
        <div className="shell editorial-heading"><SectionIntro index="01" eyebrow="Three entry points" title={pick(locale, "从最接近此刻的问题开始。", "Start with the question closest to this moment.")} /></div>
        <div className="shell compass-list">
          {compasses.map((item, index) => (
            <article id={`compass-${index + 1}`} key={item[0]}>
              <div className="compass-list__visual"><PatternMedallion variant={index === 1 ? "education" : "master"} size="card" /></div>
              <span>{item[0]}</span><div><small>{item[1]}</small><h2>{pick(locale, item[2], item[1])}</h2><p>{pick(locale, item[3], item[4])}</p></div>
              <em>{pick(locale, "候选体验 · 正式入口待产品 Gate", "Candidate experience · Live entry follows product gate")}</em>
            </article>
          ))}
        </div>
      </section>
      <section className="quiet-cta"><div className="shell"><p>Knowledge First.</p><h2>{pick(locale, "先得到一张清晰的成长快照。", "Begin with a clear growth snapshot.")}</h2><Link className="button button--navy" href={hrefFor(locale, "lighthouse")}>{pick(locale, "继续了解成长蓝图", "Continue to the Growth Blueprint")} <Arrow /></Link></div></section>
    </>
  );
}

function LighthousePage({ locale }: { locale: Locale }) {
  const steps = [
    ["01", "Growth Snapshot", "看见优势、约束与当前方向", "See strengths, constraints and the current direction"],
    ["02", "Pathway Fit", "理解路径与家庭条件是否匹配", "Understand whether a pathway fits the family's conditions"],
    ["03", "Action Blueprint", "把判断转化为有先后顺序的行动", "Turn judgement into sequenced action"],
    ["04", "Family Continuity", "把结果带入 Family OS 持续更新", "Carry the result into Family OS for continued updates"],
  ] as const;
  return (
    <>
      <PageHero locale={locale} page="lighthouse" eyebrow="Growth Blueprint" title={pick(locale, "方向被看见以后，\n下一步必须能够行动。", "Once direction is visible,\nthe next step must become actionable.")} lead={pick(locale, "成长灯塔承接 Compass 的判断，把分散信息整理成家庭可以理解、讨论与执行的行动蓝图。", "The Growth Lighthouse carries Compass insight forward, turning scattered information into a blueprint a family can understand, discuss and act on.")} />
      <section className="blueprint-section"><div className="shell blueprint-layout">
        <div className="blueprint-copy"><SectionIntro index="01" eyebrow="From insight to action" title={pick(locale, "一份报告的价值，\n在于改变下一步。", "A report matters only when it changes the next step.")} body={pick(locale, "V5 用“灯塔”表达方向与行动之间的连接，不新增产品线；正式产品仍是 Growth Blueprint。", "V5 uses the lighthouse as the narrative bridge between direction and action. It does not create a new product; the product remains Growth Blueprint.")} /></div>
        <ol className="blueprint-steps">{steps.map(([no,en,zhBody,enBody]) => <li key={no}><span>{no}</span><div><strong>{en}</strong><p>{pick(locale, zhBody, enBody)}</p></div></li>)}</ol>
      </div></section>
      <section className="dark-cta"><div className="shell"><p>Phoenix Family OS™</p><h2>{pick(locale, "蓝图不是终点，而是长期成长的第一版。", "The blueprint is not the end. It is the first version of a family's long-term growth map.")}</h2><Link className="button button--gold" href={hrefFor(locale, "family-center")}>{pick(locale, "进入家庭中心预览", "Preview the Family Center")} <Arrow /></Link></div></section>
    </>
  );
}

function ServicesPage({ locale }: { locale: Locale }) {
  return (
    <>
      <PageHero locale={locale} page="services" eyebrow="Professional Services" title={pick(locale, "从家庭旅程出发，\n让专业能力协同工作。", "Start with the family journey.\nLet expertise work together.")} lead={pick(locale, "V5 将“旅程”与“能力”分开表达：前台看见家庭正在经历什么，后台由教育、身份、财富、健康与全球生活能力共同支持。", "V5 separates journeys from capabilities: families see what they are living through, while Education, Identity, Wealth, Health and Global Living work together behind the experience.")} />
      <section className="services-section"><div className="shell services-list">
        {journeyData.map((item) => <article key={item.no}><span>{item.no}</span><div><small>{item.en}</small><h2>{pick(locale, item.zh, item.en)}</h2><p>{pick(locale, item.zhDescription, item.enDescription)}</p></div><em>{pick(locale, item.zhDetail, item.enDetail)}</em></article>)}
      </div></section>
      <section className="capabilities-section"><div className="shell capabilities-layout"><SectionIntro index="02" eyebrow="Shared capabilities" title={pick(locale, "五种能力，支持六段旅程。", "Five capabilities supporting six journeys.")} /><div>{["Education", "Identity", "Wealth", "Health", "Global Living"].map((item,index)=><span key={item}><b>0{index+1}</b>{item}</span>)}</div></div></section>
    </>
  );
}

function InsightsPage({ locale }: { locale: Locale }) {
  return (
    <>
      <PageHero locale={locale} page="insights" eyebrow="Phoenix Insights" title={pick(locale, "在行动之前，\n先把世界看清一点。", "Before acting,\nsee the world a little more clearly.")} lead={pick(locale, "凤启洞察以故事、真实问题与专业判断，连接家庭正在面对的变化。", "Phoenix Insights connects change to family life through stories, real questions and professional judgement.")} />
      <section className="insights-section"><div className="shell insight-grid">{insightData.map((item,index)=><article className={index===2?"is-featured":""} key={item.zhTag}><span>0{index+1} / {pick(locale,item.zhTag,item.enTag)}</span><h2>{pick(locale,item.zhTitle,item.enTitle)}</h2><p>{pick(locale,item.zhBody,item.enBody)}</p><em>{pick(locale,"内容栏目 · 候选占位","Editorial stream · Candidate placeholder")}</em></article>)}</div></section>
      <section className="editorial-note"><div className="shell"><strong>{pick(locale, "《维港之上》的位置已确定", "Above Victoria Harbour now has a defined place")}</strong><p>{pick(locale, "它属于“凤启洞察”的连载内容，不进入首页主产品链，也不直接变成财富服务广告；在相关章节后，以自然的知识延伸连接专业洞察。", "It belongs to the Insights editorial world—not the homepage product path and not a direct wealth-services advertisement. Relevant chapters can lead naturally into deeper professional insight.")}</p></div></section>
    </>
  );
}

function OrientalPage({ locale }: { locale: Locale }) {
  const collections = [["01","初羽","Beginning Feather"],["02","凤起","Phoenix Rising"],["03","山海","Mountains & Seas"],["04","锦羽","Brocade Feather"]] as const;
  return (
    <>
      <PageHero locale={locale} page="oriental" eyebrow="Phoenix Oriental" image="oriental" title={pick(locale, "东方，不只被看见。\n也可以被佩戴、触摸与珍藏。", "The East is not only seen.\nIt can be worn, touched and treasured.")} lead={pick(locale, "凤启东方是相对独立的文化衍生世界。它与 Phoenix Nova™ 相连，但不与教育、身份或家庭服务混写。", "Phoenix Oriental is a distinct world of contemporary cultural objects. It connects to Phoenix Nova™, but never mixes with education, identity or family services.")} />
      <section className="oriental-section"><div className="shell oriental-layout"><SectionIntro index="01" eyebrow="Contemporary Eastern objects" title={pick(locale, "把传统的精神，\n转译成今天愿意使用的作品。", "Translate enduring spirit\ninto objects people choose today.")} body={pick(locale, "本页只建立主站入口与世界观。完整作品、预约与非遗叙事，将在独立凤启东方网站展开。", "This page establishes only the main-site doorway and worldview. The complete collections, reservations and heritage narratives belong on the independent Phoenix Oriental site.")} /><div className="collection-index">{collections.map(([no,zh,en])=><div key={no}><span>{no}</span><h3>{pick(locale,zh,en)}</h3><p>{pick(locale,en,zh)}</p></div>)}</div></div></section>
    </>
  );
}

function AboutPage({ locale }: { locale: Locale }) {
  return (
    <>
      <PageHero locale={locale} page="about" eyebrow="About Phoenix Nova™" title={pick(locale, "一个以家庭成长为核心的\n长期平台。", "A long-term platform\nbuilt around family growth.")} lead={pick(locale, "Phoenix Nova™ 不是单一申请机构、身份服务商或销售平台，而是连接方向判断、专业支持与长期数字系统的家庭成长平台。", "Phoenix Nova™ is not a single-purpose admissions agency, identity provider or sales platform. It connects direction, professional support and a long-term digital system around family growth.")} />
      <section className="brand-proof"><div className="shell brand-proof__layout"><div><Image src="/brand/phoenix-nova-logo-official.png" alt="Phoenix Nova 鳳啟 Official Logo" width={470} height={320} unoptimized /></div><p><span>OFFICIAL LOGO SYSTEM V1.0</span>{pick(locale,"凤凰羽翼象征启程、成长与连接。V5 只使用已确认的正式标志，不重新绘制或生成近似图形。","The phoenix wing represents beginnings, growth and connection. V5 uses only the approved official mark, with no redraw or generated approximation.")}</p></div></section>
      <section className="principles-section"><div className="shell"><SectionIntro index="01" eyebrow="How we work" title={pick(locale, "长期主义，需要一套不同的工作原则。", "Long-term thinking requires a different set of principles.")} /><div className="principles-grid"><article><span>01</span><h3>Knowledge First.</h3><p>{pick(locale,"先理解，再行动。","Understand before acting.")}</p></article><article><span>02</span><h3>AI for efficiency.</h3><p>{pick(locale,"让科技处理复杂，让人保留温度。","Let technology handle complexity while people preserve care.")}</p></article><article><span>03</span><h3>Continuity by design.</h3><p>{pick(locale,"每一次服务，都应成为家庭长期成长的一部分。","Every service should become part of a family's long-term growth.")}</p></article></div></div></section>
      <section className="about-statement"><div className="shell"><p>{pick(locale,"植根东方，连接世界。","Rooted in the East, connected to the world.")}</p><h2>For Every Beginning.</h2><span>{pick(locale,"每一次启程，都值得更好的未来。","Every beginning deserves a better future.")}</span></div></section>
    </>
  );
}

function FamilyCenterPage({ locale }: { locale: Locale }) {
  return (
    <>
      <PageHero locale={locale} page="family-center" eyebrow="Phoenix Family OS™" title={pick(locale, "一次建立家庭档案，\n长期陪伴家庭成长。", "Build the family profile once.\nKeep growing with continuity.")} lead={pick(locale, "V5 Candidate 展示家庭中心的产品关系与视觉方向；正式账户、数据与入口将在产品 Gate 后接驳。", "The V5 Candidate shows the Family Center's product relationship and visual direction. Live accounts, data and entry points follow the product gate.")} />
      <section className="family-center-section"><div className="shell family-center-layout"><FamilyDashboardPreview full locale={locale} compassHref={hrefFor(locale,"compass")} /><div className="family-center-copy"><SectionIntro index="01" eyebrow="MVP focus" title={pick(locale,"一个家庭，\n一份持续更新的成长记录。","One family.\nOne living record of growth.")} /><ul><li>{pick(locale,"家庭档案","Family profile")}</li><li>{pick(locale,"孩子档案","Child profiles")}</li><li>{pick(locale,"Compass 评估结果","Compass assessment results")}</li><li>{pick(locale,"家庭时间线","Family timeline")}</li></ul></div></div></section>
    </>
  );
}

export function V5Site({ locale, page }: { locale: Locale; page: PageId }) {
  const content = page === "home" ? <HomePage locale={locale} />
    : page === "compass" ? <CompassPage locale={locale} />
    : page === "lighthouse" ? <LighthousePage locale={locale} />
    : page === "services" ? <ServicesPage locale={locale} />
    : page === "insights" ? <InsightsPage locale={locale} />
    : page === "oriental" ? <OrientalPage locale={locale} />
    : page === "about" ? <AboutPage locale={locale} />
    : <FamilyCenterPage locale={locale} />;

  return <main lang={locale === "zh" ? "zh-Hans" : "en"}>{content}<SiteFooter locale={locale} /></main>;
}
