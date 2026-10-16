/* Apple Health import: pure validation and interval calculations, no network or storage. */
(function(root){
'use strict';
function fail(message){ throw new Error(message); }
function dateOnly(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Дата должна быть в формате ГГГГ-ММ-ДД.');
  var p=value.split('-').map(Number),d=new Date(p[0],p[1]-1,p[2]);
  if(p[0]<2000||p[0]>2100||d.getFullYear()!==p[0]||d.getMonth()!==p[1]-1||d.getDate()!==p[2]) fail('Некорректная дата импорта.');
  return d;
}
function stamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) fail('Начало и конец сна должны быть датами ISO 8601 с часовым поясом.');
  dateOnly(value.slice(0,10));
  var ms=Date.parse(value);
  if(!isFinite(ms)) fail('Не удалось прочитать время сна.');
  return ms;
}
function asleep(value){
  if(typeof value==='string'&&/^[0-5]$/.test(value.trim())) value=Number(value.trim());
  if(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=5) return [1,3,4,5].indexOf(value)>=0;
  var s=String(value==null?'':value).trim().toLowerCase().replace(/[\s_–—-]+/g,' ');
  var yes=['asleep','asleep unspecified','asleep (unspecified)','asleep core','asleep deep','asleep rem','core','deep','rem','сон','спит','сон не указан','сон (не указано)','сон (не указан)','базовый','основной','глубокий','быстрый','быстрый сон','базовый сон','глубокий сон','основной сон'];
  var no=['awake','in bed','inbed','бодрствование','бодрствует','в постели','в кровати'];
  if(yes.indexOf(s)>=0) return true;
  if(no.indexOf(s)>=0) return false;
  fail('Не распознана категория сна «'+String(value).slice(0,70)+'». Проверь, что команда передаёт свойство «Значение», а не длительность. Записи не изменены.');
}
// Health sums arrive with decimals and sometimes with a localized comma; empty means unknown, never zero.
function amount(value,max,label){
  if(value==null||value==='') return null;
  var v=typeof value==='string'?value.replace(/\s/g,'').replace(',','.'):value;
  if(['number','string'].indexOf(typeof v)<0||(typeof v==='string'&&!/^\d+(?:\.\d+)?$/.test(v))) fail(label+' должны быть числом без названия единицы.');
  v=Math.round(Number(v));
  if(!isFinite(v)||v<0||v>max) fail(label+': ожидается число от 0 до '+max+'.');
  return v;
}
function plain(text){
  var lines=text.replace(/\r/g,'').split('\n'),out={format:'sport-health.v1',sleep:[]},inSleep=false,seen={};
  if(lines.shift().trim()!=='SPORT_HEALTH_V1') fail('Вставь результат команды целиком, начиная с SPORT_HEALTH_V1.');
  lines.forEach(function(line){
    line=line.trim(); if(!line) return;
    if(line==='sleep:'){ if(inSleep) fail('В тексте повторяется раздел сна.'); inSleep=true; return; }
    if(inSleep){ var v=line.split('|'); if(v.length!==3) fail('Каждая строка сна: начало | конец | категория.'); out.sleep.push({start:v[0].trim(),end:v[1].trim(),state:v[2].trim()}); return; }
    var pos=line.indexOf('='),key=line.slice(0,pos),value=line.slice(pos+1).trim();
    if(pos<0||['date','source','steps','activeKcal','exerciseMin'].indexOf(key)<0||seen[key]) fail('Неизвестное или повторяющееся поле в результате команды.');
    seen[key]=true; out[key]=value;
  });
  return out;
}
function parse(text){
  if(typeof text!=='string'||!text.trim()) fail('Сначала вставь результат команды.');
  if(text.length>500000) fail('Слишком большой импорт. Выгрузи один день.');
  text=text.replace(/^\uFEFF/,'').trim();
  var data;
  if(text[0]==='{'){ try{data=JSON.parse(text);}catch(e){fail('Не удалось прочитать JSON. Скопируй результат команды целиком.');} }
  else data=plain(text);
  if(!data||Array.isArray(data)||data.format!=='sport-health.v1') fail('Неподдерживаемый формат данных.');
  var day=dateOnly(data.date),today=new Date();today.setHours(0,0,0,0);
  if(day>=today) fail('Выбери завершённый день — вчера или раньше. Сегодняшние шаги ещё меняются.');
  if(typeof data.source!=='string'||!data.source.trim()||data.source.length>120) fail('Укажи источник данных, например Apple Health.');
  var steps=null;
  if(data.steps!=null&&data.steps!==''){
    var value=typeof data.steps==='string'?data.steps.replace(/\s/g,'').replace(',','.'):data.steps;
    if(['number','string'].indexOf(typeof value)<0||(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value))) fail('Шаги должны быть числом без названия единицы.');
    steps=Number(value);
    if(!Number.isInteger(steps)||steps<0||steps>200000) fail('Проверь число шагов: ожидается целое число от 0 до 200 000.');
  }
  var activeKcal=amount(data.activeKcal,20000,'Активные калории'),exerciseMin=amount(data.exerciseMin,1440,'Минуты упражнений');
  if(!Array.isArray(data.sleep)||data.sleep.length>2000) fail('Сон должен быть списком интервалов за одну ночь.');
  // Noon-to-noon assigns all night stages, including those before midnight, to the wake-up date.
  var end=new Date(day);end.setHours(12,0,0,0);var start=new Date(end);start.setDate(start.getDate()-1);
  var intervals=[];
  data.sleep.forEach(function(sample){
    if(!sample||typeof sample!=='object') fail('Некорректная запись сна.');
    var a=stamp(sample.start),b=stamp(sample.end);
    if(b<=a||b-a>48*3600000) fail('Конец записи сна должен быть позже начала, длительность — не больше двух суток.');
    if(!asleep(sample.state)) return;
    a=Math.max(a,start.getTime());b=Math.min(b,end.getTime());
    if(b>a) intervals.push([a,b]);
  });
  intervals.sort(function(a,b){return a[0]-b[0]||a[1]-b[1];});
  var merged=[];
  intervals.forEach(function(pair){var last=merged[merged.length-1];if(last&&pair[0]<=last[1])last[1]=Math.max(last[1],pair[1]);else merged.push(pair.slice());});
  var total=merged.reduce(function(sum,pair){return sum+pair[1]-pair[0];},0);
  if(steps==null&&!merged.length&&activeKcal==null&&exerciseMin==null) fail('Нет шагов, сна и активности. Проверь доступ «Команд» к «Здоровью», дату и выбранный источник.');
  return {format:'sport-health.day.v1',date:data.date,source:data.source.trim(),steps:steps,sleepHours:merged.length?Math.round(total/3600000*10000)/10000:null,sleepIntervals:merged.map(function(pair){return {start:new Date(pair[0]).toISOString(),end:new Date(pair[1]).toISOString()};}),activeKcal:activeKcal,exerciseMin:exerciseMin,receivedAt:new Date().toISOString()};
}
var api={parse:parse};
if(typeof module==='object'&&module.exports) module.exports=api;
else root.SportHealth=api;
})(typeof window!=='undefined'?window:globalThis);
