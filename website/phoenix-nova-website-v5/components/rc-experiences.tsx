"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { FrontendLink } from "./rc-frontend-link";
import * as family from "../lib/rc/family/repository.cjs";
import * as masters from "../lib/rc/application/masters-intake.cjs";

type FamilyView = {
  family: { id: string; user_id: string; family_name: string; parent_name: string; phone: string; location: string; goal: string };
  students: { id: string; name: string; education_system: string; goal: string }[];
  events: { id: string; description: string; date: string }[];
};
function seedFamily() {
  family.initialize();
  if (!family.getById("users", "rc_demo_adult")) family.insert("users", { id: "rc_demo_adult", name: "演示家长", role: "family_user" });
  let item = family.familyForUser("rc_demo_adult");
  if (!item) {
    item = family.upsertFamily("rc_demo_adult", { family_name: "启程家庭 · 演示", parent_name: "演示家长", phone: "", location: "香港", goal: "理解孩子的成长方向" });
    family.upsertStudent(item.id, { name: "演示学生 A", age: 15, education_system: "国际课程", goal: "探索学习兴趣" });
  }
  return family.familyOverview(item.id) as FamilyView;
}
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
export function FamilyExperience() {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return mounted ? <FamilyDemo /> : <section className="rc-experience shell"><p role="status">正在准备家庭演示…</p></section>;
}
function FamilyDemo() {
  const [view, setView] = useState<FamilyView>(seedFamily);
  const [tab, setTab] = useState("overview");
  const [notice, setNotice] = useState("");
  const refresh = () => setView(family.familyOverview(view.family.id) as FamilyView);
  return <section className="rc-experience shell" aria-labelledby="family-demo-title">
    <div className="rc-heading"><div><span className="rc-kicker">FAMILY OS · INTERACTIVE DEMO</span><h2 id="family-demo-title">让成长记录连接起来</h2></div><span className="rc-badge">本标签页演示</span></div>
    <p className="rc-muted">使用演示家庭体验成员与时间线；刷新后可在本标签页继续。正式账户、跨设备同步和权限服务尚未接入。</p>
    <div className="rc-tabs" role="group" aria-label="家庭视图">
      {[["overview","家庭概览"],["members","家庭成员"],["timeline","成长时间线"]].map(([id,label]) => <button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}
    </div>
    {tab==="overview" && <div className="rc-grid"><article className="rc-panel"><h3>{view.family.family_name}</h3><p>{view.family.location} · {view.students.length} 位演示学生</p><label htmlFor="family-goal">当前家庭目标</label><select id="family-goal" value={view.family.goal} onChange={e=>{family.upsertFamily(view.family.user_id,{...view.family,goal:e.target.value});family.addTimeline(view.family.id,"rc_goal_updated","家庭目标更新："+e.target.value);refresh();setNotice("演示家庭目标已更新");}}><option>理解孩子的成长方向</option><option>准备下一阶段升学</option><option>整理家庭长期规划</option></select><p className="rc-muted">这些记录属于演示，不能用于真实身份或权限判断。</p></article><article className="rc-panel rc-panel--navy"><span>下一步</span><h3>从成长快照开始</h3><p>复用现有 Education Compass 问卷，看看兴趣如何成为可讨论的方向。</p><FrontendLink className="button button--gold" href="/education/assessment">开始成长探索 ↗</FrontendLink><Link className="rc-text-link" href="/zh/application">查看升学资料体验 →</Link></article></div>}
    {tab==="members" && <div><div className="rc-grid">{view.students.map(student=><article className="rc-panel" key={student.id}><span className="rc-avatar">{student.name.slice(-1)}</span><h3>{student.name}</h3><p>{student.education_system}</p><p>{student.goal}</p></article>)}</div><button className="button button--navy" type="button" disabled={view.students.length>=5} onClick={()=>{family.upsertStudent(view.family.id,{name:"演示学生 "+String.fromCharCode(65+view.students.length),age:16,education_system:"待选择",goal:"探索下一步"});refresh();setNotice("已添加演示成员，并写入成长时间线");}}>添加演示成员</button></div>}
    {tab==="timeline" && <ol className="rc-timeline">{view.events.map(event=><li key={event.id}><time>{new Date(event.date).toLocaleDateString("zh-CN")}</time><strong>{event.description}</strong></li>)}</ol>}
    <p role="status" aria-live="polite">{notice}</p><button type="button" className="rc-reset" onClick={()=>{family.resetDemoData();setView(seedFamily());setNotice("已重新开始本标签页演示");}}>重新开始家庭演示</button>
  </section>;
}

type Profile = ReturnType<typeof masters.normalizeProfile>;
type DemoDocument = { id: string; type: string; name: string; size: number; uploadStatus: string; parseStatus: string };
const APPLICATION_KEY="phoenix:rc:application:v1";
function readApplication() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(APPLICATION_KEY) || "null");
    if (saved && typeof saved === "object") return {
      profile: masters.normalizeProfile(saved.profile),
      documents: (Array.isArray(saved.documents) ? saved.documents : []).filter((doc: DemoDocument) => doc && typeof doc.id === "string" && doc.id.startsWith("rc_demo_") && typeof doc.type === "string" && typeof doc.name === "string") as DemoDocument[],
      step: [0,1,2].includes(saved.step) ? saved.step as number : 0,
    };
  } catch { /* Invalid browser drafts restart safely. */ }
  return { profile: masters.normalizeProfile({}), documents: [] as DemoDocument[], step: 0 };
}
export function ApplicationExperience() {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return mounted ? <ApplicationDemo /> : <section className="rc-experience shell"><p role="status">正在准备升学资料演示…</p></section>;
}
function ApplicationDemo() {
  const [saved] = useState(readApplication);
  const [profile,setProfile]=useState<Profile>(saved.profile);
  const [documents,setDocuments]=useState<DemoDocument[]>(saved.documents);
  const [step,setStep]=useState(saved.step);
  const [notice,setNotice]=useState("");
  useEffect(()=>{try{sessionStorage.setItem(APPLICATION_KEY,JSON.stringify({profile,documents,step}));}catch{ /* The demo remains usable without persistence. */ }},[profile,documents,step]);
  const fields=masters.requiredProfileFields(profile);
  const materials=masters.buildMaterialCards(documents,profile.educationStatus,true);
  const draft=masters.resumeDraft(profile);
  const update=(key: keyof Profile,value: string | boolean)=>setProfile({...profile,[key]:value});
  const labels: Record<string,string>={name:"称呼",adultConfirmed:"成年确认",contact:"联系方式",institution:"本科院校",major:"专业",targetYear:"入学年份"};
  const next=()=>{if(step===0&&fields.length){setNotice("请先补充："+fields.map((f: string)=>labels[f]||f).join("、"));return;}setNotice("");setStep(step+1);};
  return <section className="rc-experience shell" aria-labelledby="application-demo-title">
    <div className="rc-heading"><div><span className="rc-kicker">APPLICATION COMPASS · GUIDED INTAKE</span><h2 id="application-demo-title">把已有经历，整理为清晰的下一步</h2></div><span className="rc-badge">演示草稿</span></div>
    <p className="rc-muted">仅在本标签页保留演示草稿。示例材料不读取本机文件；真实上传、顾问提交与申请处理尚未接入。</p>
    <ol className="rc-steps">{["基本资料","材料清单","核对草稿"].map((label,i)=><li key={label} aria-current={step===i?"step":undefined}><span>0{i+1}</span>{label}</li>)}</ol>
    {step===0&&<div className="rc-panel"><button type="button" className="rc-reset" onClick={()=>{setProfile(masters.normalizeProfile({name:"演示申请人",adultConfirmed:true,contact:{type:"email",value:"demo@example.invalid"},educationStatus:"ENROLLED",institution:"演示大学",major:"经济学",degree:"本科",targetYear:"2027"}));setNotice("已填入虚构示例，可继续修改");}}>使用虚构示例</button><div className="rc-form-grid">
      <label>称呼<input value={profile.name} onChange={e=>update("name",e.target.value)}/></label>
      <label>演示联系邮箱<input type="email" value={profile.contact.value} onChange={e=>setProfile({...profile,contact:{type:"email",value:e.target.value}})}/></label>
      <label>本科院校<input value={profile.institution} onChange={e=>update("institution",e.target.value)}/></label>
      <label>专业<input value={profile.major} onChange={e=>update("major",e.target.value)}/></label>
      <label>教育状态<select value={profile.educationStatus} onChange={e=>update("educationStatus",e.target.value)}>{masters.EDUCATION_STATUS_OPTIONS.map((o:{value:string;label:string})=><option value={o.value} key={o.value}>{o.label}</option>)}</select></label>
      <label>计划入学年份<select value={profile.targetYear} onChange={e=>update("targetYear",e.target.value)}>{masters.TARGET_YEAR_OPTIONS.map((o:{value:string;label:string})=><option value={o.value} key={o.value}>{o.label}</option>)}</select></label>
    </div><label className="rc-check"><input type="checkbox" checked={profile.adultConfirmed} onChange={e=>update("adultConfirmed",e.target.checked)}/>演示申请人为成年人</label></div>}
    {step===1&&<div><div className="rc-grid">{materials.cards.filter((card:{visible:boolean})=>card.visible).map((card:{type:string;title:string;description:string;files:DemoDocument[]})=><article className="rc-panel" key={card.type}><h3>{card.title}</h3><p>{card.description}</p>{card.files.length?<><p>示例材料已加入 · 待人工核验</p><button type="button" className="rc-reset" onClick={()=>setDocuments(documents.filter(d=>d.type!==card.type))}>移除示例材料</button></>:<button type="button" className="button button--navy" onClick={()=>setDocuments([...documents,{id:"rc_demo_"+card.type,type:card.type,name:"示例"+card.title+".pdf",size:1024,uploadStatus:"UPLOADED",parseStatus:"MANUAL_REVIEW"}])}>加入示例材料</button>}</article>)}</div><p>材料可后补；没有成绩或证书时，不自动补写。</p></div>}
    {step===2&&<div className="rc-grid"><article className="rc-panel"><h3>{draft.title}</h3><pre className="rc-draft">{draft.text}</pre></article><article className="rc-panel"><h3>下一步，由你确认</h3><p>已加入 {documents.length} 份示例材料。草稿仅整理已输入事实，不代表录取判断或已提交顾问。</p><p role="status">顾问提交待接入；当前没有发送任何资料。</p><Link className="button button--navy" href="/zh/family-center">返回家庭中心</Link></article></div>}
    <p role="status" aria-live="polite">{notice}</p><div className="rc-actions">{step>0&&<button type="button" className="rc-reset" onClick={()=>setStep(step-1)}>← 返回修改</button>}{step<2&&<button className="button button--navy" type="button" onClick={next}>继续 →</button>}<button type="button" className="rc-reset" onClick={()=>{setProfile(masters.emptyProfile());setDocuments([]);setStep(0);setNotice("演示草稿已清空");}}>清空演示草稿</button></div>
  </section>;
}
