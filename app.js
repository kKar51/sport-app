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
function addMonths(s,n){ var d=parseYmd(s),day=d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+n); d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate())); return ymd(d); }
function daysBetween(a,b){ return Math.round((parseYmd(b)-parseYmd(a))/864e5); }
function isoDow(s){ var g=parseYmd(s).getDay(); return g===0?7:g; }
function monday(s){ return addDays(s,1-isoDow(s)); }
function todayStr(){ return ymd(new Date()); }
var fmtDayI=new Intl.DateTimeFormat('ru-RU',{weekday:'short',day:'numeric',month:'short'});
var fmtShortI=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'});
var fmtLongI=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'});
var fmtMonthI=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'});
var fmtDateI=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
function fmtDay(s){ var t=fmtDayI.format(parseYmd(s)); return t.charAt(0).toUpperCase()+t.slice(1); }
function fmtShort(s){ return fmtShortI.format(parseYmd(s)); }
function fmtLong(s){ return fmtLongI.format(parseYmd(s)); }
function fmtWhen(ms){ var d=new Date(ms), hm=pad(d.getHours())+':'+pad(d.getMinutes()); return ymd(d)===todayStr()?hm:fmtShortI.format(d)+' '+hm; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function num(v){ if(v==null) return null; var t=String(v).replace(/\s/g,'').replace(',','.'); if(t==='') return null; var n=Number(t); return isFinite(n)?n:null; }
function thousands(v){ return v==null?'—':Math.round(v).toLocaleString('ru-RU'); }
function int(v){ var n=num(v); return n==null?null:Math.round(n); }
function fmtN(n){ if(n==null||n==='') return ''; return String(Math.round(n*100)/100).replace('.',','); }
function signed(n,unit){ if(n==null) return '—'; var r=Math.round(n*10)/10; return (r>0?'+':r<0?'−':'')+fmtN(Math.abs(r))+(unit?' '+unit:''); }
function dash(s){ return String(s).replace('-','–'); }
function range(reps){ var m=String(reps).match(/(\d+)\D+(\d+)/); if(m) return [+m[1],+m[2]]; var n=parseInt(reps,10)||0; return [n,n]; }
function plural(n,a,b,c){ var m10=n%10,m100=n%100; if(m10===1&&m100!==11) return a; if(m10>=2&&m10<=4&&(m100<12||m100>14)) return b; return c; }

/* ---------- local store + GitHub sync ---------- */
var LS_KEY='sport-journal.v1';
var UPGRADE_BACKUP_KEY='sport-journal.backup.before-night-v1';
var backupError='';
function backupBeforeUpgrade(){
  try{ var raw=localStorage.getItem(LS_KEY); if(raw&&!localStorage.getItem(UPGRADE_BACKUP_KEY)) localStorage.setItem(UPGRADE_BACKUP_KEY,raw); }
  catch(e){ backupError='Не удалось создать дополнительную копию на телефоне. Скачай копию данных в настройках.'; }
}
var DEFAULT_CFG={owner:'kKar51',repo:'sport',branch:'main',token:''};
var DATA_RE=/^(program\.json|workouts\/\d{4}-\d{2}-\d{2}\.json|body\/\d{4}-\d{2}\.json|food\/\d{4}-\d{2}\.json|health\/\d{4}-\d{2}-\d{2}\.json)$/;
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
  if(e.kind==='conflict') return 'В GitHub есть другая версия файла. Обе версии сохранены: скачай копию из настроек для сравнения';
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
  m=p.match(/^health\/(.+)\.json$/); if(m) return 'Сон и шаги '+m[1];
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
    if(cur.ok){ var cj=await cur.json(); if(cj.content&&b64dec(cj.content)===text) return cj.sha; }
    else if(cur.status!==404) throw httpErr(cur);
    var conflict=new Error('Remote file changed'); conflict.kind='conflict'; throw conflict;
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
    // An input event may have changed this file while the blob was downloading.
    if(Store.pending[p]||Store.files[p]!==f) continue;
    Store.files[p]={sha:sha,data:data};
  }
  Object.keys(Store.files).forEach(function(p){ if(!remote[p]&&!Store.pending[p]&&Store.files[p].sha) delete Store.files[p]; });
  Store.lastPull=Date.now(); Store.lastSync=Date.now();
  persist(); rebuild(); setState('ok'); soft();
}

/* ---------- app state ---------- */
var S={program:null,workouts:{},body:{},food:{},health:{},tab:'overview',date:todayStr(),exSel:null,showMeasure:false,swapOpen:null,calendarMonth:null,returnTab:'overview',healthText:'',healthPreview:null,healthPreviewText:'',healthError:'',healthNotice:null,healthReadSequence:0};
var TYPES=[['A','Верх A'],['L','Ноги'],['B','Верх B'],['run','Бег'],['rest','Отдых']];

