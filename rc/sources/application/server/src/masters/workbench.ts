// The shell has no student data. Every data/action/download call requires a trusted
// opaque session and an explicit Masters staff grant. Tokens never enter URLs/storage.
export const workbenchHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application Compass · 咨询工作台</title>
<link rel="stylesheet" href="/internal/masters/style.css"><main><h1>Application Compass</h1><p>香港硕士咨询 · 隔离测试工作台</p>
<section id="login"><label>可信服务端会话 <input id="token" type="password" autocomplete="off" placeholder="仅在此设备内存中使用"></label><button id="connect">进入工作台</button><button id="logout">清除会话</button><p>使用现有微信登录签发的会话。工作人员须预先取得服务端授权。此入口不会创建管理员。</p></section>
<p id="message" role="status"></p><section><button id="refresh">刷新咨询</button><div id="list"></div></section>
<section id="case" hidden><h2 id="case-title"></h2><p id="progress"></p><h3>申请资料</h3><pre id="profile"></pre><h3>分类材料</h3><div id="documents"></div>
<div id="assign-panel"><label>顾问 <select id="advisor"></select></label><button id="assign">分配／改派</button></div>
<label>补件或审核说明 <textarea id="note" maxlength="1000"></textarea></label><button id="request-documents">请求补件</button><button id="generate">生成／重试方案草稿</button>
<h3>报告与核验能力</h3><p id="report-state"></p><p id="report-capability"></p><label>草稿内容（结构化字段）<textarea id="report-editor" rows="24" spellcheck="false"></textarea></label>
<button id="save-report">保存草稿</button><button id="review">顾问复核完成，提交 Founder</button>
<div id="founder-panel"><button id="approve">批准此版本</button><button id="return">退回修改</button><button id="release">开放已批准版本</button></div>
<button id="pdf">导出已开放报告 PDF</button><button id="xlsx">导出已开放院校表 XLSX</button><p>上传与识别分别显示；下载只开放经授权的材料。导出必须是已批准、已开放且资料版本一致的方案。</p></section></main><script src="/internal/masters/app.js" defer></script></html>`

export const workbenchCss = `body{font:16px/1.65 system-ui,sans-serif;background:#f5f3ec;color:#1c3834;margin:0}main{max-width:1050px;margin:auto;padding:28px}section{background:white;padding:24px;margin:16px 0;border-radius:12px}h1{margin-bottom:0}label{display:block;margin:12px 0}input,textarea,select{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid #afbdb7;border-radius:5px}button{background:#1e5148;color:white;padding:10px 16px;margin:5px 8px 5px 0;border:0;border-radius:6px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.card{border:1px solid #d8ded9;border-radius:6px;margin:10px 0;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}#message{padding:8px;white-space:pre-wrap}small{color:#62756d}`

export const workbenchJs = `'use strict';
(() => {
const el = id => document.getElementById(id);
let session = '', selected = null, staff = null;
const labels = {RESUME:'个人简历',TRANSCRIPT:'本科成绩单',LANGUAGE:'语言成绩',ENROLLMENT:'在读证明',GRADUATION:'毕业证书',DEGREE:'学位证书',SUPPLEMENTAL:'补充证明'};
const api = '/v1/internal/masters';
const key = () => crypto.randomUUID();
function message(value) { el('message').textContent = value; }
async function request(path, method = 'GET', body) {
 if (!session) throw Error('请先输入可信登录会话');
 const r = await fetch(path, {method, headers:{Authorization:'Bearer '+session,'Content-Type':'application/json', 'Idempotency-Key':key()}, ...(body ? {body:JSON.stringify(body)} : {})});
 const data = await r.json();
 if (!r.ok) throw Error((data.error?.message || '请求失败') + ' · ' + (data.request_id || ''));
 return data;
}
async function download(path, fallback) {
 const r = await fetch(path, {headers:{Authorization:'Bearer '+session}});
 if (!r.ok) { const error = await r.json(); throw Error(error.error?.message || '下载未获授权'); }
 const url = URL.createObjectURL(await r.blob()); const link=document.createElement('a'); link.href=url; link.download=fallback;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bind(id, action) { el(id).onclick=async()=>{el(id).disabled=true;try{await action();message('操作完成');}catch(e){message(e.message);}finally{el(id).disabled=false;}}; }
async function refresh() {
 const result = await request(api+'/consultations');
 el('list').replaceChildren();
 for (const row of result.consultations) { const b=document.createElement('button'); b.textContent=(row.profile?.name || '咨询')+' · '+row.status+' · '+row.applicationSeason; b.onclick=()=>load(row.id).catch(e=>message(e.message));el('list').append(b); }
 if (!result.consultations.length) el('list').textContent='暂无获授权咨询';
}
async function load(id) {
 const data = await request(api+'/consultations/'+encodeURIComponent(id)); selected=data.consultation;
 el('case').hidden=false; el('case-title').textContent=selected.profile?.name || selected.id;
 el('progress').textContent='咨询 '+selected.status+' · 资料版本 '+selected.profileVersion+' · 待补字段 '+selected.missingFields.join('、')+' · 待补材料 '+selected.missingDocuments.map(x=>labels[x]||x).join('、');
 el('profile').textContent=JSON.stringify(selected.profile,null,2); el('documents').replaceChildren();
 for (const [type,title] of Object.entries(labels)) {
 const card=document.createElement('div');card.className='card';const h=document.createElement('strong');h.textContent=title;card.append(h);
 const choose=document.createElement('label');const box=document.createElement('input');box.type='checkbox';box.name='request-type';box.value=type;box.checked=selected.missingDocuments.includes(type);box.style.width='auto';choose.append(box,document.createTextNode(' 请求补充此类材料'));card.append(choose);
 const files=selected.documents.filter(x=>x.type===type && x.uploadStatus!=='REMOVED');
 if (!files.length) {const p=document.createElement('p');p.textContent='待补（补充材料为可选）';card.append(p);}
 for(const file of files){const p=document.createElement('p');p.textContent=file.originalName+' · '+file.sizeBytes+' bytes · '+file.uploadStatus+' / '+file.extractionStatus+(file.description?' · '+file.description:'');card.append(p);const b=document.createElement('button');b.textContent='授权查看／下载';b.onclick=()=>download(api+'/consultations/'+id+'/documents/'+file.id,file.originalName).catch(e=>message(e.message));card.append(b);}
 el('documents').append(card); }
 const report=selected.currentReport;el('report-state').textContent=report ? report.status+' · 报告版本 '+report.version : '尚未生成草稿';
 el('report-capability').textContent=report ? (report.assistance?.label || '待顾问核验草稿')+'。'+(report.assistance?.explanation || '自动选校尚未实现。')+' '+(report.assistance?.limitations || []).join('；') : '规则草稿可辅助整理资料，自动选校尚未实现。';
 el('report-editor').value=report?JSON.stringify(report.payload,null,2):'';
 el('founder-panel').hidden=staff?.role!=='founder';el('assign-panel').hidden=!['founder','assignment_manager'].includes(staff?.role);
}
const casePath=()=>{if(!selected)throw Error('请先选择咨询');return api+'/consultations/'+selected.id;};
const reportBody=()=>{const r=selected?.currentReport;if(!r)throw Error('尚未生成报告');return {version:r.version,reportId:r.id,...(el('note').value.trim()?{note:el('note').value.trim()}:{})};};
async function action(suffix,body){await request(casePath()+suffix,'POST',body);await load(selected.id);}
bind('connect',async()=>{session=el('token').value.trim();el('token').value='';staff=(await request(api+'/me')).staff;const advisors=(await request(api+'/advisors')).advisors;el('advisor').replaceChildren();for(const a of advisors){const o=document.createElement('option');o.value=a.userId;o.textContent=a.userId;el('advisor').append(o);}await refresh();});
bind('logout',async()=>{session='';selected=null;staff=null;el('case').hidden=true;el('list').replaceChildren();el('profile').textContent='';el('documents').replaceChildren();el('report-editor').value='';});
bind('refresh',refresh);
bind('assign',()=>action('/assignment',{advisorUserId:el('advisor').value,version:selected.profileVersion}));
bind('request-documents',()=>action('/request-documents',{types:[...document.querySelectorAll('input[name="request-type"]:checked')].map(input=>input.value),...(el('note').value.trim()?{note:el('note').value.trim()}:{})}));
bind('generate',()=>action('/reports',{version:selected.profileVersion}));
bind('save-report',()=>action('/report/edit',{...reportBody(),payload:JSON.parse(el('report-editor').value)}));
bind('review',()=>action('/report/review',reportBody()));
bind('approve',()=>action('/report/approve',reportBody()));
bind('return',()=>action('/report/return',reportBody()));
bind('release',()=>action('/report/release',reportBody()));
bind('pdf',()=>download(casePath()+'/report/export?format=pdf','application-plan.pdf'));
bind('xlsx',()=>download(casePath()+'/report/export?format=xlsx','application-programs.xlsx'));
})();`
