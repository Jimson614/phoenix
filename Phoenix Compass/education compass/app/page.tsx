import { BrandLogo } from "@/components/brand-logo";
import { LandingAnalytics } from "@/components/landing-analytics";
import { StartLink } from "@/components/start-link";

const snapshotItems = [
  { number: "01", title: "成长类型", copy: "一个方向性摘要，不是性格标签" },
  { number: "02", title: "优势信号", copy: "每条结论都能回到你的回答" },
  { number: "03", title: "探索方向", copy: "2–3个值得尝试的真实方向" },
  { number: "04", title: "今天可做", copy: "一个7天内可完成的家庭行动" },
] as const;

export default function LandingPage() {
  return (
    <>
      <LandingAnalytics />
      <main id="main-content">
        <section className="landing-hero">
          <div className="hero-glow hero-glow--one" />
          <div className="hero-glow hero-glow--two" />
          <header className="landing-header page-shell">
            <BrandLogo priority variant="light" />
            <span className="header-note">Phoenix Compass™ · Free</span>
          </header>

          <div className="hero-layout page-shell">
            <div className="hero-copy">
              <p className="eyebrow eyebrow--light">AI GROWTH SNAPSHOT · FREE</p>
              <h1>发现孩子未来可能性</h1>
              <p className="hero-lede">
                用30秒回答7个问题，获得一份 AI 成长快照。它不会给孩子贴标签，
                而是帮助家庭找到下一步值得探索的方向。
              </p>
              <StartLink placement="hero" />
              <ul className="trust-row" role="list">
                <li>无需登录</li>
                <li>不填写姓名与联系方式</li>
                <li>结果仅用于成长探索</li>
              </ul>
            </div>

            <div aria-label="Growth Snapshot 内容预览" className="snapshot-preview">
              <div className="preview-orbit" aria-hidden="true">
                <span>C</span>
              </div>
              <p className="preview-kicker">YOUR GROWTH SNAPSHOT</p>
              <h2>先看见信号，<br />再决定方向。</h2>
              <div className="preview-list">
                {snapshotItems.slice(0, 3).map((item) => (
                  <div className="preview-row" key={item.number}>
                    <span>{item.number}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.copy}</small>
                    </div>
                  </div>
                ))}
              </div>
              <p className="preview-footnote">约30秒 · 7个轻量问题 · 1份个性化结果</p>
            </div>
          </div>
        </section>

        <section className="value-section page-shell">
          <div className="section-heading">
            <p className="eyebrow">WHAT YOU GET</p>
            <h2>一份看得懂、能行动的成长快照</h2>
            <p>不是把孩子归类，而是把有限线索整理成一个更清楚的家庭观察起点。</p>
          </div>
          <div className="value-grid">
            {snapshotItems.map((item) => (
              <article className="value-card" key={item.number}>
                <span>{item.number}</span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="how-section">
          <div className="page-shell how-layout">
            <div className="section-heading section-heading--left">
              <p className="eyebrow">HOW IT WORKS</p>
              <h2>三个步骤，约30秒完成</h2>
              <p>选择题为主，答案仅用于生成本次结果，不写入 Phoenix 长期档案；没有倒计时，也不制造压力。</p>
            </div>
            <ol className="steps-list">
              <li><span>01</span><div><strong>回答7题</strong><p>阶段、环境、兴趣与家庭目标</p></div></li>
              <li><span>02</span><div><strong>AI 整理</strong><p>只依据输入生成可追溯的成长信号</p></div></li>
              <li><span>03</span><div><strong>获得快照</strong><p>方向、行动与值得继续观察的问题</p></div></li>
            </ol>
          </div>
        </section>

        <section className="boundary-section page-shell">
          <div className="boundary-card">
            <p className="eyebrow">A CLEAR BOUNDARY</p>
            <h2>探索，不是诊断。</h2>
            <p>
              Growth Snapshot 不构成心理测评、医疗或职业诊断，也不预测录取、学校或人生结果。
              地区、身份与课程只用于理解教育情境，不用于判断能力和潜力高低。
            </p>
          </div>
        </section>

        <section className="final-cta-section">
          <div className="page-shell final-cta-inner">
            <div>
              <p className="eyebrow eyebrow--light">FOR EVERY BEGINNING.</p>
              <h2>每一次启程，都值得一个更清楚的起点。</h2>
            </div>
            <StartLink placement="final" />
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="page-shell">
          <span>Phoenix Nova™</span>
          <span>Knowledge First. · For Every Beginning.</span>
        </div>
      </footer>
    </>
  );
}
