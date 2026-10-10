(function(){
'use strict';

/* ---------- elements ---------- */
var view=document.getElementById('view');
var statusEl=document.getElementById('status');
var titleEl=document.getElementById('cycle-title');
var subEl=document.getElementById('cycle-sub');
var stripEl=document.getElementById('strip');
var tabsEl=document.getElementById('tabs');
var gearEl=document.getElementById('gear');

/* ---------- helpers ---------- */
function pad(n){ return String(n).padStart(2,'0'); }
function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function parseYmd(s){ var p=s.split('-').map(Number); return new Date(p[0],p[1]-1,p[2]); }
function addDays(s,n){ var d=parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); }
function daysBetween(a,b){ return Math.round((parseYmd(b)-parseYmd(a))/864e5); }
function isoDow(s){ var g=parseYmd(s).getDay(); return g===0?7:g; }
function monday(s){ return addDays(s,1-isoDow(s)); }
function todayStr(){ return ymd(new Date()); }
var fmtDayI=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'short'});
var fmtShortI=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'});
var fmtLongI=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'});
function fmtDay(s){ var t=fmtDayI.format(parseYmd(s)); return t.charAt(0).toUpperCase()+t.slice(1); }
function fmtShort(s){ return fmtShortI.format(parseYmd(s)); }
function fmtLong(s){ return fmtLongI.format(parseYmd(s)); }
function fmtWhen(ms){ var d=new Date(ms), hm=pad(d.getHours())+':'+pad(d.getMinutes()); return ymd(d)===todayStr()?hm:fmtShortI.format(d)+' '+hm; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function num(v){ if(v==null) return null; var t=String(v).trim().replace(',','.'); if(t==='') return null; var n=Number(t); return isFinite(n)?n:null; }
function int(v){ var n=num(v); return n==null?null:Math.round(n); }
function fmtN(n){ if(n==null||n==='') return ''; return String(Math.round(n*100)/100).replace('.',','); }
function signed(n,unit){ if(n==null) return '—'; var r=Math.round(n*10)/10; return (r>0?'+':r<0?'−':'')+fmtN(Math.abs(r))+(unit?' '+unit:''); }
function dash(s){ return String(s).replace('-','–'); }
function range(reps){ var m=String(reps).match(/(\d+)\D+(\d+)/); if(m) return [+m[1],+m[2]]; var n=parseInt(reps,10)||0; return [n,n]; }
function plural(n,a,b,c){ var m10=n%10,m100=n%100; if(m10===1&&m100!==11) return a; if(m10>=2&&m10<=4&&(m100<12||m100>14)) return b; return c; }

/* ---------- local store + GitHub sync ---------- */
var LS_KEY='sport-journal.v1';
var DEFAULT_CFG={owner:'kKar51',repo:'sport',branch:'main',token:''};
var DATA_RE=/^(program\.json|workouts\/\d{4}-\d{2}-\d{2}\.json|body\/\d{4}-\d{2}\.json|food\/\d{4}-\d{2}\.json)$/;
var Store={cfg:Object.assign({},DEFAULT_CFG),files:{},pending:{},lastSync:0,lastPull:0,state:'idle',err:'',q:Promise.resolve(),timer:null,persistTimer:null,localErr:''};

function persist(){
  clearTimeout(Store.persistTimer);
  try{ localStorage.setItem(LS_KEY,JSON.stringify({cfg:Store.cfg,files:Store.files,pending:Store.pending,lastSync:Store.lastSync})); Store.localErr=''; }
  catch(e){ Store.localErr='Телефон не дал сохранить записи локально'; }
}
function persistSoon(){ clearTimeout(Store.persistTimer); Store.persistTimer=setTimeout(persist,250); }
function restore(){
  try{
    var raw=localStorage.getItem(LS_KEY); if(!raw) return;
    var o=JSON.parse(raw);
    Store.cfg=Object.assign({},DEFAULT_CFG,o.cfg||{});
    Store.files=o.files||{}; Store.pending=o.pending||{}; Store.lastSync=o.lastSync||0;
  }catch(e){}
}
function pendingCount(){ return Object.keys(Store.pending).length; }
function hasToken(){ return !!(Store.cfg.token && Store.cfg.token.trim()); }

var API='https://api.github.com';
function repoBase(){ return '/repos/'+encodeURIComponent(Store.cfg.owner.trim())+'/'+encodeURIComponent(Store.cfg.repo.trim()); }
function branch(){ return (Store.cfg.branch||'main').trim()||'main'; }
function encPath(p){ return p.split('/').map(encodeURIComponent).join('/'); }
function gh(method,path,body){
  var h={'Accept':'application/vnd.github+json','Authorization':'Bearer '+Store.cfg.token.trim(),'X-GitHub-Api-Version':'2022-11-28'};
  if(body) h['Content-Type']='application/json';
  return fetch(API+path,{method:method,headers:h,cache:'no-store',keepalive:!!body&&document.visibilityState==='hidden',body:body?JSON.stringify(body):undefined})
    .catch(function(){ var e=new Error('net'); e.kind='net'; throw e; });
}
function httpErr(res){ var e=new Error('http '+res.status); e.kind='http'; e.status=res.status; e.rate=res.headers.get('x-ratelimit-remaining')==='0'; return e; }
function errText(e){
  if(!e) return '';
  if(e.kind==='net') return 'Нет сети. Записи в телефоне, отправятся позже';
  switch(e.status){
    case 401: return 'Токен не подходит или истёк';
    case 403: return e.rate?'GitHub временно ограничил запросы':'У токена нет права записи';
    case 404: return 'Репозиторий не найден или токен не даёт к нему доступа';
    case 409: return 'Репозиторий пуст';
    case 422: return 'GitHub отклонил запись';
    default: return 'Ошибка GitHub '+(e.status||'');
  }
}
function b64enc(str){ var bytes=new TextEncoder().encode(str),bin=''; for(var i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(bin); }
function b64dec(b64){ var bin=atob(String(b64).replace(/\s/g,'')),bytes=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
function serialize(data){ return JSON.stringify(data,null,2)+'\n'; }
function msgFor(p){
  if(p==='program.json') return 'Программа';
  var m=p.match(/^workouts\/(.+)\.json$/); if(m) return 'Тренировка '+m[1];
  m=p.match(/^body\/(.+)\.json$/); if(m) return 'Вес и талия '+m[1];
  m=p.match(/^food\/(.+)\.json$/); if(m) return 'Питание '+m[1];
  return 'Обновление';
}

function setState(s,e){ Store.state=s; Store.err=e?errText(e):''; paintSync(); }
function paintSync(){
  var n=pendingCount(),t='',cls='status';
  if(Store.localErr){ t=Store.localErr; cls+=' err'; }
  else if(!hasToken()){ t=n?'Только в телефоне: '+n:'GitHub не подключён'; cls+=' warn'; }
  else if(Store.state==='pushing') t='Отправляю…';
  else if(Store.state==='pulling') t='Обновляю…';
  else if(Store.state==='error'){ t=Store.err+(n?' · ждут: '+n:''); cls+=' err'; }
  else if(n) t='Ждёт отправки: '+n;
  else if(Store.lastSync) t='В GitHub · '+fmtWhen(Store.lastSync);
  statusEl.textContent=t; statusEl.className=cls;
}
function enqueue(fn){
  Store.q=Store.q.then(fn).catch(function(e){
    setState('error',e);
    if(S.tab==='settings') soft();
    if(e&&(e.kind==='net'||e.rate)) schedulePush(60000);
  });
  return Store.q;
}
function schedulePush(ms){ clearTimeout(Store.timer); Store.timer=setTimeout(function(){ enqueue(pushAll); },ms==null?15000:ms); }
function syncNow(){ clearTimeout(Store.timer); return enqueue(function(){ return pull().then(pushAll); }); }
function touchPath(path){
  var f=Store.files[path]; if(!f) return;
  f.data.updatedAt=new Date().toISOString();
  Store.pending[path]=1; persistSoon(); paintSync();
  if(hasToken()) schedulePush();
}

async function putFile(path,text,sha){
  var url=repoBase()+'/contents/'+encPath(path);
  var body={message:msgFor(path),content:b64enc(text),branch:branch()};
  if(sha) body.sha=sha;
  var res=await gh('PUT',url,body);
  if(res.status===409||res.status===422){
    var cur=await gh('GET',url+'?ref='+encodeURIComponent(branch()));
    if(cur.ok){ var cj=await cur.json(); body.sha=cj.sha; }
    else if(cur.status===404){ delete body.sha; }
    else throw httpErr(cur);
    res=await gh('PUT',url,body);
  }
  if(!res.ok) throw httpErr(res);
  var j=await res.json();
  return j.content&&j.content.sha;
}
async function pushAll(){
  if(!hasToken()||!pendingCount()){ if(Store.state!=='error') paintSync(); return; }
  setState('pushing');
  var paths=Object.keys(Store.pending);
  for(var i=0;i<paths.length;i++){
    var p=paths[i],f=Store.files[p];
    if(!f){ delete Store.pending[p]; continue; }
    var text=serialize(f.data);
    var sha=await putFile(p,text,f.sha);
    if(sha) f.sha=sha;
    if(serialize(f.data)===text) delete Store.pending[p];
    persist();
  }
  Store.lastSync=Date.now(); persist(); setState('ok');
  if(S.tab==='settings') soft();
}
async function pull(){
  if(!hasToken()) return;
  setState('pulling');
  var res=await gh('GET',repoBase()+'/git/trees/'+encodeURIComponent(branch())+'?recursive=1');
  var remote={};
  if(res.status===409){ /* empty repository */ }
  else if(!res.ok) throw httpErr(res);
  else { var j=await res.json(); (j.tree||[]).forEach(function(t){ if(t.type==='blob'&&DATA_RE.test(t.path)) remote[t.path]=t.sha; }); }
  var paths=Object.keys(remote);
  for(var i=0;i<paths.length;i++){
    var p=paths[i],sha=remote[p],f=Store.files[p];
    if(Store.pending[p]) continue;
    if(f&&f.sha===sha) continue;
    var b=await gh('GET',repoBase()+'/git/blobs/'+sha);
    if(!b.ok) throw httpErr(b);
    var bj=await b.json(),data;
    try{ data=JSON.parse(b64dec(bj.content)); }catch(e){ continue; }
    Store.files[p]={sha:sha,data:data};
  }
  Object.keys(Store.files).forEach(function(p){ if(!remote[p]&&!Store.pending[p]&&Store.files[p].sha) delete Store.files[p]; });
  Store.lastPull=Date.now(); Store.lastSync=Date.now();
  persist(); rebuild(); setState('ok'); soft();
}

/* ---------- app state ---------- */
var S={program:null,workouts:{},body:{},food:{},tab:'today',date:todayStr(),exSel:null};
var TYPES=[['A','Верх A'],['L','Ноги'],['B','Верх B'],['run','Бег'],['rest','Отдых']];

function rebuild(){
  S.program=null; S.workouts={}; S.body={}; S.food={};
  Object.keys(Store.files).forEach(function(p){
    var d=Store.files[p].data;
    if(p==='program.json') S.program=d;
    else if(p.indexOf('workouts/')===0) S.workouts[p.slice(9,-5)]=d;
    else if(p.indexOf('body/')===0) S.body[p.slice(5,-5)]=d;
    else if(p.indexOf('food/')===0) S.food[p.slice(5,-5)]=d;
  });
}
function ensureFile(path,init){ if(!Store.files[path]) Store.files[path]={sha:null,data:init}; return Store.files[path].data; }

/* ---------- program logic ---------- */
function P(){ return S.program; }
function weekOf(d){ var p=P(); if(!p) return 1; return Math.floor(daysBetween(p.start,d)/7)+1; }
function phaseOf(w){
  var p=P();
  if(w<1) return {key:'pre',name:'До старта',hint:'Цикл начинается '+fmtLong(p.start)+'. Вес и пробежки можно записывать уже сейчас.'};
  if(w>p.weeks) return {key:'post',name:'Цикл завершён',hint:'Время итогов: фото, замеры и план следующего цикла.'};
  for(var i=0;i<p.phases.length;i++){ var ph=p.phases[i]; if(w>=ph.from&&w<=ph.to) return ph; }
  return {key:'main',name:'',hint:''};
}
function plannedSets(ex,w){
  var k=phaseOf(w).key;
  if(k==='intro'||k==='pre') return Math.min(ex.sets,2);
  if(k==='deload') return Math.max(1,Math.ceil(ex.sets/2));
  return ex.sets;
}
function plannedType(d){ var p=P(); return (p&&p.schedule&&p.schedule[String(isoDow(d))])||'rest'; }
function typeOf(d){ var w=S.workouts[d]; return (w&&w.type)||plannedType(d); }
function typeTitle(t){ var p=P(); if(p&&p.sessions&&p.sessions[t]) return p.sessions[t].title; for(var i=0;i<TYPES.length;i++) if(TYPES[i][0]===t) return TYPES[i][1]; return t; }
function allExercises(){ var p=P(),out=[]; if(!p) return out; ['A','L','B'].forEach(function(k){ var s=p.sessions[k]; if(s) s.items.forEach(function(ex){ out.push({ex:ex,ses:k}); }); }); return out; }
function findEx(id){ var a=allExercises(); for(var i=0;i<a.length;i++) if(a[i].ex.id===id) return a[i].ex; return null; }
function filled(rows){ return (rows||[]).filter(function(r){ return r&&r.r!=null&&r.r>0; }); }
function sortedDates(desc){ var k=Object.keys(S.workouts).sort(); return desc?k.reverse():k; }
function lastSession(exId,before){
  var ds=sortedDates(true);
  for(var i=0;i<ds.length;i++){ var d=ds[i]; if(d>=before) continue; var w=S.workouts[d]; var rows=filled(w.sets&&w.sets[exId]); if(rows.length) return {date:d,rows:rows}; }
  return null;
}
function maxW(rows){ var m=null; rows.forEach(function(r){ if(r.w!=null&&(m==null||r.w>m)) m=r.w; }); return m; }
function setTxt(ex,r){ if(ex.noWeight) return String(r.r); if(r.w==null||r.w===0) return r.r+(ex.bw?' повт.':''); return (ex.bw?'+':'')+fmtN(r.w)+'×'+r.r; }
function hintFor(ex,d,last){
  var w=weekOf(d),ph=phaseOf(w).key,hi=range(ex.reps)[1];
  var res={last:'',advice:'',cls:''};
  if(last) res.last='Прошлый раз, '+fmtShort(last.date)+': '+last.rows.map(function(r){ return setTxt(ex,r); }).join(' · ');
  if(ex.start&&(ph==='intro'||ph==='pre')){ var i=Math.max(0,Math.min(ex.start.length-1,(w<1?1:w)-1)); res.advice='План недели: '+ex.start[i]; return res; }
  if(ph==='deload'){ res.advice='Разгрузка: вес как обычно, подходов меньше'; return res; }
  if(!last){ res.advice='Подбери вес: на '+hi+' повторах должно оставаться 2–3 в запасе'; return res; }
  var planned=plannedSets(ex,weekOf(last.date));
  var top=last.rows.length>=planned&&last.rows.slice(0,planned).every(function(r){ return r.r>=hi; });
  var lw=maxW(last.rows);
  if(top){
    res.cls='up';
    if(ex.noWeight||(ex.bw&&!lw)) res.advice='Пора усложнить: '+ex.incText;
    else if(ex.inc>0&&lw!=null) res.advice='Пора прибавить: '+fmtN(lw+ex.inc)+' '+(ex.unit||'кг');
    else res.advice='Пора прибавить: '+ex.incText;
  } else {
    res.cls='hold';
    res.advice=(lw&&!ex.noWeight)?'Держи '+fmtN(lw)+' '+(ex.unit||'кг')+', добирай до '+hi+' повторов в каждом подходе':'Добирай до '+hi+' повторов в каждом подходе';
  }
  return res;
}
function supersetNote(items,i){
  var key=items[i].superset; if(!key) return '';
  var nums=[]; items.forEach(function(x,j){ if(x.superset===key&&j!==i) nums.push(j+1); });
  return nums.length?'Суперсет с №'+nums.join(', '):'';
}

/* ---------- data edits ---------- */
function getW(d,create){
  if(!S.workouts[d]&&create) S.workouts[d]=ensureFile('workouts/'+d+'.json',{date:d,type:plannedType(d),sets:{},run:{},note:''});
  var w=S.workouts[d]; if(w){ w.sets=w.sets||{}; w.run=w.run||{}; }
  return w;
}
function bodyGet(d,f){ var m=S.body[d.slice(0,7)]; return m&&m[f]&&typeof m[f][d]==='number'?m[f][d]:null; }
function bodySet(d,f,v){
  var key=d.slice(0,7);
  var m=S.body[key]||(S.body[key]=ensureFile('body/'+key+'.json',{weights:{},waist:{}}));
  m[f]=m[f]||{}; if(v==null) delete m[f][d]; else m[f][d]=v;
}
function bodySeries(f){ var out=[]; Object.keys(S.body).forEach(function(k){ var o=S.body[k][f]||{}; Object.keys(o).forEach(function(d){ if(typeof o[d]==='number') out.push([d,o[d]]); }); }); return out.sort(function(a,b){ return a[0]<b[0]?-1:a[0]>b[0]?1:0; }); }
function foodDay(d,create){
  var key=d.slice(0,7),m=S.food[key];
  if(!m&&create) m=S.food[key]=ensureFile('food/'+key+'.json',{days:{}});
  if(!m) return null;
  m.days=m.days||{};
  if(!m.days[d]&&create) m.days[d]={meals:{},sweets:null,supp:{}};
  var day=m.days[d]; if(day){ day.meals=day.meals||{}; day.supp=day.supp||{}; }
  return day||null;
}
function touchFood(d){ touchPath('food/'+d.slice(0,7)+'.json'); }
function lastBodyBefore(f,d){ var s=bodySeries(f).filter(function(p){ return p[0]<d; }); return s.length?s[s.length-1][1]:null; }
function avgBetween(series,from,to){ var v=series.filter(function(p){ return p[0]>=from&&p[0]<=to; }).map(function(p){ return p[1]; }); return v.length?v.reduce(function(a,b){ return a+b; },0)/v.length:null; }

/* ---------- render: header ---------- */
function renderHeader(){
  var p=P();
  gearEl.setAttribute('aria-pressed',String(S.tab==='settings'));
  if(!p){ titleEl.textContent='Журнал зала'; subEl.textContent=hasToken()?'':'Подключи GitHub в настройках'; stripEl.innerHTML=''; return; }
  var t=todayStr(),w=weekOf(t),ph=phaseOf(w);
  if(w<1){ var left=daysBetween(t,p.start); titleEl.textContent='До старта '+left+' '+plural(left,'день','дня','дней'); subEl.textContent=p.title+' · с '+fmtLong(p.start); }
  else if(w>p.weeks){ titleEl.textContent='Цикл завершён'; subEl.textContent=p.title+' · '+p.weeks+' недель позади'; }
  else { titleEl.textContent='Неделя '+w+' из '+p.weeks; subEl.textContent=ph.name+' · '+p.title; }
  var h='';
  for(var i=1;i<=p.weeks;i++){ var k=phaseOf(i).key; h+='<span class="'+k+(i<w?'':i===w?' now':' future')+'"></span>'; }
  stripEl.innerHTML=h;
}
function paintTabs(){ Array.prototype.forEach.call(tabsEl.querySelectorAll('button'),function(b){ b.setAttribute('aria-selected',String(b.dataset.tab===S.tab)); }); }

/* ---------- render: today ---------- */
function datebar(d){
  var p=P(),w=weekOf(d),t=todayStr();
  var rel=d===t?'Сегодня':d===addDays(t,-1)?'Вчера':d===addDays(t,1)?'Завтра':'';
  var weekLbl=(w>=1&&w<=p.weeks)?'неделя '+w:'';
  return '<div class="datebar"><button class="icon-btn" type="button" data-act="prev" aria-label="Предыдущий день">‹</button>'+
    '<div class="d"><b>'+esc(fmtDay(d))+'</b><span>'+esc([rel,weekLbl].filter(Boolean).join(' · ')||' ')+'</span></div>'+
    '<button class="icon-btn" type="button" data-act="next" aria-label="Следующий день">›</button></div>';
}
function renderToday(){
  var d=S.date,w=weekOf(d),ph=phaseOf(w),type=typeOf(d),wo=S.workouts[d];
  var h=datebar(d);
  var sunday=isoDow(d)===7;
  h+='<div class="panel quick">'+
    '<div class="field"><label for="in-weight">Вес утром, кг</label><input class="big" id="in-weight" data-body="weights" inputmode="decimal" autocomplete="off" value="'+esc(fmtN(bodyGet(d,'weights')))+'" placeholder="'+esc(fmtN(lastBodyBefore('weights',d)))+'"></div>'+
    '<div class="field"><label for="in-waist">Талия, см'+(sunday?' · замер':'')+'</label><input class="big" id="in-waist" data-body="waist" inputmode="decimal" autocomplete="off" value="'+esc(fmtN(bodyGet(d,'waist')))+'" placeholder="'+esc(sunday?fmtN(lastBodyBefore('waist',d)):'по вс')+'"></div>'+
    '</div>';
  h+='<div class="chips" role="group" aria-label="Что сегодня">'+TYPES.map(function(x){
    return '<button class="chip" type="button" data-act="type" data-type="'+x[0]+'" aria-pressed="'+(x[0]===type)+'">'+esc(typeTitle(x[0]))+(x[0]===plannedType(d)?'<small> · план</small>':'')+'</button>';
  }).join('')+'</div>';
  if(ph.hint) h+='<p class="phase-hint"><b>'+esc(ph.name)+'.</b> '+esc(ph.hint)+'</p>';
  if(type==='rest') h+=restBlock();
  else if(type==='run') h+=runBlock(d,w,wo);
  else h+=sessionBlock(type,d,w,wo);
  h+='<div class="field"><label for="in-note">Заметка</label><textarea id="in-note" data-note="1" rows="2" placeholder="Самочувствие, сон, что мешало">'+esc(wo&&wo.note||'')+'</textarea></div>';
  return h;
}
function restBlock(){
  return '<div class="panel"><div class="ses-head"><h2>Отдых</h2><span>восстановление</span></div><p class="muted small mt6">Прогулка по желанию. Если всё-таки тренировался, выбери тип выше: записи сохранятся на этот день.</p></div>';
}
function paceText(r){ if(!(r.min&&r.km)) return ''; var s=Math.round(r.min*60/r.km); return 'Темп '+Math.floor(s/60)+':'+pad(s%60)+' мин/км'; }
function runBlock(d,w,wo){
  var p=P(),r=(wo&&wo.run)||{},run=p.run||{},targets=run.targets||{};
  var tgt=targets[String(w)]||targets['default']||'';
  return '<div class="ses-head"><h2>Бег</h2><span>'+esc(tgt)+'</span></div>'+
    '<div class="panel run">'+
    '<div class="field"><label for="run-min">Минуты</label><input class="big" id="run-min" data-run="min" inputmode="decimal" autocomplete="off" value="'+esc(fmtN(r.min))+'"></div>'+
    '<div class="field"><label for="run-km">Км</label><input class="big" id="run-km" data-run="km" inputmode="decimal" autocomplete="off" value="'+esc(fmtN(r.km))+'"></div>'+
    '<div class="field"><label for="run-hr">Ср. пульс</label><input class="big" id="run-hr" data-run="hr" inputmode="numeric" autocomplete="off" value="'+esc(fmtN(r.hr))+'"></div>'+
    '</div><p class="small" id="run-pace">'+esc(paceText(r))+'</p>'+
    (run.note?'<p class="muted small">'+esc(run.note)+'</p>':'');
}
function sessionBlock(type,d,w,wo){
  var ses=P().sessions[type]; if(!ses) return '';
  var h='<div class="ses-head"><h2>'+esc(ses.title)+'</h2>'+(ses.sub?'<span>'+esc(ses.sub)+'</span>':'')+'</div><ol class="exlist">';
  ses.items.forEach(function(ex,i){
    var planned=plannedSets(ex,w);
    var rows=(wo&&wo.sets&&wo.sets[ex.id])||[];
    var n=Math.max(planned,rows.length);
    var last=lastSession(ex.id,d);
    var hn=hintFor(ex,d,last);
    var ss=supersetNote(ses.items,i);
    h+='<li class="ex"><div class="ex-top"><span class="ex-n">'+(i+1)+'</span><div class="ex-name"><h3>'+esc(ex.name)+'</h3>'+
      '<p class="target">'+planned+' × '+esc(dash(ex.reps))+(ex.perSide?' на сторону':'')+' · отдых '+esc(ex.rest)+'</p>'+
      (ss?'<p class="tag">'+esc(ss)+'</p>':'')+'</div></div>';
    if(hn.last) h+='<p class="last">'+esc(hn.last)+'</p>';
    if(hn.advice) h+='<p class="hint '+hn.cls+'">'+esc(hn.advice)+'</p>';
    h+='<div class="sets">';
    for(var k=0;k<n;k++){
      var r=rows[k]||{};
      var pr=last?(last.rows[k]||last.rows[last.rows.length-1]):null;
      h+='<div class="set'+(ex.noWeight?' nw':'')+'"><span class="set-n">'+(k+1)+'</span>';
      if(!ex.noWeight){
        h+='<input class="cell" id="w-'+ex.id+'-'+k+'" data-ex="'+ex.id+'" data-i="'+k+'" data-f="w" inputmode="decimal" autocomplete="off" aria-label="'+esc(ex.name)+', подход '+(k+1)+', вес" value="'+esc(fmtN(r.w))+'" placeholder="'+esc(pr&&pr.w!=null?fmtN(pr.w):(ex.bw?'0':''))+'">'+
           '<span class="unit">'+esc(ex.unit||'кг')+' ×</span>';
      }
      h+='<input class="cell" id="r-'+ex.id+'-'+k+'" data-ex="'+ex.id+'" data-i="'+k+'" data-f="r" inputmode="numeric" autocomplete="off" aria-label="'+esc(ex.name)+', подход '+(k+1)+', повторы" value="'+esc(r.r==null?'':r.r)+'" placeholder="'+esc(pr?pr.r:'')+'">'+
         '<span class="unit">повт.</span></div>';
    }
    h+='</div><div class="ex-foot"><button class="btn-ghost" type="button" data-act="addset" data-ex="'+ex.id+'" data-n="'+n+'">+ подход</button>'+
      (ex.alt?'<span class="alt">Замена: '+esc(ex.alt)+'</span>':'')+'</div></li>';
  });
  return h+'</ol>';
}

/* ---------- render: food ---------- */
function NUT(){ var p=P(); return p&&p.nutrition; }
function mealOption(meal,id){ for(var i=0;i<meal.options.length;i++) if(meal.options[i].id===id) return meal.options[i]; return null; }
function foodTotals(day){
  var n=NUT(),res={kcal:0,p:0,onPlan:0,marked:0,unknown:0,total:n.meals.length};
  if(!day) return res;
  n.meals.forEach(function(meal){
    var m=day.meals[meal.id]; if(!m||!m.opt) return;
    res.marked++;
    if(m.opt==='skip') return;
    if(m.opt==='other'){ if(m.k!=null) res.kcal+=m.k; else res.unknown++; if(m.p!=null) res.p+=m.p; return; }
    var o=mealOption(meal,m.opt); if(o){ res.kcal+=o.kcal; res.p+=o.p; res.onPlan++; }
  });
  if(day.sweets==='plan') res.kcal+=n.sweets.plan||150;
  else if(day.sweets==='over') res.kcal+=n.sweets.over||450;
  return res;
}
function bar(val,goal,label,unit){
  var pct=Math.max(0,Math.min(100,Math.round(val/goal*100)));
  return '<div class="meter"><div class="meter-top"><span>'+esc(label)+'</span><b>~'+fmtN(Math.round(val))+'</b><span class="muted"> / '+fmtN(goal)+' '+esc(unit)+'</span></div><div class="meter-track"><i class="'+(val>goal*1.1?'over':'')+'" data-w="'+pct+'"></i></div></div>';
}
function renderFood(){
  var n=NUT(),d=S.date;
  var h=datebar(d);
  if(!n){ return h+'<div class="panel"><p class="muted small">План питания ещё не загружен. Он появится после синхронизации.</p></div>'; }
  var day=foodDay(d,false),tot=foodTotals(day);
  h+='<div class="panel nut-sum">'+bar(tot.kcal,n.targets.kcal,'Калории','ккал')+bar(tot.p,n.targets.protein,'Белок','г')+
    '<p class="small muted">По плану '+tot.onPlan+' из '+tot.total+(tot.unknown?' · ккал «другого» не указаны: '+tot.unknown:'')+'. '+esc(n.goalLine||'')+'</p></div>';
  h+='<ol class="meals">';
  n.meals.forEach(function(meal){
    var m=(day&&day.meals[meal.id])||{};
    h+='<li class="meal"><div class="ses-head"><h3>'+esc(meal.title)+'</h3><span>'+esc(meal.time||'')+'</span></div><div class="opts">';
    meal.options.forEach(function(o){
      h+='<button class="opt" type="button" data-act="meal" data-meal="'+meal.id+'" data-opt="'+o.id+'" aria-pressed="'+(m.opt===o.id)+'"><span>'+esc(o.text)+'</span><small>~'+o.kcal+' ккал · '+o.p+' г белка</small></button>';
    });
    h+='<div class="row"><button class="chip" type="button" data-act="meal" data-meal="'+meal.id+'" data-opt="other" aria-pressed="'+(m.opt==='other')+'">Другое</button>'+
       '<button class="chip" type="button" data-act="meal" data-meal="'+meal.id+'" data-opt="skip" aria-pressed="'+(m.opt==='skip')+'">Пропустил</button></div>';
    if(m.opt==='other'){
      h+='<div class="other"><div class="field"><label for="fo-t-'+meal.id+'">Что съел</label><input class="txt" id="fo-t-'+meal.id+'" data-food="text" data-meal="'+meal.id+'" autocomplete="off" value="'+esc(m.text||'')+'" placeholder="например, пицца, 3 куска"></div>'+
         '<div class="two"><div class="field"><label for="fo-k-'+meal.id+'">Ккал, примерно</label><input class="txt" id="fo-k-'+meal.id+'" data-food="k" data-meal="'+meal.id+'" inputmode="numeric" autocomplete="off" value="'+esc(m.k==null?'':m.k)+'"></div>'+
         '<div class="field"><label for="fo-p-'+meal.id+'">Белок, г</label><input class="txt" id="fo-p-'+meal.id+'" data-food="p" data-meal="'+meal.id+'" inputmode="numeric" autocomplete="off" value="'+esc(m.p==null?'':m.p)+'"></div></div></div>';
    }
    h+='</li>';
  });
  h+='</ol>';
  var sw=day&&day.sweets;
  h+='<div class="panel"><div class="ses-head"><h3>Сладкое</h3><span>'+esc(n.sweets.limit||'')+'</span></div><div class="row mt8">'+
    [['none','Не было'],['plan','По плану'],['over','Больше плана']].map(function(x){ return '<button class="chip" type="button" data-act="sweets" data-val="'+x[0]+'" aria-pressed="'+(sw===x[0])+'">'+x[1]+'</button>'; }).join('')+
    '</div>'+(n.sweets.hint?'<p class="small muted mt8">'+esc(n.sweets.hint)+'</p>':'')+'</div>';
  h+='<div class="panel"><div class="ses-head"><h3>Добавки</h3><span>отметь, что принял</span></div><ul class="supps">';
  n.supplements.forEach(function(s){
    var on=!!(day&&day.supp[s.id]);
    h+='<li><button class="check" type="button" data-act="supp" data-id="'+s.id+'" aria-pressed="'+on+'"><span class="box" aria-hidden="true"></span><span class="s-main"><b>'+esc(s.name)+'</b> · '+esc(s.dose)+(s.optional?' <em>по желанию</em>':'')+'<span class="s-when">'+esc(s.when)+'</span></span></button>'+
      (s.note?'<details><summary>Подробнее</summary><p class="small muted">'+esc(s.note)+'</p></details>':'')+'</li>';
  });
  h+='</ul></div>';
  // last 7 days
  h+='<p class="sec">Неделя</p><div class="panel"><div class="week7">';
  for(var i=6;i>=0;i--){
    var dd=addDays(d,-i),dy=foodDay(dd,false),tt=foodTotals(dy);
    var cls=!dy||!tt.marked?'none':tt.onPlan>=tt.total?'full':tt.onPlan>=tt.total-1?'most':'low';
    h+='<div class="w7 '+cls+'"><span>'+esc(fmtShortI.format(parseYmd(dd)).replace('.',''))+'</span><b>'+(dy&&tt.marked?tt.onPlan+'/'+tt.total:'—')+'</b><small>'+(dy&&dy.sweets==='over'?'сладкое':' ')+'</small></div>';
  }
  h+='</div></div>';
  return h;
}
function paintMeters(){ Array.prototype.forEach.call(view.querySelectorAll('.meter-track i[data-w]'),function(el){ el.style.width=el.getAttribute('data-w')+'%'; }); }

/* ---------- render: body ---------- */
function chartSVG(points,avg){
  var W=600,H=220,pl=42,pr=56,pt=14,pb=28;
  var d0=points[0][0],d1=points[points.length-1][0],span=Math.max(1,daysBetween(d0,d1));
  var vals=points.map(function(p){ return p[1]; });
  var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);
  var rg=hi-lo,step=rg<=2?0.5:rg<=5?1:2;
  lo=Math.floor((lo-0.2)/step)*step; hi=Math.ceil((hi+0.2)/step)*step; if(hi-lo<step*2) hi=lo+step*2;
  var x=function(d){ return pl+(W-pl-pr)*daysBetween(d0,d)/span; };
  var y=function(v){ return pt+(H-pt-pb)*(hi-v)/(hi-lo); };
  var s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Вес по дням и среднее за 7 дней">';
  for(var v=lo;v<=hi+1e-9;v+=step){ var yy=y(v).toFixed(1); s+='<line class="ch-grid" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+yy+'" y2="'+yy+'"/><text class="ch-lbl" fill="#888" x="'+(pl-8)+'" y="'+(+yy+4)+'" text-anchor="end">'+fmtN(v)+'</text>'; }
  s+='<text class="ch-lbl" fill="#888" x="'+pl+'" y="'+(H-8)+'">'+esc(fmtShort(d0))+'</text>';
  if(d1!==d0) s+='<text class="ch-lbl" fill="#888" x="'+(W-pr)+'" y="'+(H-8)+'" text-anchor="end">'+esc(fmtShort(d1))+'</text>';
  points.forEach(function(p){ s+='<circle class="ch-dot" fill="#888" cx="'+x(p[0]).toFixed(1)+'" cy="'+y(p[1]).toFixed(1)+'" r="3.5"/>'; });
  if(avg.length>1) s+='<path class="ch-avg" fill="none" stroke="#1f55c8" d="'+avg.map(function(p,i){ return (i?'L':'M')+x(p[0]).toFixed(1)+' '+y(p[1]).toFixed(1); }).join(' ')+'"/>';
  var e=avg[avg.length-1];
  if(e) s+='<circle class="ch-end" fill="#1f55c8" cx="'+x(e[0]).toFixed(1)+'" cy="'+y(e[1]).toFixed(1)+'" r="5"/><text class="ch-endlbl" fill="#222" x="'+(x(e[0])+9).toFixed(1)+'" y="'+(y(e[1])+4).toFixed(1)+'">'+fmtN(Math.round(e[1]*10)/10)+'</text>';
  return s+'</svg>';
}
function renderBody(){
  var p=P(),t=todayStr(),ws=bodySeries('weights'),wa=bodySeries('waist');
  var a7=avgBetween(ws,addDays(t,-6),t),p7=avgBetween(ws,addDays(t,-13),addDays(t,-7));
  var delta=(a7!=null&&p7!=null)?a7-p7:null;
  var waistNow=wa.length?wa[wa.length-1][1]:null,waist0=wa.length?wa[0][1]:null;
  var h='<div class="tiles">'+
    '<div class="tile"><span>Средний за 7 дней</span><b>'+(a7!=null?fmtN(Math.round(a7*10)/10):'—')+'</b><span>кг</span></div>'+
    '<div class="tile"><span>К прошлой неделе</span><b class="'+(delta==null?'':delta<=0?'good':'bad')+'">'+signed(delta)+'</b><span>кг</span></div>'+
    '<div class="tile"><span>Талия</span><b>'+(waistNow!=null?fmtN(waistNow):'—')+'</b><span>'+(waist0!=null&&wa.length>1?signed(waistNow-waist0,'см')+' от старта':'см')+'</span></div>'+
    '</div>';
  var from=addDays(t,-55),pts=ws.filter(function(q){ return q[0]>=from; });
  h+='<div class="panel"><p class="sec flush">Вес, 8 недель</p>';
  if(pts.length>=2){
    var avg=pts.map(function(q){ return [q[0],avgBetween(ws,addDays(q[0],-6),q[0])]; });
    h+=chartSVG(pts,avg)+'<div class="legend"><span><i class="dot"></i>утренний вес</span><span><i></i>среднее за 7 дней</span></div>';
  } else h+='<p class="muted small">График появится после двух-трёх утренних взвешиваний. Вес вводится на вкладке «Сегодня».</p>';
  h+='</div>';
  var weeks={};
  ws.forEach(function(q){ var m=monday(q[0]); (weeks[m]=weeks[m]||{w:[],waist:null}).w.push(q[1]); });
  wa.forEach(function(q){ var m=monday(q[0]); (weeks[m]=weeks[m]||{w:[],waist:null}).waist=q[1]; });
  var keys=Object.keys(weeks).sort();
  if(keys.length){
    var rows=[],prev=null;
    keys.forEach(function(m){ var o=weeks[m]; var av=o.w.length?o.w.reduce(function(a,b){ return a+b; },0)/o.w.length:null; rows.push({m:m,av:av,n:o.w.length,d:(av!=null&&prev!=null)?av-prev:null,waist:o.waist}); if(av!=null) prev=av; });
    h+='<p class="sec">По неделям</p><div class="panel tbl"><table><thead><tr><th>Неделя</th><th>Ср. вес</th><th>Δ</th><th>Талия</th></tr></thead><tbody>';
    rows.reverse().forEach(function(r){
      h+='<tr><td>'+esc(fmtShort(r.m))+' – '+esc(fmtShort(addDays(r.m,6)))+'<span class="sub">'+r.n+' '+plural(r.n,'взвешивание','взвешивания','взвешиваний')+'</span></td><td>'+(r.av!=null?fmtN(Math.round(r.av*10)/10):'—')+'</td><td class="'+(r.d==null?'':r.d<=0?'good-t':'bad-t')+'">'+signed(r.d)+'</td><td>'+(r.waist!=null?fmtN(r.waist):'—')+'</td></tr>';
    });
    h+='</tbody></table></div>';
  }
  if(p.milestones&&p.milestones.length){
    h+='<p class="sec">Ориентиры</p><div class="panel tbl"><table><thead><tr><th>Когда</th><th>Вес</th><th>Талия</th></tr></thead><tbody>';
    p.milestones.forEach(function(m){ h+='<tr><td>'+esc(m.when)+(m.note?'<span class="sub">'+esc(m.note)+'</span>':'')+'</td><td>'+esc(m.weight)+'</td><td>'+esc(m.waist)+'</td></tr>'; });
    h+='</tbody></table></div><p class="muted small">Темп 0,5–0,7 кг в неделю. Смотри на среднее за неделю, а не на отдельные дни: утренний вес скачет на 0,5–1 кг из-за воды и соли.</p>';
  }
  return h;
}

/* ---------- render: history ---------- */
function metric(ex,rows){
  if(ex.noWeight||(ex.bw&&!maxW(rows))) return {v:rows.reduce(function(a,r){ return a+r.r; },0),lbl:'повторов'};
  var best=0; rows.forEach(function(r){ if(r.w>0){ var e=r.w*(1+r.r/30); if(e>best) best=e; } });
  return {v:Math.round(best*10)/10,lbl:'кг, оценка максимума'};
}
function spark(vals){
  if(vals.length<2) return '';
  var W=600,H=64,p=6,lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals); if(hi===lo){ hi+=1; lo-=1; }
  var x=function(i){ return p+(W-2*p)*i/(vals.length-1); },y=function(v){ return p+(H-2*p)*(hi-v)/(hi-lo); };
  var d=vals.map(function(v,i){ return (i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1); }).join(' ');
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" aria-hidden="true"><path class="ch-avg" fill="none" stroke="#1f55c8" d="'+d+'"/><circle class="ch-end" fill="#1f55c8" cx="'+x(vals.length-1).toFixed(1)+'" cy="'+y(vals[vals.length-1]).toFixed(1)+'" r="4.5"/></svg>';
}
function renderHistory(){
  var p=P(),all=allExercises();
  if(!S.exSel||!findEx(S.exSel)) S.exSel=all.length?all[0].ex.id:null;
  var h='<div class="field"><label for="ex-select">Упражнение</label><select id="ex-select">';
  ['A','L','B'].forEach(function(k){ var s=p.sessions[k]; if(!s) return; h+='<optgroup label="'+esc(s.title)+'">'+s.items.map(function(ex){ return '<option value="'+ex.id+'"'+(ex.id===S.exSel?' selected':'')+'>'+esc(ex.name)+'</option>'; }).join('')+'</optgroup>'; });
  h+='</select></div>';
  var ex=findEx(S.exSel);
  if(ex){
    var sess=[]; sortedDates(false).forEach(function(d){ var rows=filled(S.workouts[d].sets&&S.workouts[d].sets[ex.id]); if(rows.length) sess.push({d:d,rows:rows}); });
    if(sess.length){
      var ms=sess.map(function(s){ return metric(ex,s.rows); });
      h+='<div class="panel">'+spark(ms.map(function(m){ return m.v; }))+'<p class="small muted mt6">Последнее: <b class="ink">'+fmtN(ms[ms.length-1].v)+'</b> '+esc(ms[ms.length-1].lbl)+(ms.length>1?' · было '+fmtN(ms[0].v):'')+'</p></div>';
      h+='<div class="panel tbl"><table><thead><tr><th>Дата</th><th>Подходы</th></tr></thead><tbody>';
      sess.slice().reverse().slice(0,20).forEach(function(s){ h+='<tr><td>'+esc(fmtShort(s.d))+'</td><td>'+esc(s.rows.map(function(r){ return setTxt(ex,r); }).join(' · '))+'</td></tr>'; });
      h+='</tbody></table></div>';
    } else h+='<div class="panel"><p class="muted small">Записей по этому упражнению пока нет. Они появятся после первой тренировки.</p></div>';
  }
  var recent=sortedDates(true).filter(function(d){ var w=S.workouts[d],n=0; Object.keys(w.sets||{}).forEach(function(k){ n+=filled(w.sets[k]).length; }); return n>0||(w.run&&w.run.min)||w.note; }).slice(0,14);
  h+='<p class="sec">Последние тренировки</p>';
  if(recent.length){
    h+='<div class="panel"><ul class="list">';
    recent.forEach(function(d){
      var w=S.workouts[d],n=0; Object.keys(w.sets||{}).forEach(function(k){ n+=filled(w.sets[k]).length; });
      var parts=[]; if(n) parts.push(n+' '+plural(n,'подход','подхода','подходов'));
      if(w.run&&w.run.min) parts.push(fmtN(w.run.min)+' мин'+(w.run.km?' · '+fmtN(w.run.km)+' км':''));
      h+='<li><span>'+esc(fmtDay(d))+' · '+esc(typeTitle(w.type||plannedType(d)))+'</span><span>'+esc(parts.join(' · ')||'заметка')+'</span></li>';
    });
    h+='</ul></div>';
  } else h+='<div class="panel"><p class="muted small">Здесь будет список тренировок и пробежек.</p></div>';
  return h;
}

/* ---------- render: program ---------- */
function renderProgram(){
  var p=P(),end=addDays(p.start,p.weeks*7-1);
  var h='<div class="ses-head"><h2>'+esc(p.title)+'</h2><span>'+esc(fmtLong(p.start))+' – '+esc(fmtLong(end))+'</span></div>';
  h+='<div class="phases">'+p.phases.map(function(ph){ var n=ph.to-ph.from+1; return '<div class="'+ph.key+'"><b>'+esc(ph.name)+'</b>'+(n>1?'нед. '+ph.from+'–'+ph.to:'нед. '+ph.from)+'</div>'; }).join('')+'</div>';
  h+='<div class="panel"><ul class="list">'+p.phases.map(function(ph){ return '<li><span>'+esc(ph.name)+'</span><span>'+esc(ph.hint)+'</span></li>'; }).join('')+'</ul></div>';
  var names={1:'Пн',2:'Вт',3:'Ср',4:'Чт',5:'Пт',6:'Сб',7:'Вс'};
  h+='<p class="sec">Неделя</p><div class="panel"><ul class="list">';
  for(var i=1;i<=7;i++){ var k=p.schedule[String(i)]||'rest'; var extra=k==='run'&&p.run&&p.run.days&&p.run.days[String(i)]?p.run.days[String(i)]:''; h+='<li><span>'+names[i]+'</span><span>'+esc(typeTitle(k))+(extra?' · '+esc(extra):'')+'</span></li>'; }
  h+='</ul>'+(p.minimum?'<p class="small mt8"><b>Минимум на плохую неделю:</b> '+esc(p.minimum)+'</p>':'')+'</div>';
  ['A','L','B'].forEach(function(k){
    var s=p.sessions[k]; if(!s) return;
    h+='<p class="sec">'+esc(s.title)+(s.sub?' · '+esc(s.sub):'')+'</p><div class="panel tbl"><table><thead><tr><th>#</th><th>Упражнение</th><th>Подходы</th><th>Отдых</th></tr></thead><tbody>';
    s.items.forEach(function(ex,i){ var ss=supersetNote(s.items,i); h+='<tr><td>'+(i+1)+'</td><td>'+esc(ex.name)+'<span class="sub">'+esc([ss,ex.alt?'Замена: '+ex.alt:''].filter(Boolean).join(' · '))+'</span></td><td>'+ex.sets+' × '+esc(dash(ex.reps))+(ex.perSide?' на ст.':'')+'</td><td>'+esc(ex.rest)+'</td></tr>'; });
    h+='</tbody></table></div>';
  });
  if(p.run) h+='<p class="sec">Бег</p><div class="panel"><p class="small">'+esc(p.run.note||'')+'</p></div>';
  if(p.progression&&p.progression.length) h+='<p class="sec">Как прибавлять вес</p><div class="panel"><ol class="rules">'+p.progression.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ol></div>';
  if(p.rules&&p.rules.length) h+='<p class="sec">Правила</p><div class="panel"><ol class="rules">'+p.rules.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ol></div>';
  var n=p.nutrition;
  if(n){
    h+='<p class="sec">Питание</p><div class="panel"><ul class="list">'+
      '<li><span>Калории</span><span>~'+n.targets.kcal+' ккал</span></li>'+
      '<li><span>Белок</span><span>'+n.targets.protein+' г</span></li>'+
      '<li><span>Жиры</span><span>'+esc(n.targets.fat)+'</span></li>'+
      '<li><span>Углеводы</span><span>'+esc(n.targets.carbs)+'</span></li>'+
      '<li><span>Вода</span><span>'+esc(n.targets.water)+'</span></li></ul></div>';
    if(n.rules&&n.rules.length) h+='<div class="panel"><ol class="rules">'+n.rules.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ol></div>';
    if(n.shopping&&n.shopping.length) h+='<p class="sec">Покупки на неделю</p><div class="panel"><ul class="rules">'+n.shopping.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ul></div>';
  }
  return h;
}

/* ---------- render: settings ---------- */
function renderSettings(){
  var c=Store.cfg,n=pendingCount();
  var h='<div class="ses-head"><h2>Подключение</h2><span>записи хранятся в твоём приватном репозитории</span></div>';
  if(Store.state==='error'&&Store.err) h+='<div class="banner">'+esc(Store.err)+'</div>';
  h+='<div class="panel form">'+
    '<div class="field"><label for="cfg-owner">Владелец</label><input class="txt" id="cfg-owner" value="'+esc(c.owner)+'" autocomplete="off" autocapitalize="off" spellcheck="false"></div>'+
    '<div class="field"><label for="cfg-repo">Приватный репозиторий</label><input class="txt" id="cfg-repo" value="'+esc(c.repo)+'" autocomplete="off" autocapitalize="off" spellcheck="false"></div>'+
    '<div class="field"><label for="cfg-branch">Ветка</label><input class="txt" id="cfg-branch" value="'+esc(c.branch)+'" autocomplete="off" autocapitalize="off" spellcheck="false"></div>'+
    '<div class="field"><label for="cfg-token">Токен GitHub</label><input class="txt" id="cfg-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="'+(hasToken()?'сохранён · вставь новый, чтобы заменить':'github_pat_…')+'"></div>'+
    '<div class="row"><button class="btn" type="button" data-act="save-cfg">Сохранить и синхронизировать</button>'+(hasToken()?'<button class="btn-ghost" type="button" data-act="forget-token">Удалить токен</button>':'')+'</div>'+
    '</div>';
  h+='<div class="panel"><ul class="list">'+
    '<li><span>Последняя синхронизация</span><span>'+(Store.lastSync?esc(fmtWhen(Store.lastSync)):'ещё не было')+'</span></li>'+
    '<li><span>Ждут отправки</span><span>'+n+'</span></li>'+
    '<li><span>Файлов в телефоне</span><span>'+Object.keys(Store.files).length+'</span></li>'+
    '</ul><div class="row mt8"><button class="btn-ghost" type="button" data-act="sync">Синхронизировать сейчас</button><button class="btn-ghost" type="button" data-act="copy">Скопировать все данные</button></div>'+
    '<p class="small muted mt6" id="copy-msg"></p><textarea id="copy-area" rows="6" readonly hidden></textarea></div>';
  h+='<p class="sec">Как получить токен</p><div class="panel"><ol class="rules">'+
    '<li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>'+
    '<li>Repository access: <b>Only select repositories</b> → <code>'+esc(c.repo)+'</code>.</li>'+
    '<li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Больше ничего не нужно.</li>'+
    '<li>Срок действия — год. Скопируй токен и вставь его сюда.</li>'+
    '</ol><p class="small muted mt8">Вставляй токен в приложение, открытое с иконки на экране «Домой». У иконки своё хранилище, отдельное от Safari. Токен хранится только в этом телефоне.</p></div>';
  return h;
}
function exportJSON(){ return JSON.stringify({exportedAt:new Date().toISOString(),program:S.program,workouts:S.workouts,body:S.body,food:S.food},null,2); }
function copyData(){
  var txt=exportJSON(),msg=document.getElementById('copy-msg'),ta=document.getElementById('copy-area');
  var fallback=function(){ if(msg) msg.textContent='Скопировать автоматически не получилось: выдели текст ниже и скопируй.'; if(ta){ ta.hidden=false; ta.value=txt; ta.focus(); ta.select(); } };
  if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function(){ if(msg) msg.textContent='Скопировано. Можно вставить в чат с Claude.'; },fallback);
  else fallback();
}

/* ---------- render: root ---------- */
function render(){
  renderHeader(); paintTabs(); paintSync();
  if(S.tab==='settings'){ view.innerHTML=renderSettings(); return; }
  if(!P()){
    var h;
    if(!hasToken()) h='<div class="empty"><b>Подключи GitHub</b>Программа и записи хранятся в твоём приватном репозитории. Один раз вставь токен, и журнал загрузится.<div class="mt12"><button class="btn" type="button" data-act="open-settings">Открыть настройки</button></div></div>';
    else if(Store.state==='error') h='<div class="empty"><b>Не получилось загрузить программу</b>'+esc(Store.err)+'<div class="row mt12"><button class="btn" type="button" data-act="sync">Повторить</button><button class="btn-ghost" type="button" data-act="open-settings">Настройки</button></div></div>';
    else h='<div class="empty"><b>Загружаю журнал</b>Программа и записи подтягиваются из GitHub.</div>';
    view.innerHTML=h; return;
  }
  var out='';
  if(!hasToken()&&pendingCount()) out+='<div class="banner">Записи пока только в этом телефоне. Подключи GitHub в настройках, чтобы они не потерялись.</div>';
  if(S.tab==='today') out+=renderToday();
  else if(S.tab==='food') out+=renderFood();
  else if(S.tab==='body') out+=renderBody();
  else if(S.tab==='history') out+=renderHistory();
  else out+=renderProgram();
  view.innerHTML=out;
  paintMeters();
}
function soft(){
  var a=document.activeElement;
  if(a&&view.contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){ renderHeader(); paintSync(); return; }
  render();
}

/* ---------- events ---------- */
tabsEl.addEventListener('click',function(e){
  var b=e.target.closest('button[data-tab]'); if(!b) return;
  persist(); S.tab=b.dataset.tab; render(); window.scrollTo(0,0);
});
gearEl.addEventListener('click',function(){ persist(); S.tab=S.tab==='settings'?'today':'settings'; render(); window.scrollTo(0,0); });
view.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]'); if(!b||b.disabled) return;
  var act=b.dataset.act;
  if(act==='prev'||act==='next'){ persist(); S.date=addDays(S.date,act==='prev'?-1:1); render(); }
  else if(act==='type'){ var wo=getW(S.date,true); if(wo.type===b.dataset.type) return; wo.type=b.dataset.type; touchPath('workouts/'+S.date+'.json'); render(); }
  else if(act==='addset'){
    var id=b.dataset.ex,n=+b.dataset.n,w=getW(S.date,true);
    var rows=w.sets[id]||(w.sets[id]=[]);
    while(rows.length<n) rows.push({w:null,r:null});
    rows.push({w:null,r:null});
    touchPath('workouts/'+S.date+'.json'); render();
    var ex=findEx(id),el=document.getElementById((ex&&ex.noWeight?'r-':'w-')+id+'-'+n); if(el) el.focus();
  }
  else if(act==='meal'){
    var fd=foodDay(S.date,true),mid=b.dataset.meal,opt=b.dataset.opt,cur=fd.meals[mid]||{};
    if(cur.opt===opt) delete fd.meals[mid];
    else fd.meals[mid]= opt==='other' ? {opt:'other',text:cur.text||'',k:cur.k==null?null:cur.k,p:cur.p==null?null:cur.p} : {opt:opt};
    touchFood(S.date); render();
    if(opt==='other'&&fd.meals[mid]){ var inp=document.getElementById('fo-t-'+mid); if(inp) inp.focus(); }
  }
  else if(act==='sweets'){ var fs=foodDay(S.date,true); fs.sweets= fs.sweets===b.dataset.val?null:b.dataset.val; touchFood(S.date); render(); }
  else if(act==='supp'){ var fp=foodDay(S.date,true),sid=b.dataset.id; if(fp.supp[sid]) delete fp.supp[sid]; else fp.supp[sid]=true; touchFood(S.date); render(); }
  else if(act==='open-settings'){ S.tab='settings'; render(); }
  else if(act==='save-cfg'){
    var v=function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
    Store.cfg.owner=v('cfg-owner')||DEFAULT_CFG.owner; Store.cfg.repo=v('cfg-repo')||DEFAULT_CFG.repo; Store.cfg.branch=v('cfg-branch')||'main';
    var tk=v('cfg-token'); if(tk) Store.cfg.token=tk;
    Store.state='idle'; Store.err=''; persist(); render();
    syncNow().then(function(){ if(!Store.err&&S.program&&S.tab==='settings'){ S.tab='today'; } soft(); });
  }
  else if(act==='forget-token'){ Store.cfg.token=''; Store.state='idle'; Store.err=''; persist(); render(); }
  else if(act==='sync'){ syncNow().then(soft); render(); }
  else if(act==='copy'){ copyData(); }
});
view.addEventListener('input',function(e){
  var t=e.target;
  if(t.dataset.f){
    var wo=getW(S.date,true),id=t.dataset.ex,i=+t.dataset.i;
    var rows=wo.sets[id]||(wo.sets[id]=[]);
    while(rows.length<=i) rows.push({w:null,r:null});
    var row={w:rows[i].w==null?null:rows[i].w,r:rows[i].r==null?null:rows[i].r};
    row[t.dataset.f]=t.dataset.f==='r'?int(t.value):num(t.value);
    rows[i]=row; touchPath('workouts/'+S.date+'.json');
  } else if(t.dataset.run){
    var w2=getW(S.date,true); w2.run[t.dataset.run]=num(t.value); touchPath('workouts/'+S.date+'.json');
    var pe=document.getElementById('run-pace'); if(pe) pe.textContent=paceText(w2.run);
  } else if(t.dataset.note){
    var w3=getW(S.date,true); w3.note=t.value; touchPath('workouts/'+S.date+'.json');
  } else if(t.dataset.body){
    bodySet(S.date,t.dataset.body,num(t.value)); touchPath('body/'+S.date.slice(0,7)+'.json');
  } else if(t.dataset.food){
    var fd=foodDay(S.date,true),m=fd.meals[t.dataset.meal]||(fd.meals[t.dataset.meal]={opt:'other'});
    if(t.dataset.food==='text') m.text=t.value; else m[t.dataset.food]=int(t.value);
    touchFood(S.date);
    var tot=foodTotals(fd),bars=view.querySelectorAll('.nut-sum .meter');
    if(bars.length===2){ bars[0].outerHTML=bar(tot.kcal,NUT().targets.kcal,'Калории','ккал'); }
    bars=view.querySelectorAll('.nut-sum .meter'); if(bars.length===2){ bars[1].outerHTML=bar(tot.p,NUT().targets.protein,'Белок','г'); }
    paintMeters();
  }
});
view.addEventListener('change',function(e){ if(e.target.id==='ex-select'){ S.exSel=e.target.value; render(); } });
view.addEventListener('focusout',function(e){ if(e.target.matches&&e.target.matches('input,textarea')) persist(); });
view.addEventListener('keydown',function(e){
  if(e.key!=='Enter'||!e.target.classList||!e.target.classList.contains('cell')) return;
  e.preventDefault();
  var cells=Array.prototype.slice.call(view.querySelectorAll('input.cell'));
  var i=cells.indexOf(e.target); if(i>=0&&cells[i+1]) cells[i+1].focus(); else e.target.blur();
});
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='hidden'){ persist(); if(hasToken()&&pendingCount()){ clearTimeout(Store.timer); enqueue(pushAll); } }
  else if(hasToken()&&Date.now()-Store.lastPull>60000) syncNow();
});
window.addEventListener('pagehide',persist);
window.addEventListener('online',function(){ if(hasToken()) syncNow(); });

/* ---------- boot ---------- */
restore(); rebuild();
if(!hasToken()&&!S.program) S.tab='settings';
render();
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function(){});
if(hasToken()) syncNow();
var lastDay=todayStr();
setInterval(function(){ var t=todayStr(); if(t!==lastDay){ if(S.date===lastDay) S.date=t; lastDay=t; soft(); } },60000);
})();