function rebuild(){
  S.program=null; S.workouts={}; S.body={}; S.food={}; S.health={};
  Object.keys(Store.files).forEach(function(p){
    var d=Store.files[p].data;
    if(p==='program.json') S.program=d;
    else if(p.indexOf('workouts/')===0) S.workouts[p.slice(9,-5)]=d;
    else if(p.indexOf('body/')===0) S.body[p.slice(5,-5)]=d;
    else if(p.indexOf('food/')===0) S.food[p.slice(5,-5)]=d;
    else if(p.indexOf('health/')===0) S.health[p.slice(7,-5)]=d;
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
// An alternative inherits sets, reps, rest and superset from its slot; its own fields win.
function effEx(slot,choice){
  if(!choice||choice===slot.id) return slot;
  var a=(slot.alts||[]).filter(function(x){ return x.id===choice; })[0];
  if(!a) return slot;
  var e=Object.assign({},slot,{inc:0,incText:'',unit:undefined,noWeight:false,bw:false,cue:'',start:null,repsUnit:undefined},a);
  e.slot=slot.id; e.slotName=slot.name; e.isAlt=true; e.alts=slot.alts;
  return e;
}
function findEx(id){
  var a=allExercises(),i,j;
  for(i=0;i<a.length;i++) if(a[i].ex.id===id) return a[i].ex;
  for(i=0;i<a.length;i++){ var al=a[i].ex.alts||[]; for(j=0;j<al.length;j++) if(al[j].id===id) return effEx(a[i].ex,id); }
  return null;
}
// Which exercise fills a slot on a date: the day's own choice, else the last choice made before it.
function slotChoice(slot,d){
  var wo=S.workouts[d];
  if(wo&&wo.swaps&&wo.swaps[slot.id]) return wo.swaps[slot.id];
  var ds=sortedDates(true);
  for(var i=0;i<ds.length;i++){ var dd=ds[i]; if(dd>=d) continue; var w=S.workouts[dd]; if(w&&w.swaps&&w.swaps[slot.id]) return w.swaps[slot.id]; }
  return slot.id;
}
function repsWord(ex){ return ex.repsUnit==='с'?'секунд':'повторов'; }
function filled(rows){ return (rows||[]).filter(function(r){ return r&&r.r!=null&&r.r>0; }); }
function sortedDates(desc){ var k=Object.keys(S.workouts).sort(); return desc?k.reverse():k; }
function lastSession(exId,before){
  var ds=sortedDates(true);
  for(var i=0;i<ds.length;i++){ var d=ds[i]; if(d>=before) continue; var w=S.workouts[d]; var rows=filled(w.sets&&w.sets[exId]); if(rows.length) return {date:d,rows:rows}; }
  return null;
}
function maxW(rows){ var m=null; rows.forEach(function(r){ if(r.w!=null&&(m==null||r.w>m)) m=r.w; }); return m; }
function setTxt(ex,r){ if(ex.noWeight) return r.r+(ex.repsUnit?' '+ex.repsUnit:''); if(r.w==null||r.w===0) return r.r+(ex.bw?' повт.':''); return (ex.bw?'+':'')+fmtN(r.w)+'×'+r.r; }
function hintFor(ex,d,last){
  var w=weekOf(d),ph=phaseOf(w).key,hi=range(ex.reps)[1];
  var res={last:'',advice:'',cls:''};
  if(last) res.last='Прошлый раз, '+fmtShort(last.date)+': '+last.rows.map(function(r){ return setTxt(ex,r); }).join(' · ');
  if(ex.start&&(ph==='intro'||ph==='pre')){ var i=Math.max(0,Math.min(ex.start.length-1,(w<1?1:w)-1)); res.advice='План недели: '+ex.start[i]; return res; }
  if(ph==='deload'){ res.advice='Разгрузка: вес как обычно, подходов меньше'; return res; }
  if(!last){ res.advice=ex.noWeight?'Делай так, чтобы на '+hi+' '+repsWord(ex)+' оставалось 2–3 в запасе':'Подбери вес: на '+hi+' повторах должно оставаться 2–3 в запасе'; return res; }
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
    res.advice=(lw&&!ex.noWeight)?'Держи '+fmtN(lw)+' '+(ex.unit||'кг')+', добирай до '+hi+' повторов в каждом подходе':'Добирай до '+hi+' '+repsWord(ex)+' в каждом подходе';
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
function bodyManual(d,f){ var m=S.body[d.slice(0,7)]; return m&&m[f]&&typeof m[f][d]==='number'?m[f][d]:null; }
function healthValue(d,f){
  var h=S.health[d],key=f==='steps'?'steps':f==='sleep'?'sleepHours':null;
  var v=key&&h&&h.format==='sport-health.day.v1'?h[key]:null;
  return typeof v==='number'&&isFinite(v)&&v>=0?v:null;
}
function bodyGet(d,f){ var manual=bodyManual(d,f); return manual!=null?manual:healthValue(d,f); }
function bodySet(d,f,v){
  var key=d.slice(0,7);
  var m=S.body[key]||(S.body[key]=ensureFile('body/'+key+'.json',{weights:{},waist:{}}));
  m[f]=m[f]||{}; if(v==null) delete m[f][d]; else m[f][d]=v;
}
function bodySeries(f){
  var dates={};
  Object.keys(S.body).forEach(function(k){ var o=S.body[k][f]||{}; Object.keys(o).forEach(function(d){ if(typeof o[d]==='number') dates[d]=1; }); });
  if(f==='steps'||f==='sleep') Object.keys(S.health).forEach(function(d){ if(healthValue(d,f)!=null) dates[d]=1; });
  return Object.keys(dates).sort().map(function(d){ return [d,bodyGet(d,f)]; });
}
function healthProvenance(d,f){
  if(healthValue(d,f)==null) return '';
  var h=S.health[d],source=h.source||'Apple Health',received=Date.parse(h.receivedAt);
  if(bodyManual(d,f)!=null) return 'Вручную · импорт '+source+' сохранён отдельно';
  return source+(isFinite(received)?' · обновлено '+fmtWhen(received):'');
}
function paintHealthProvenance(d,f){
  var node=view.querySelector('[data-health-provenance="'+f+'"]');
  if(node){ node.textContent=healthProvenance(d,f); node.hidden=!node.textContent; }
}
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
function paintTabs(){ var active=['body','history','program','settings','health'].indexOf(S.tab)>=0?'overview':S.tab; Array.prototype.forEach.call(tabsEl.querySelectorAll('button'),function(b){ b.setAttribute('aria-selected',String(b.dataset.tab===active)); }); }

function uiIcon(name){
  var paths={left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16"/>',back:'<path d="m10 5-7 7 7 7M3 12h18"/>'};
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||'')+'</svg>';
}
function navigate(tab,date){ persist(); S.tab=tab; if(date) S.date=date; S.calendarMonth=null; S.swapOpen=null; render(); window.scrollTo(0,0); }
function overviewLink(tab,label){ return '<button class="overview-link" type="button" data-act="navigate" data-tab="'+tab+'"'+(tab==='body'?' data-date="'+todayStr()+'"':'')+'>'+esc(label)+'<span>Открыть</span></button>'; }
function recordedWorkout(w){ return Object.keys(w.sets||{}).some(function(id){ return filled(w.sets[id]).length; })||!!(w.run&&(w.run.min>0||w.run.km>0)); }
function renderOverview(){
  var today=todayStr(),dates=sortedDates(true).filter(function(d){return d<=today&&recordedWorkout(S.workouts[d]);}),latest=dates[0],seen={},results=[];
  dates.forEach(function(d){ var w=S.workouts[d]; Object.keys(w.sets||{}).forEach(function(id){
    if(seen[id]) return; var rows=filled(w.sets[id]); if(!rows.length) return; seen[id]=true;
    var ex=findEx(id)||{name:id},best=rows.slice().sort(function(a,b){ return (b.w||0)-(a.w||0)||b.r-a.r; })[0];
    results.push({id:id,date:d,ex:ex,best:best});
  }); });
  var weights=bodySeries('weights').filter(function(x){return x[0]<=today;}),last=weights[weights.length-1],first=last&&weights.filter(function(x){return x[0]>=addDays(last[0],-30);})[0];
  var weekStart=monday(today),count=dates.filter(function(d){return d>=weekStart;}).length;
  var h='<div class="overview-title"><p class="eyebrow">'+esc(fmtDay(today))+'</p><h2>Твои результаты</h2><p class="muted small">По внесённым записям</p></div>';
  h+='<section class="overview-section"><div class="section-line"><h3>В упражнениях</h3><button type="button" class="text-button" data-act="navigate" data-tab="history">История</button></div>';
  if(results.length){
    h+='<p class="small muted">Лучший подход последней записи каждого упражнения</p><div class="result-list">';
    results.slice(0,3).forEach(function(r){ h+='<button type="button" class="result-row" data-act="exercise-history" data-ex="'+esc(r.id)+'"><span>'+esc(r.ex.name)+'<small>'+esc(fmtShort(r.date))+'</small></span><span class="result-value">'+esc(setTxt(r.ex,r.best))+'<small>'+esc(r.ex.noWeight?(r.ex.repsUnit||'повторы'):(r.ex.unit||'кг')+' × повторы')+'</small></span></button>'; });
    h+='</div>';
  } else h+='<p class="muted mt12">Здесь появятся результаты после первой записи подходов.</p>';
  h+='</section><div class="overview-metrics"><div><span class="small muted">Вес'+(last?' · '+esc(fmtShort(last[0])):'')+'</span><strong>'+(last?fmtN(last[1])+'<small>кг</small>':'—')+'</strong><span class="small muted">'+(last&&first&&first[0]!==last[0]?signed(last[1]-first[1],'кг')+' с '+esc(fmtShort(first[0])):'Записывай в разделе замеров')+'</span></div><div><span class="small muted">С '+esc(fmtShort(weekStart))+'</span><strong>'+count+'</strong><span class="small muted">'+plural(count,'тренировка записана','тренировки записано','тренировок записано')+'</span></div></div>';
  h+='<button class="btn overview-start" type="button" data-act="navigate" data-tab="today" data-date="'+today+'">'+(S.workouts[today]?'Открыть тренировку':'Тренировка на сегодня')+'</button>';
  if(latest) h+='<button class="overview-link" type="button" data-act="navigate" data-tab="today" data-date="'+latest+'"><span>Последняя запись<small>'+esc(fmtShort(latest))+' · '+esc(typeTitle(S.workouts[latest].type))+'</small></span><span>Открыть</span></button>';
  if(NUT()){
    var day=foodDay(today,false),tot=foodTotals(day);
    h+='<section class="overview-section"><div class="section-line"><h3>Питание сегодня</h3><button class="text-button" type="button" data-act="navigate" data-tab="food" data-date="'+today+'">Открыть</button></div><p class="small muted">'+(day?thousands(tot.kcal)+' ккал · '+fmtN(tot.p)+' г белка учтено':'Пока нет записей')+'</p>'+((tot.unknown||tot.unknownP)?'<p class="small muted">Итог неполный: без калорий '+tot.unknown+', без белка '+tot.unknownP+'.</p>':'')+'</section>';
  }
  h+='<div class="overview-more">'+overviewLink('body','Вес и замеры')+overviewLink('history','История тренировок')+overviewLink('program','Моя программа')+'</div>';
  return h;
}

/* ---------- render: today ---------- */
function datebar(d){
  var p=P(),w=weekOf(d),t=todayStr();
  var rel=d===t?'Сегодня':d===addDays(t,-1)?'Вчера':d===addDays(t,1)?'Завтра':'';
  var weekLbl=(w>=1&&w<=p.weeks)?'неделя '+w:'';
  return '<div class="datebar"><button class="icon-btn" type="button" data-act="prev" aria-label="Предыдущий день">'+uiIcon('left')+'</button>'+
    '<button class="d" type="button" data-act="calendar-toggle" aria-expanded="'+!!S.calendarMonth+'" aria-controls="calendar-panel" aria-label="Выбрать дату: '+esc(fmtDateI.format(parseYmd(d)))+'"><b>'+esc(fmtDay(d))+' '+uiIcon('calendar')+'</b><span>'+esc([rel,weekLbl].filter(Boolean).join(' · ')||' ')+'</span></button>'+
    '<button class="icon-btn" type="button" data-act="next" aria-label="Следующий день">'+uiIcon('right')+'</button></div>'+renderCalendar();
}
function renderCalendar(){
  if(!S.calendarMonth) return '<section id="calendar-panel" hidden></section>';
  var first=S.calendarMonth,t=todayStr(),count=new Date(parseYmd(first).getFullYear(),parseYmd(first).getMonth()+1,0).getDate();
  var h='<section class="panel calendar" id="calendar-panel" aria-labelledby="calendar-title">'+
    '<div class="calendar-head"><button class="icon-btn" type="button" data-act="calendar-prev" aria-label="Предыдущий месяц">'+uiIcon('left')+'</button>'+
    '<h2 id="calendar-title" aria-live="polite">'+esc(fmtMonthI.format(parseYmd(first)))+'</h2>'+
    '<button class="icon-btn" type="button" data-act="calendar-next" aria-label="Следующий месяц">'+uiIcon('right')+'</button></div>'+
    '<div class="calendar-week" aria-hidden="true">'+['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(function(day){ return '<span>'+day+'</span>'; }).join('')+'</div>'+
    '<div class="calendar-days" role="group" aria-label="Дни месяца">';
  for(var i=1;i<isoDow(first);i++) h+='<span aria-hidden="true"></span>';
  for(var day=1;day<=count;day++){
    var d=first.slice(0,8)+pad(day);
    h+='<button class="calendar-day" type="button" data-act="calendar-day" data-date="'+d+'" aria-label="'+esc(fmtDateI.format(parseYmd(d)))+'" aria-pressed="'+(d===S.date)+'"'+(d===t?' aria-current="date"':'')+'>'+day+'</button>';
  }
  return h+'</div><div class="calendar-foot"><button class="btn-ghost" type="button" data-act="calendar-today">Сегодня</button>'+
    '<button class="btn-ghost" type="button" data-act="calendar-close">Закрыть</button></div></section>';
}
function focusDateControl(selector){ var el=view.querySelector(selector); if(el) el.focus({preventScroll:true}); }
function selectDate(d,act){
  persist(); S.date=d; S.showMeasure=false; S.swapOpen=null; S.calendarMonth=null; render();
  focusDateControl('[data-act="'+(act||'calendar-toggle')+'"]');
}
function closeCalendar(){ S.calendarMonth=null; render(); focusDateControl('[data-act="calendar-toggle"]'); }
function calendarKey(e){
  if(!S.calendarMonth) return false;
  if(e.key==='Escape'){ e.preventDefault(); closeCalendar(); return true; }
  var d=e.target.dataset.date,next;
  if(!d||e.target.dataset.act!=='calendar-day') return false;
  if(e.key==='ArrowLeft') next=addDays(d,-1);
  else if(e.key==='ArrowRight') next=addDays(d,1);
  else if(e.key==='ArrowUp') next=addDays(d,-7);
  else if(e.key==='ArrowDown') next=addDays(d,7);
  else if(e.key==='Home') next=monday(d);
  else if(e.key==='End') next=addDays(monday(d),6);
  else if(e.key==='PageUp') next=addMonths(d,-1);
  else if(e.key==='PageDown') next=addMonths(d,1);
  else return false;
  e.preventDefault(); S.calendarMonth=next.slice(0,7)+'-01'; render();
  focusDateControl('[data-date="'+next+'"]'); return true;
}
function renderToday(){
  var d=S.date,w=weekOf(d),ph=phaseOf(w),type=typeOf(d),wo=S.workouts[d];
  var h=datebar(d);
  h+='<div class="chips" role="group" aria-label="Что сегодня">'+TYPES.map(function(x){
    return '<button class="chip" type="button" data-act="type" data-type="'+x[0]+'" aria-pressed="'+(x[0]===type)+'">'+esc(typeTitle(x[0]))+(x[0]===plannedType(d)?'<small> · план</small>':'')+'</button>';
  }).join('')+'</div>';
  if(ph.hint) h+='<p class="phase-hint"><b>'+esc(ph.name)+'.</b> '+esc(ph.hint)+'</p>';
  if(type==='rest') h+=restBlock();
  else if(type==='run') h+=runBlock(d,w,wo);
  else h+=sessionBlock(type,d,w,wo);
  h+='<p class="sec">Вес, сон и шаги</p>'+quickPanel(d);
  h+='<div class="field"><label for="in-note">Заметка</label><textarea id="in-note" data-note="1" rows="2" placeholder="Самочувствие, сон, что мешало">'+esc(wo&&wo.note||'')+'</textarea></div>';
  return h;
}
function quickPanel(d){
  var sunday=isoDow(d)===7;
  var showM=sunday||S.showMeasure||bodyGet(d,'waist')!=null||bodyGet(d,'lower')!=null;
  var f=function(id,field,label,ph,mode,isInt){
    var v=bodyGet(d,field);
    return '<div class="field"><label for="'+id+'">'+esc(label)+'</label><input class="big" id="'+id+'" data-body="'+field+'"'+(isInt?' data-int="1"':'')+' inputmode="'+(mode||'decimal')+'" autocomplete="off" value="'+esc(isInt?(v==null?'':String(Math.round(v))):fmtN(v))+'" placeholder="'+esc(ph)+'">'+((field==='sleep'||field==='steps')?'<small class="health-provenance muted" data-health-provenance="'+field+'"'+(healthValue(d,field)==null?' hidden':'')+'>'+esc(healthProvenance(d,field))+'</small>':'')+'</div>';
  };
  var h='<div class="panel"><div class="quick3">'+
    f('in-weight','weights','Вес, кг',fmtN(lastBodyBefore('weights',d)))+
    f('in-sleep','sleep','Сон, ч','7–8')+
    f('in-steps','steps','Шаги','8000+','numeric',true)+'</div>';
  if(showM) h+='<div class="quick mt12">'+f('in-waist','waist','Талия, см',fmtN(lastBodyBefore('waist',d)))+f('in-lower','lower','Низ живота, см',fmtN(lastBodyBefore('lower',d)))+'</div>';
  h+='</div>';
  var sl=bodyGet(d,'sleep');
  if(sl!=null&&sl<6&&typeOf(d)!=='rest'&&typeOf(d)!=='run') h+='<div class="banner">Сон меньше 6 часов. По правилам программы зал сегодня переносится, вместо него прогулка.</div>';
  if(showM) h+='<p class="small muted">Замер раз в неделю, по воскресеньям: утром натощак, после выдоха, живот не втягивать, лента плотно, но не впивается. Талия — на уровне пупка, низ живота — на 5 см ниже. Ежедневные замеры скачут на 1–3 см и только путают.</p>';
  else h+='<div><button class="btn-ghost" type="button" data-act="show-measure">+ Замер талии и низа живота</button></div>';
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
  ses.items.forEach(function(slot,i){
    var ex=effEx(slot,slotChoice(slot,d));
    var planned=plannedSets(slot,w);
    var rows=(wo&&wo.sets&&wo.sets[ex.id])||[];
    var n=Math.max(planned,rows.length);
    var last=lastSession(ex.id,d);
    var hn=hintFor(ex,d,last);
    var ss=supersetNote(ses.items,i);
    h+='<li class="ex"><div class="ex-top"><span class="ex-n">'+(i+1)+'</span><div class="ex-name"><h3>'+esc(ex.name)+'</h3>'+
      '<p class="target">'+planned+' × '+esc(dash(ex.reps))+(ex.repsUnit?' '+esc(ex.repsUnit):'')+(ex.perSide?' на сторону':'')+' · отдых '+esc(ex.rest)+'</p>'+
      (ex.isAlt?'<p class="tag swapped">Замена вместо «'+esc(slot.name)+'»</p>':'')+
      (ss?'<p class="tag">'+esc(ss)+'</p>':'')+'</div></div>';
    if(ex.cue) h+='<p class="cue">'+esc(ex.cue)+'</p>';
    if(hn.last) h+='<p class="last">'+esc(hn.last)+'</p>';
    if(hn.advice) h+='<p class="hint '+hn.cls+'">'+esc(hn.advice)+'</p>';
    h+='<div class="sets">';
    for(var k=0;k<n;k++){
      var r=rows[k]||{};
      var pr=last?(last.rows[k]||last.rows[last.rows.length-1]):null;
      h+='<div class="set'+(ex.noWeight?' nw':'')+'"><span class="set-n">'+(k+1)+'</span>';
      if(!ex.noWeight){
        h+='<input class="cell" id="w-'+ex.id+'-'+k+'" data-ex="'+ex.id+'" data-slot="'+slot.id+'" data-i="'+k+'" data-f="w" inputmode="decimal" autocomplete="off" aria-label="'+esc(ex.name)+', подход '+(k+1)+', вес" value="'+esc(fmtN(r.w))+'" placeholder="'+esc(pr&&pr.w!=null?fmtN(pr.w):(ex.bw?'0':''))+'">'+
           '<span class="unit">'+esc(ex.unit||'кг')+' ×</span>';
      }
      h+='<input class="cell" id="r-'+ex.id+'-'+k+'" data-ex="'+ex.id+'" data-slot="'+slot.id+'" data-i="'+k+'" data-f="r" inputmode="numeric" autocomplete="off" aria-label="'+esc(ex.name)+', подход '+(k+1)+', '+(ex.repsUnit==='с'?'секунды':'повторы')+'" value="'+esc(r.r==null?'':r.r)+'" placeholder="'+esc(pr?pr.r:'')+'">'+
         '<span class="unit">'+esc(ex.repsUnit||'повт.')+'</span></div>';
    }
    var open=S.swapOpen===slot.id;
    h+='</div><div class="ex-foot"><button class="btn-ghost" type="button" data-act="addset" data-ex="'+ex.id+'" data-slot="'+slot.id+'" data-n="'+n+'">+ подход</button>'+
      ((slot.alts&&slot.alts.length)?'<button class="btn-ghost" type="button" data-act="swap-open" data-slot="'+slot.id+'" aria-expanded="'+open+'">'+(open?'Закрыть':'Заменить')+'</button>':'')+'</div>';
    if(open){
      var choices=[slot].concat(slot.alts);
      h+='<div class="opts swaps">'+choices.map(function(c){
        var cur=c.id===ex.id;
        return '<button class="opt" type="button" data-act="swap" data-slot="'+slot.id+'" data-choice="'+c.id+'" aria-pressed="'+cur+'"><span>'+esc(c.name)+'</span><small>'+(c.id===slot.id?'основное упражнение':'замена')+(cur?' · сейчас':'')+'</small></button>';
      }).join('')+'<p class="small muted">Выбор запомнится: в следующий раз здесь будет это же упражнение. Веса и история у каждого упражнения свои.</p></div>';
    }
    h+='</li>';
  });
  h+='</ol>';
  if(ses.after) h+='<div class="panel after"><b>После тренировки.</b> '+esc(ses.after)+'</div>';
  return h;
}

/* ---------- render: food ---------- */
function NUT(){ var p=P(); return p&&p.nutrition; }
function mealOption(meal,id){ for(var i=0;i<meal.options.length;i++) if(meal.options[i].id===id) return meal.options[i]; return null; }
function foodTotals(day){
  var n=NUT(),res={kcal:0,p:0,onPlan:0,marked:0,unknown:0,unknownP:0,total:n.meals.length};
  if(!day) return res;
  n.meals.forEach(function(meal){
    var m=day.meals[meal.id]; if(!m||!m.opt) return;
    res.marked++;
    if(m.opt==='skip') return;
    if(m.opt==='other'){ if(m.k!=null) res.kcal+=m.k; else res.unknown++; if(m.p!=null) res.p+=m.p; else res.unknownP++; return; }
    var o=mealOption(meal,m.opt); if(o){ res.kcal+=o.kcal; res.p+=o.p; res.onPlan++; }
  });
  (day.extra||[]).forEach(function(x){ if(x.k!=null) res.kcal+=x.k; else res.unknown++; if(x.p!=null) res.p+=x.p; else res.unknownP++; });
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
    '<p class="small muted" id="food-completeness">'+foodCompleteness(tot)+'</p></div>';
  h+='<ol class="meals">';
  n.meals.forEach(function(meal){
    var m=(day&&day.meals[meal.id])||{};
    h+='<li class="meal"><div class="ses-head"><h3>'+esc(meal.title)+'</h3><span>'+esc(meal.time||'')+'</span></div>';
    if(m.opt&&m.opt!=='other'&&m.opt!=='skip'){ var chosen=mealOption(meal,m.opt); if(chosen) h+='<p class="meal-selected">'+esc(chosen.text)+'</p>'; }
    if(m.opt!=='other') h+='<div class="row"><button class="text-button" type="button" data-act="meal" data-meal="'+meal.id+'" data-opt="other">Записать, что ел</button></div>';
    h+='<details class="meal-options"><summary>Варианты из программы'+(m.opt==='skip'?' · пропущено':'')+'</summary><div class="opts">';
    meal.options.forEach(function(o){
      h+='<button class="opt" type="button" data-act="meal" data-meal="'+meal.id+'" data-opt="'+o.id+'" aria-pressed="'+(m.opt===o.id)+'"><span>'+esc(o.text)+'</span><small>~'+o.kcal+' ккал · '+o.p+' г белка</small></button>';
    });
    h+='<button class="text-button" type="button" data-act="meal" data-meal="'+meal.id+'" data-opt="skip" aria-pressed="'+(m.opt==='skip')+'">Пропустил</button></div></details>';
    if(m.opt==='other'){
      h+='<div class="other"><div class="field"><label for="fo-t-'+meal.id+'">Что съел</label><input class="txt" id="fo-t-'+meal.id+'" data-food="text" data-meal="'+meal.id+'" autocomplete="off" value="'+esc(m.text||'')+'" placeholder="например, пицца, 3 куска"></div>'+
         '<div class="two"><div class="field"><label for="fo-k-'+meal.id+'">Ккал, если знаешь</label><input class="txt" id="fo-k-'+meal.id+'" data-food="k" data-meal="'+meal.id+'" inputmode="numeric" autocomplete="off" value="'+esc(m.k==null?'':m.k)+'"></div>'+
         '<div class="field"><label for="fo-p-'+meal.id+'">Белок, г</label><input class="txt" id="fo-p-'+meal.id+'" data-food="p" data-meal="'+meal.id+'" inputmode="numeric" autocomplete="off" value="'+esc(m.p==null?'':m.p)+'"></div></div></div>';
    }
    h+='</li>';
  });
  h+='</ol>';
  var ex=(day&&day.extra)||[];
  h+='<div class="panel"><div class="ses-head"><h3>Ещё что-то съел</h3><span>перекусы, напитки, всё вне плана</span></div>';
  if(ex.length){
    h+='<ul class="extra">'+ex.map(function(x,i){
      var meta=[x.k!=null?'~'+x.k+' ккал':'',x.p!=null?x.p+' г белка':''].filter(Boolean).join(' · ');
      return '<li><span class="x-text">'+esc(x.text)+(meta?'<small>'+esc(meta)+'</small>':'')+'</span><button class="x-del" type="button" data-act="extra-del" data-i="'+i+'" aria-label="Удалить: '+esc(x.text)+'">×</button></li>';
    }).join('')+'</ul>';
  }
  h+='<div class="other mt8"><div class="field"><label for="ex-text">Что съел</label><input class="txt" id="ex-text" autocomplete="off" placeholder="например, капучино 300 мл и банан"></div>'+
     '<div class="two"><div class="field"><label for="ex-k">Ккал, если знаешь</label><input class="txt" id="ex-k" inputmode="numeric" autocomplete="off"></div>'+
     '<div class="field"><label for="ex-p">Белок, г</label><input class="txt" id="ex-p" inputmode="numeric" autocomplete="off"></div></div>'+
     '<div class="row"><button class="btn" type="button" data-act="extra-add">Добавить</button></div></div>'+
     '<p class="small muted mt8">Пиши блюдо, граммы или название кафе. Неизвестные калории и белок сохраняются как пропуски и не входят в итог.</p></div>';
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
function foodCompleteness(tot){ return (tot.unknown||tot.unknownP)?'Итог неполный · без калорий: '+tot.unknown+' · без белка: '+tot.unknownP:'Сумма внесённых значений. Неотмеченные приёмы пищи не учтены.'; }

/* ---------- render: body ---------- */
function chartSVG(points,avg){
  var cs=getComputedStyle(view),W=Math.max(240,Math.round(view.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight))),H=220,pl=42,pr=56,pt=14,pb=28;
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
  var lo=bodySeries('lower'),st=bodySeries('steps');
  var last=function(s){ return s.length?s[s.length-1][1]:null; },first=function(s){ return s.length?s[0][1]:null; };
  var sl=bodySeries('sleep');
  var waistNow=last(wa),lowNow=last(lo),s7=avgBetween(st,addDays(t,-6),t),sl7=avgBetween(sl,addDays(t,-6),t);
  var since=[];
  if(wa.length>1) since.push('талия '+signed(waistNow-first(wa),'см'));
  if(lo.length>1) since.push('низ '+signed(lowNow-first(lo),'см'));
  var h='<div class="ses-head"><h2>Вес и замеры</h2></div>'+datebar(S.date)+quickPanel(S.date)+'<p class="sec">Динамика</p><div class="tiles">'+
    '<div class="tile"><span>Вес, среднее за 7 дней</span><b>'+(a7!=null?fmtN(Math.round(a7*10)/10):'—')+'</b><span class="'+(delta==null?'':delta<=0?'good':'bad')+'">'+(delta==null?'кг':signed(delta,'кг')+' к прошлой неделе')+'</span></div>'+
    '<div class="tile"><span>Талия · низ живота</span><b>'+(waistNow!=null?fmtN(waistNow):'—')+' · '+(lowNow!=null?fmtN(lowNow):'—')+'</b><span>'+esc(since.length?since.join(', ')+' от старта':'см')+'</span></div>'+
    '<div class="tile"><span>Шаги, среднее за 7 дней</span><b class="'+(s7==null?'':s7>=8000?'good':'bad')+'">'+thousands(s7)+'</b><span>цель '+esc(p.stepsTarget||'8–10 тыс.')+'</span></div>'+
    '<div class="tile"><span>Сон, среднее за 7 дней</span><b class="'+(sl7==null?'':sl7>=7?'good':'bad')+'">'+(sl7!=null?fmtN(Math.round(sl7*10)/10):'—')+'</b><span>ч · цель '+esc(p.sleepTarget||'7–8 ч')+'</span></div>'+
    '</div>';
  var from=addDays(t,-55),pts=ws.filter(function(q){ return q[0]>=from; });
  h+='<div class="panel"><p class="sec flush">Вес, 8 недель</p>';
  if(pts.length>=2){
    var avg=pts.map(function(q){ return [q[0],avgBetween(ws,addDays(q[0],-6),q[0])]; });
    h+=chartSVG(pts,avg)+'<div class="legend"><span><i class="dot"></i>утренний вес</span><span><i></i>среднее за 7 дней</span></div>';
  } else h+='<p class="muted small">График появится после двух утренних взвешиваний.</p>';
  h+='</div>';
  var weeks={};
  var wk=function(d){ var m=monday(d); return weeks[m]=weeks[m]||{w:[],waist:null,lower:null,steps:[],sleep:[]}; };
  ws.forEach(function(q){ wk(q[0]).w.push(q[1]); });
  wa.forEach(function(q){ wk(q[0]).waist=q[1]; });
  lo.forEach(function(q){ wk(q[0]).lower=q[1]; });
  st.forEach(function(q){ wk(q[0]).steps.push(q[1]); });
  sl.forEach(function(q){ wk(q[0]).sleep.push(q[1]); });
  var keys=Object.keys(weeks).sort();
  if(keys.length){
    var rows=[],prev=null,mean=function(a){ return a.length?a.reduce(function(x,y){ return x+y; },0)/a.length:null; };
    keys.forEach(function(m){ var o=weeks[m],av=mean(o.w); rows.push({m:m,av:av,n:o.w.length,d:(av!=null&&prev!=null)?av-prev:null,waist:o.waist,lower:o.lower,steps:mean(o.steps),sleep:mean(o.sleep)}); if(av!=null) prev=av; });
    h+='<p class="sec">По неделям</p><div class="panel tbl"><table><thead><tr><th>Неделя</th><th>Ср. вес</th><th>Δ</th><th>Талия</th><th>Шаги, сон</th></tr></thead><tbody>';
    rows.reverse().forEach(function(r){
      h+='<tr><td>'+esc(fmtShort(r.m))+' – '+esc(fmtShort(addDays(r.m,6)))+'<span class="sub">'+r.n+' '+plural(r.n,'взвешивание','взвешивания','взвешиваний')+'</span></td>'+
        '<td>'+(r.av!=null?fmtN(Math.round(r.av*10)/10):'—')+'</td>'+
        '<td class="'+(r.d==null?'':r.d<=0?'good-t':'bad-t')+'">'+signed(r.d)+'</td>'+
        '<td>'+(r.waist!=null?fmtN(r.waist):'—')+(r.lower!=null?'<span class="sub">низ '+fmtN(r.lower)+'</span>':'')+'</td>'+
        '<td>'+(r.steps!=null?fmtN(Math.round(r.steps/100)/10)+' тыс.':'—')+(r.sleep!=null?'<span class="sub">сон '+fmtN(Math.round(r.sleep*10)/10)+' ч</span>':'')+'</td></tr>';
    });
    h+='</tbody></table></div>';
  }
  if(p.milestones&&p.milestones.length){
    h+='<p class="sec">Ориентиры</p><div class="panel tbl"><table><thead><tr><th>Когда</th><th>Вес</th><th>Талия</th></tr></thead><tbody>';
    p.milestones.forEach(function(m){ h+='<tr><td>'+esc(m.when)+(m.note?'<span class="sub">'+esc(m.note)+'</span>':'')+'</td><td>'+esc(m.weight)+'</td><td>'+esc(m.waist)+'</td></tr>'; });
    h+='</tbody></table></div><p class="muted small">Темп '+esc(p.pace||'0,4–0,6 кг в неделю')+'. Смотри на среднее за неделю, а не на отдельные дни: утренний вес скачет на 0,5–1 кг из-за воды и соли.</p>';
  }
  return h;
}

/* ---------- render: history ---------- */
function metric(ex,rows){
  if(ex.noWeight||(ex.bw&&!maxW(rows))) return {v:rows.reduce(function(a,r){ return a+r.r; },0),lbl:repsWord(ex)+' за тренировку'};
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
  var hasData=function(id){ return Object.keys(S.workouts).some(function(d){ var w=S.workouts[d]; return filled(w.sets&&w.sets[id]).length>0; }); };
  var shown={};
  ['A','L','B'].forEach(function(k){ var s=p.sessions[k]; if(!s) return; h+='<optgroup label="'+esc(s.title)+'">'+s.items.map(function(ex){
    var o='<option value="'+ex.id+'"'+(ex.id===S.exSel?' selected':'')+'>'+esc(ex.name)+'</option>'; shown[ex.id]=1;
    (ex.alts||[]).forEach(function(a){ if(!shown[a.id]&&hasData(a.id)){ shown[a.id]=1; o+='<option value="'+a.id+'"'+(a.id===S.exSel?' selected':'')+'>   замена: '+esc(a.name)+'</option>'; } });
    return o; }).join('')+'</optgroup>'; });
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
    s.items.forEach(function(ex,i){ var ss=supersetNote(s.items,i); var alts=(ex.alts||[]).map(function(a){ return a.name; }).join(', '); h+='<tr><td>'+(i+1)+'</td><td>'+esc(ex.name)+'<span class="sub">'+esc([ss,alts?'Замены: '+alts:''].filter(Boolean).join(' · '))+'</span></td><td>'+ex.sets+' × '+esc(dash(ex.reps))+(ex.perSide?' на ст.':'')+'</td><td>'+esc(ex.rest)+'</td></tr>'; });
    h+='</tbody></table></div>';
    if(s.after) h+='<p class="small muted">'+esc(s.after)+'</p>';
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
      (n.targets.fiber?'<li><span>Клетчатка</span><span>'+esc(n.targets.fiber)+'</span></li>':'')+
      (p.stepsTarget?'<li><span>Шаги</span><span>'+esc(p.stepsTarget)+' в день</span></li>':'')+
      '<li><span>Вода</span><span>'+esc(n.targets.water)+'</span></li></ul></div>';
    if(n.rules&&n.rules.length) h+='<div class="panel"><ol class="rules">'+n.rules.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ol></div>';
    if(n.shopping&&n.shopping.length) h+='<p class="sec">Покупки на неделю</p><div class="panel"><ul class="rules">'+n.shopping.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ul></div>';
  }
  return h;
}

/* ---------- Apple Health import: a separate layer, never manual body data ---------- */
function healthCandidate(parsed){
  var previous=S.health[parsed.date]||{},out=Object.assign({},previous,parsed);
  if(parsed.steps==null&&healthValue(parsed.date,'steps')!=null) out.steps=previous.steps;
  if(parsed.sleepHours==null&&healthValue(parsed.date,'sleep')!=null){
    out.sleepHours=previous.sleepHours; out.sleepIntervals=previous.sleepIntervals||[];
  }
  return out;
}
function healthSame(a,b){
  var normalized=function(x){
    if(!x) return null;
    return {date:x.date,source:x.source,steps:x.steps==null?null:x.steps,sleepHours:x.sleepHours==null?null:x.sleepHours,sleepIntervals:(Array.isArray(x.sleepIntervals)?x.sleepIntervals:[]).map(function(i){return {start:i.start,end:i.end};})};
  };
  return JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
}
function renderHealthPreview(){
  var parsed=S.healthPreview;
  if(!parsed) return '';
  var candidate=healthCandidate(parsed),empty=parsed.steps==null&&parsed.sleepHours==null;
  var h='<section class="panel health-preview" aria-labelledby="health-preview-title"><h3 id="health-preview-title">Проверь перед импортом</h3><dl class="health-preview-values">'+
    '<div><dt>Дата</dt><dd id="health-preview-date">'+esc(fmtDateI.format(parseYmd(parsed.date)))+'</dd></div>'+
    '<div><dt>Источник</dt><dd id="health-preview-source">'+esc(parsed.source)+'</dd></div>'+
    '<div><dt>Шаги</dt><dd id="health-preview-steps">'+(candidate.steps==null?'Нет данных':thousands(candidate.steps))+(parsed.steps==null&&candidate.steps!=null?'<small>Сохранится предыдущий импорт</small>':'')+'</dd></div>'+
    '<div><dt>Сон</dt><dd id="health-preview-sleep">'+(candidate.sleepHours==null?'Нет данных':fmtN(candidate.sleepHours)+' ч')+(parsed.sleepHours==null&&candidate.sleepHours!=null?'<small>Сохранится предыдущий импорт</small>':'')+'</dd></div></dl>';
  var manual=[];
  if(bodyManual(parsed.date,'steps')!=null) manual.push('шаги — '+thousands(bodyManual(parsed.date,'steps')));
  if(bodyManual(parsed.date,'sleep')!=null) manual.push('сон — '+fmtN(bodyManual(parsed.date,'sleep'))+' ч');
  if(manual.length) h+='<p class="small muted" id="health-manual-warning">Уже внесено вручную: '+esc(manual.join('; '))+'. Ручные значения останутся основными, импорт будет сохранён отдельно.</p>';
  if(empty) return h+'<p class="small muted mt12" id="health-empty">В этой вставке нет шагов и сна. Ничего не будет изменено.</p></section>';
  if(healthSame(S.health[parsed.date],candidate)) h+='<p class="small muted mt12" id="health-already-imported">Эти данные уже импортированы. Повтор не создаст записей и не запустит отправку.</p>';
  return h+'<p class="small muted mt12">Изменится только отдельная запись Apple Health за эту дату.</p><div class="row mt12"><button class="btn" type="button" data-act="health-apply">Импортировать</button></div></section>';
}
function paintHealthPreview(){
  var preview=document.getElementById('health-preview'),error=document.getElementById('health-error');
  if(preview) preview.innerHTML=renderHealthPreview();
  if(error){ error.textContent=S.healthError; error.hidden=!S.healthError; }
}
function previewHealthText(){
  S.healthPreview=null; S.healthPreviewText=''; S.healthError='';
  try{
    if(!window.SportHealth||typeof window.SportHealth.parse!=='function') throw new Error('Модуль импорта не загрузился. Обнови страницу и попробуй снова.');
    S.healthPreview=window.SportHealth.parse(S.healthText);
    S.healthPreviewText=S.healthText;
  }catch(e){ S.healthError=e.message||'Не получилось прочитать данные. Проверь вставленный текст.'; }
  paintHealthPreview();
}
function applyHealthPreview(){
  var parsed=S.healthPreview;
  if(!parsed||S.healthPreviewText!==S.healthText){ S.healthError='Сначала проверь вставленные данные.'; paintHealthPreview(); return; }
  if(parsed.steps==null&&parsed.sleepHours==null){ S.healthError='В этой вставке нет шагов и сна для импорта.'; paintHealthPreview(); return; }
  var candidate=healthCandidate(parsed),previous=S.health[parsed.date],same=healthSame(previous,candidate),count=0;
  if(!same){
    if(parsed.steps!=null&&(!previous||previous.steps!==candidate.steps)) count++;
    if(parsed.sleepHours!=null&&(!previous||previous.sleepHours!==candidate.sleepHours||JSON.stringify(previous.sleepIntervals||[])!==JSON.stringify(candidate.sleepIntervals||[]))) count++;
    var path='health/'+parsed.date+'.json',data=ensureFile(path,{});
    Object.assign(data,candidate); S.health[parsed.date]=data; touchPath(path);
  }
  S.healthNotice={date:parsed.date,text:(same?'Эти данные уже импортированы. Новых показателей: 0.':'Импортировано показателей: '+count+'.')+' Дата: '+fmtLong(parsed.date)+'. Ручные записи сохранены.'};
  S.healthPreview=null; S.healthPreviewText=''; S.healthError='';
  navigate('body',parsed.date);
}
function readHealthClipboard(){
  if(!navigator.clipboard||!navigator.clipboard.readText){ S.healthError='Вставь текст вручную в поле выше.'; paintHealthPreview(); return; }
  var sequence=++S.healthReadSequence;
  navigator.clipboard.readText().then(function(text){
    if(S.tab!=='health'||sequence!==S.healthReadSequence) return;
    S.healthText=text;
    var input=document.getElementById('health-json'); if(input) input.value=text;
    previewHealthText();
  }).catch(function(){
    if(S.tab==='health'&&sequence===S.healthReadSequence){ S.healthError='Не удалось прочитать буфер. Нажми на поле и выбери «Вставить».'; paintHealthPreview(); }
  });
}
function renderHealth(){
  return '<button class="back-link" type="button" data-act="navigate" data-tab="settings">'+uiIcon('back')+'Настройки</button>'+
    '<div class="ses-head"><h2>Сон и шаги из Apple Health</h2></div><p class="small muted" id="health-import-hint">Вставь результат команды на iPhone. Сначала проверь дату и значения, затем нажми «Импортировать».</p>'+
    '<p><a class="text-button" href="health-setup.html" target="_blank" rel="noopener noreferrer">Как настроить команду на iPhone</a></p>'+
    '<div class="field"><label for="health-json">Данные из команды</label><textarea id="health-json" rows="8" spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="health-import-hint" placeholder="SPORT_HEALTH_V1…">'+esc(S.healthText)+'</textarea></div>'+
    '<div class="row"><button class="btn" type="button" data-act="health-preview">Проверить данные</button>'+(navigator.clipboard&&navigator.clipboard.readText?'<button class="text-button" type="button" data-act="health-clipboard">Вставить из буфера</button>':'')+'</div>'+
    '<p class="small health-import-error" id="health-error" role="alert"'+(S.healthError?'':' hidden')+'>'+esc(S.healthError)+'</p><div id="health-preview">'+renderHealthPreview()+'</div>';
}

/* ---------- render: settings ---------- */
function renderSettings(){
  var c=Store.cfg,n=pendingCount();
  var h='<div class="ses-head"><h2>Настройки</h2><span>Ночной лайм · версия 8</span></div>';
  h+='<div class="panel"><h3>Apple Health</h3><p class="small muted mt8">Импорт сна и шагов из «Здоровья» через команду на iPhone. Ручные значения сохраняют приоритет.</p><div class="row mt8"><button class="btn" type="button" data-act="health-open">Импортировать сон и шаги</button><a class="text-button" href="health-setup.html" target="_blank" rel="noopener noreferrer">Инструкция</a></div></div>';
  h+='<div class="panel"><h3>Копия данных</h3><p class="small muted mt8">Все записи, включая ожидающие синхронизации. Токен доступа в файл не включается.</p><div class="row mt8"><button type="button" class="btn" data-act="download-backup">Скачать копию данных</button><button type="button" class="btn-ghost" data-act="download-upgrade-backup">Копия до обновления</button></div><p class="small muted mt8" id="backup-msg">'+esc(backupError)+'</p></div>';
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
function exportJSON(){ return JSON.stringify({exportedAt:new Date().toISOString(),program:S.program,workouts:S.workouts,body:S.body,food:S.food,health:S.health},null,2); }
function downloadBackup(before){
  var msg=document.getElementById('backup-msg');
  try{
    var data=before?JSON.parse(localStorage.getItem(UPGRADE_BACKUP_KEY)||'null'):{cfg:Store.cfg,files:Store.files,pending:Store.pending,lastSync:Store.lastSync};
    if(!data){ if(msg) msg.textContent='Копии до обновления нет. Можно скачать текущие записи.'; return; }
    var c=data.cfg||{},out={format:LS_KEY,exportedAt:new Date().toISOString(),cfg:{owner:c.owner,repo:c.repo,branch:c.branch},files:data.files||{},pending:data.pending||{},lastSync:data.lastSync||0};
    var url=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'})),a=document.createElement('a');
    a.href=url; a.download='sport-'+(before?'before-update-':'backup-')+todayStr()+'.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); },60000);
    if(msg) msg.textContent='Копия подготовлена. Сохрани файл в «Файлы».';
  }catch(e){ if(msg) msg.textContent='Не удалось скачать копию. Используй «Скопировать все данные» ниже.'; }
}
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
  if(S.tab==='health'){ view.innerHTML=renderHealth(); return; }
  if(!P()){
    var h;
    if(!hasToken()) h='<div class="empty"><b>Подключи GitHub</b>Программа и записи хранятся в твоём приватном репозитории. Один раз вставь токен, и журнал загрузится.<div class="mt12"><button class="btn" type="button" data-act="open-settings">Открыть настройки</button></div></div>';
    else if(Store.state==='error') h='<div class="empty"><b>Не получилось загрузить программу</b>'+esc(Store.err)+'<div class="row mt12"><button class="btn" type="button" data-act="sync">Повторить</button><button class="btn-ghost" type="button" data-act="open-settings">Настройки</button></div></div>';
    else h='<div class="empty"><b>Загружаю журнал</b>Программа и записи подтягиваются из GitHub.</div>';
    view.innerHTML=h; return;
  }
  var out='';
  if(['body','history','program'].indexOf(S.tab)>=0) out+='<button type="button" class="back-link" data-act="navigate" data-tab="overview">'+uiIcon('back')+'Обзор</button>';
  if(S.tab==='body'&&S.healthNotice&&S.healthNotice.date===S.date) out+='<p class="small muted" data-health-notice role="status">'+esc(S.healthNotice.text)+'</p>';
  if(!hasToken()&&pendingCount()) out+='<div class="banner">Записи пока только в этом телефоне. Подключи GitHub в настройках, чтобы они не потерялись.</div>';
  if(S.tab==='overview') out+=renderOverview();
  else if(S.tab==='today') out+=renderToday();
  else if(S.tab==='food') out+=renderFood();
  else if(S.tab==='body') out+=renderBody();
  else if(S.tab==='history') out+=renderHistory();
  else out+=renderProgram();
  view.innerHTML=out;
  paintMeters();
}
function soft(){
  var a=document.activeElement;
  if(a&&view.contains(a)&&(/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)||a.closest('.calendar'))){ renderHeader(); paintSync(); return; }
  render();
}

/* ---------- events ---------- */
tabsEl.addEventListener('click',function(e){
  var b=e.target.closest('button[data-tab]'); if(!b) return;
  navigate(b.dataset.tab);
});
gearEl.addEventListener('click',function(){ if(S.tab==='settings') navigate(S.returnTab); else {S.returnTab=S.tab; navigate('settings');} });
view.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]'); if(!b||b.disabled) return;
  var act=b.dataset.act;
  if(act==='navigate') navigate(b.dataset.tab,b.dataset.date);
  else if(act==='exercise-history'){ S.exSel=b.dataset.ex; navigate('history'); }
  else if(act==='download-backup'||act==='download-upgrade-backup') downloadBackup(act==='download-upgrade-backup');
  else if(act==='health-open') navigate('health');
  else if(act==='health-preview') previewHealthText();
  else if(act==='health-apply') applyHealthPreview();
  else if(act==='health-clipboard') readHealthClipboard();
  else if(act==='prev'||act==='next') selectDate(addDays(S.date,act==='prev'?-1:1),act);
  else if(act==='calendar-toggle'){
    if(S.calendarMonth) closeCalendar();
    else { persist(); S.calendarMonth=S.date.slice(0,7)+'-01'; render(); focusDateControl('[data-date="'+S.date+'"]'); }
  }
  else if(act==='calendar-prev'||act==='calendar-next'){
    S.calendarMonth=addMonths(S.calendarMonth,act==='calendar-prev'?-1:1); render(); focusDateControl('[data-act="'+act+'"]');
  }
  else if(act==='calendar-day') selectDate(b.dataset.date);
  else if(act==='calendar-today') selectDate(todayStr());
  else if(act==='calendar-close') closeCalendar();
  else if(act==='swap-open'){ S.swapOpen=S.swapOpen===b.dataset.slot?null:b.dataset.slot; render(); }
  else if(act==='swap'){
    var ws=getW(S.date,true); ws.swaps=ws.swaps||{}; ws.swaps[b.dataset.slot]=b.dataset.choice;
    S.swapOpen=null; touchPath('workouts/'+S.date+'.json'); render();
  }
  else if(act==='extra-add'){
    var et=document.getElementById('ex-text'),ek=document.getElementById('ex-k'),ep=document.getElementById('ex-p');
    var txt=et?et.value.trim():''; if(!txt){ if(et) et.focus(); return; }
    var fx=foodDay(S.date,true); fx.extra=fx.extra||[];
    fx.extra.push({text:txt,k:ek?int(ek.value):null,p:ep?int(ep.value):null});
    touchFood(S.date); render();
    var ne=document.getElementById('ex-text'); if(ne) ne.focus();
  }
  else if(act==='extra-del'){
    var fdel=foodDay(S.date,false); if(!fdel||!fdel.extra) return;
    fdel.extra.splice(+b.dataset.i,1); touchFood(S.date); render();
  }
  else if(act==='show-measure'){ S.showMeasure=true; render(); var wi=document.getElementById('in-waist'); if(wi) wi.focus(); }
  else if(act==='type'){ var wo=getW(S.date,true); if(wo.type===b.dataset.type) return; wo.type=b.dataset.type; touchPath('workouts/'+S.date+'.json'); render(); }
  else if(act==='addset'){
    var id=b.dataset.ex,n=+b.dataset.n,w=getW(S.date,true);
    if(b.dataset.slot){ w.swaps=w.swaps||{}; w.swaps[b.dataset.slot]=id; }
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
    syncNow().then(function(){ if(!Store.err&&S.program&&S.tab==='settings'){ S.tab='overview'; } soft(); });
  }
  else if(act==='forget-token'){ Store.cfg.token=''; Store.state='idle'; Store.err=''; persist(); render(); }
  else if(act==='sync'){ syncNow().then(soft); render(); }
  else if(act==='copy'){ copyData(); }
});
view.addEventListener('input',function(e){
  var t=e.target;
  if(t.id==='health-json'){
    S.healthText=t.value; S.healthPreview=null; S.healthPreviewText=''; S.healthError=''; S.healthReadSequence++;
    paintHealthPreview();
  } else if(t.dataset.f){
    var wo=getW(S.date,true),id=t.dataset.ex,i=+t.dataset.i;
    if(t.dataset.slot){ wo.swaps=wo.swaps||{}; wo.swaps[t.dataset.slot]=id; }
    var rows=wo.sets[id]||(wo.sets[id]=[]);
    while(rows.length<=i) rows.push({w:null,r:null});
    var row=Object.assign({},rows[i],{w:rows[i].w==null?null:rows[i].w,r:rows[i].r==null?null:rows[i].r});
    row[t.dataset.f]=t.dataset.f==='r'?int(t.value):num(t.value);
    rows[i]=row; touchPath('workouts/'+S.date+'.json');
  } else if(t.dataset.run){
    var w2=getW(S.date,true); w2.run[t.dataset.run]=num(t.value); touchPath('workouts/'+S.date+'.json');
    var pe=document.getElementById('run-pace'); if(pe) pe.textContent=paceText(w2.run);
  } else if(t.dataset.note){
    var w3=getW(S.date,true); w3.note=t.value; touchPath('workouts/'+S.date+'.json');
  } else if(t.dataset.body){
    bodySet(S.date,t.dataset.body,t.dataset.int?int(t.value):num(t.value)); touchPath('body/'+S.date.slice(0,7)+'.json');
    paintHealthProvenance(S.date,t.dataset.body);
  } else if(t.dataset.food){
    var fd=foodDay(S.date,true),m=fd.meals[t.dataset.meal]||(fd.meals[t.dataset.meal]={opt:'other'});
    if(t.dataset.food==='text') m.text=t.value; else m[t.dataset.food]=int(t.value);
    touchFood(S.date);
    var tot=foodTotals(fd),bars=view.querySelectorAll('.nut-sum .meter');
    if(bars.length===2){ bars[0].outerHTML=bar(tot.kcal,NUT().targets.kcal,'Калории','ккал'); }
    bars=view.querySelectorAll('.nut-sum .meter'); if(bars.length===2){ bars[1].outerHTML=bar(tot.p,NUT().targets.protein,'Белок','г'); }
    var completeness=document.getElementById('food-completeness'); if(completeness) completeness.textContent=foodCompleteness(tot);
    paintMeters();
  }
});
view.addEventListener('change',function(e){ if(e.target.id==='ex-select'){ S.exSel=e.target.value; render(); } });
view.addEventListener('focusout',function(e){
  var t=e.target;
  if(t.matches&&t.matches('input,textarea')){
    if(t.dataset.body&&bodyManual(S.date,t.dataset.body)==null&&healthValue(S.date,t.dataset.body)!=null){
      var v=healthValue(S.date,t.dataset.body); t.value=t.dataset.int?String(Math.round(v)):fmtN(v);
      paintHealthProvenance(S.date,t.dataset.body);
    }
    persist();
  }
});
view.addEventListener('keydown',function(e){
  if(calendarKey(e)) return;
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
backupBeforeUpgrade(); restore(); rebuild();
if(!hasToken()&&!S.program) S.tab='settings';
render();
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function(){});
if('ResizeObserver' in window) new ResizeObserver(function(){
  if(S.tab!=='body') return;
  var chart=view.querySelector('svg.chart'); if(!chart) return;
  var cs=getComputedStyle(view),width=Math.max(240,Math.round(view.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)));
  if(Math.abs(chart.viewBox.baseVal.width-width)<1) return;
  var ws=bodySeries('weights'),pts=ws.filter(function(q){ return q[0]>=addDays(todayStr(),-55); });
  if(pts.length>=2) chart.outerHTML=chartSVG(pts,pts.map(function(q){return [q[0],avgBetween(ws,addDays(q[0],-6),q[0])];}));
}).observe(view);
if(hasToken()) syncNow();
var lastDay=todayStr();
setInterval(function(){ var t=todayStr(); if(t!==lastDay){ if(S.date===lastDay) S.date=t; lastDay=t; soft(); } },60000);
})();
