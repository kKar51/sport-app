/* Progress tab: weekly goals, weight corridor, consistency, strength and recovery charts.
   Pure calculations and SVG strings; journal data stays with the caller. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.SportStats=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  var DAY=86400000;
  function dayNum(date){ if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null; var t=Date.parse(date+'T00:00:00Z'); return isFinite(t)?Math.round(t/DAY):null; }
  function dateOf(n){ return new Date(n*DAY).toISOString().slice(0,10); }
  function addDays(date,k){ return dateOf(dayNum(date)+k); }
  function num(v){ return typeof v==='number'&&isFinite(v); }
  function mean(a){ return a.length?a.reduce(function(s,x){return s+x;},0)/a.length:null; }
  function round(v,k){ var m=Math.pow(10,k||0); return Math.round(v*m)/m; }
  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function ru(v,k){ return String(round(v,k==null?1:k)).replace('.',','); }
  function short(date){ var p=date.split('-'); return Number(p[2])+'.'+p[1]; }

  /* ---------- weight plan ---------- */
  // Target for cycle week k is the weekly average base − perWeek·(k−1); the band is the program's "change nothing" pace.
  function weightPlan(goal,weeks){
    if(!goal||!num(goal.base)||!num(goal.perWeek)||!goal.from||dayNum(goal.from)==null) return [];
    var band=Array.isArray(goal.band)&&num(goal.band[0])&&num(goal.band[1])?goal.band:[-0.3,0.2],out=[];
    for(var k=1;k<=weeks;k++){
      var target=round(goal.base-goal.perWeek*(k-1),2),from=addDays(goal.from,7*(k-1));
      out.push({week:k,from:from,to:addDays(from,6),target:target,low:round(target+band[0],2),high:round(target+band[1],2)});
    }
    return out;
  }
  // Weekly averages need at least 4 weigh-ins, the same rule as the weekly comparison elsewhere in the journal.
  function weeklyAverages(series,plan){
    return plan.map(function(w){
      var vals=series.filter(function(p){return p[0]>=w.from&&p[0]<=w.to&&num(p[1]);}).map(function(p){return p[1];});
      var avg=vals.length>=4?round(mean(vals),2):null,partial=vals.length?round(mean(vals),2):null;
      var state=avg==null?null:avg>w.high?'above':avg<w.low?'below':'inside';
      return {week:w.week,from:w.from,to:w.to,n:vals.length,avg:avg,partial:partial,state:state,target:w.target,low:w.low,high:w.high};
    });
  }
  function trend(series){
    var out=[];
    series.forEach(function(p){
      var d=dayNum(p[0]),win=series.filter(function(q){var e=dayNum(q[0]);return e>d-7&&e<=d&&num(q[1]);});
      if(win.length>=4) out.push([p[0],round(mean(win.map(function(q){return q[1];})),2)]);
    });
    return out;
  }

  /* ---------- adaptive weight ---------- */
  // Weighted linear fit around one day (Gaussian weights). Unlike a 7-day mean it does not lag behind a steady loss,
  // and at the newest weigh-in it can only look back. Returns the level and slope (kg/day) with rough standard errors.
  function localFit(series,day,sigma){
    var pts=[];
    series.forEach(function(p){ var d=dayNum(p[0]); if(d!=null&&num(p[1])){ var x=d-day,w=Math.exp(-x*x/(2*sigma*sigma)); if(w>0.02) pts.push([x,p[1],w]); } });
    if(pts.length<3) return null;
    var sw=0,sw2=0,mx=0,my=0;
    pts.forEach(function(p){ sw+=p[2]; sw2+=p[2]*p[2]; mx+=p[2]*p[0]; my+=p[2]*p[1]; });
    mx/=sw; my/=sw;
    var sxx=0,sxy=0; pts.forEach(function(p){ sxx+=p[2]*(p[0]-mx)*(p[0]-mx); sxy+=p[2]*(p[0]-mx)*(p[1]-my); });
    var slope=sxx>1e-6?sxy/sxx:0,level=my-slope*mx,ss=0;
    pts.forEach(function(p){ var r=p[1]-(level+slope*p[0]); ss+=p[2]*r*r; });
    var neff=sw*sw/sw2,s2=neff>2.2?ss/sw*neff/(neff-2):ss/sw+0.04;
    s2=Math.max(s2,0.0025);
    return {level:level,slope:slope,seLevel:Math.sqrt(s2*(1/neff+mx*mx/Math.max(sxx/sw*neff,1e-6))),seSlope:sxx>1e-6?Math.sqrt(s2/(sxx/sw*neff)):0.05,n:pts.length};
  }
  // Smooth trend for every day between the first and last weigh-in in range.
  function trendLine(series,from,to,sigma){
    var known=series.filter(function(p){return num(p[1])&&dayNum(p[0])!=null;});if(known.length<3) return [];
    var a=Math.max(dayNum(from),dayNum(known[0][0])),b=Math.min(dayNum(to),dayNum(known[known.length-1][0])),out=[];
    for(var d=a;d<=b;d++){ var f=localFit(known,d,sigma||3.5); if(f) out.push([dateOf(d),round(f.level,2)]); }
    return out;
  }
  // Current pace from the last three weeks: needs five weigh-ins over at least a week.
  function pace(series,today){
    var t=dayNum(today),recent=series.filter(function(p){var d=dayNum(p[0]);return num(p[1])&&d!=null&&d<=t&&d>t-21;});
    if(recent.length<5||dayNum(recent[recent.length-1][0])-dayNum(recent[0][0])<7) return null;
    var at=dayNum(recent[recent.length-1][0]),f=localFit(recent,at,7);if(!f) return null;
    return {date:dateOf(at),level:round(f.level,2),perWeek:round(f.slope*7,2),se:round(f.seSlope*7,2),fit:f};
  }
  // Projection of the trend with an 80 % band that narrows as weigh-ins accumulate.
  function forecast(p,toDate){
    if(!p) return [];
    var a=dayNum(p.date),b=dayNum(toDate),out=[];
    for(var d=a;d<=b;d++){ var t=d-a,v=p.fit.level+p.fit.slope*t,half=1.28*Math.sqrt(p.fit.seLevel*p.fit.seLevel+Math.pow(p.fit.seSlope*t,2))+0.1; out.push([dateOf(d),round(v,2),round(v-half,2),round(v+half,2)]); }
    return out;
  }
  // Weekly targets that follow the real pace: week k aims at last week's actual average minus the chosen pace.
  // A week with fewer than four weigh-ins has no reliable average, so the chain continues from its target.
  function adaptiveWeeks(series,goal,weeks){
    if(!goal||!num(goal.base)||!num(goal.perWeek)||!goal.from||dayNum(goal.from)==null) return [];
    var band=Array.isArray(goal.band)&&num(goal.band[0])&&num(goal.band[1])?goal.band:[-0.3,0.2],out=[];
    for(var k=1;k<=weeks;k++){
      var from=addDays(goal.from,7*(k-1)),to=addDays(from,6),prev=out[k-2];
      var vals=series.filter(function(p){return p[0]>=from&&p[0]<=to&&num(p[1]);}).map(function(p){return p[1];});
      var target=k===1?goal.base:round((prev.avg!=null?prev.avg:prev.target)-goal.perWeek,2);
      var avg=vals.length>=4?round(mean(vals),2):null,partial=vals.length?round(mean(vals),2):null;
      var w={week:k,from:from,to:to,n:vals.length,avg:avg,partial:partial,target:target,low:round(target+band[0],2),high:round(target+band[1],2),basis:k===1?'start':prev.avg!=null?'actual':'plan'};
      var v=avg!=null?avg:partial;
      w.state=v==null?null:v>w.high?'above':v<w.low?'below':'inside';
      out.push(w);
    }
    return out;
  }
  // What to do this week, from the program's rules: faster than the corridor — eat a little more; above it two weeks — steps, then less at dinner.
  function weightAdvice(weeks,k,perWeek){
    var cur=weeks[k-1],prev=weeks[k-2];if(!cur) return null;
    if(cur.partial==null) return {kind:'none',text:'Замеров на этой неделе пока нет.'};
    var gain=perWeek<0,maint=perWeek===0;
    if(cur.state==='inside') return {kind:'inside',text:'В коридоре: ничего не меняем.'};
    if(cur.state==='below') return {kind:'below',text:gain?'Набор медленнее цели: +150–200 ккал в день.':maint?'Вес уходит вниз: +150 ккал в день, чтобы держать вес.':'Худеешь быстрее цели. По правилам программы: +150–200 ккал в день, например творог 200 г с фруктом на перекус.'};
    var twice=prev&&prev.state==='above'&&prev.avg!=null;
    if(gain) return {kind:'above',text:'Набор быстрее цели: −150 ккал в день.'};
    return {kind:twice?'above2':'above',text:twice?'Вторая неделя выше коридора: сначала добавь шаги, потом −150 ккал на ужине.':'Выше коридора одну неделю — пока ничего не меняем, смотрим следующую.'};
  }

  /* ---------- training ---------- */
  // Working sets only: a weighted set lighter than 70 % of the session's top weight is a warm-up.
  // With a counterweight (assisted pull-ups) a heavier number is easier, so nothing is dropped there.
  function workingSets(rows,assisted){
    var done=(rows||[]).filter(function(s){return s&&num(s.r)&&s.r>0;});
    if(assisted) return done;
    var top=done.reduce(function(m,s){return num(s.w)&&s.w>m?s.w:m;},0);
    return top>0?done.filter(function(s){return !num(s.w)||s.w>=top*0.7;}):done;
  }
  // Fractional sets per muscle: a primary muscle gets a full set, a secondary one half.
  function muscleSets(sessions,infoFor){
    var out={};
    sessions.forEach(function(sets){
      Object.keys(sets||{}).forEach(function(id){
        var inf=infoFor(id);if(!inf) return;
        var n=workingSets(sets[id],inf.assisted).length;if(!n) return;
        Object.keys(inf.muscles).forEach(function(m){ out[m]=(out[m]||0)+n*inf.muscles[m]; });
      });
    });
    return out;
  }
  function workingTonnage(sets,assistedFor){
    var t=0;
    Object.keys(sets||{}).forEach(function(id){ if(assistedFor&&assistedFor(id)) return; workingSets(sets[id]).forEach(function(s){ if(num(s.w)&&s.w>0) t+=s.w*s.r; }); });
    return t;
  }
  // Strength grows fast at first and then slows down, so a log curve e = a + b·ln(1 + days) fits better than a line.
  function logFit(points){
    if(points.length<3) return null;
    var d0=dayNum(points[0][0]),xs=points.map(function(p){return Math.log(1+dayNum(p[0])-d0);}),ys=points.map(function(p){return p[1];});
    var mx=mean(xs),my=mean(ys),sxx=0,sxy=0;
    xs.forEach(function(x,i){ sxx+=(x-mx)*(x-mx); sxy+=(x-mx)*(ys[i]-my); });
    if(sxx<1e-6) return null;
    var b=sxy/sxx,a=my-b*mx;
    return {a:a,b:b,at:function(date){return round(a+b*Math.log(1+Math.max(0,dayNum(date)-d0)),1);}};
  }
  // Cycle progress in percent: strength as the mean change of each lift from its first session, weight as the change of its trend.
  function strengthIndex(lifts){
    var dates={};lifts.forEach(function(l){l.forEach(function(p){dates[p[0]]=1;});});
    return Object.keys(dates).sort().map(function(d){
      var ch=[];lifts.forEach(function(l){ var upto=l.filter(function(p){return p[0]<=d;});if(upto.length) ch.push((upto[upto.length-1][1]/l[0][1]-1)*100); });
      return [d,round(mean(ch),1)];
    });
  }
  // Epley estimate; above 15 reps it overstates the maximum, so such sets are left out.
  function e1rm(w,r){ return num(w)&&w>0&&num(r)&&r>0&&r<=15?round(w*(1+r/30),1):null; }
  function tonnage(sets){
    var t=0;
    Object.keys(sets||{}).forEach(function(id){ (sets[id]||[]).forEach(function(s){ if(s&&num(s.w)&&s.w>0&&num(s.r)&&s.r>0) t+=s.w*s.r; }); });
    return t;
  }
  function recorded(w){
    if(!w) return false;
    var sets=Object.keys(w.sets||{}).some(function(id){return (w.sets[id]||[]).some(function(s){return s&&num(s.r)&&s.r>0;});});
    return sets||!!(w.run&&((num(w.run.min)&&w.run.min>0)||(num(w.run.km)&&w.run.km>0)));
  }
  // One cell per day: what was done, or what was planned and missed.
  function dayStatus(date,workout,planned,today){
    var done=recorded(workout),type=workout&&workout.type;
    if(done) return {kind:type==='run'?'run':'gym',type:type||planned};
    if(date>today) return {kind:planned==='rest'?'rest':'plan',type:planned};
    if(date===today) return {kind:planned==='rest'?'rest':'today',type:planned};
    return {kind:planned==='rest'?'rest':'miss',type:planned};
  }

  /* ---------- weekly goals ---------- */
  function ratio(v,goal){ return v==null||!goal?0:Math.max(0,Math.min(1,v/goal)); }
  function weekGoals(o){
    var g=o.goals||{},rows=[];
    rows.push({key:'gym',name:'Залы',value:o.gym+' из '+(g.gym||3),p:ratio(o.gym,g.gym||3),ok:o.gym>=(g.gymMin||2)});
    rows.push({key:'run',name:'Бег',value:o.run+' из '+(g.runMin||1)+(g.runMax&&g.runMax!==g.runMin?'–'+g.runMax:''),p:ratio(o.run,g.runMin||1),ok:o.run>=(g.runMin||1)});
    rows.push({key:'steps',name:'Шаги',value:o.steps==null?'—':Math.round(o.steps).toLocaleString('ru-RU'),sub:'среднее · цель '+(g.steps||8000).toLocaleString('ru-RU'),p:ratio(o.steps,g.steps||8000),ok:o.steps!=null&&o.steps>=(g.steps||8000),unknown:o.steps==null});
    var sl=o.sleep==null?'—':Math.floor(o.sleep)+' ч '+String(Math.round(o.sleep%1*60)).padStart(2,'0');
    rows.push({key:'sleep',name:'Сон',value:sl,sub:'среднее · цель '+(g.sleep||7)+' ч',p:ratio(o.sleep,g.sleep||7),ok:o.sleep!=null&&o.sleep>=(g.sleep||7),unknown:o.sleep==null});
    rows.push({key:'protein',name:'Белок',value:o.protein==null?'—':'~'+Math.round(o.protein)+' г',sub:'цель '+(g.protein||140)+'+',p:ratio(o.protein,g.protein||140),ok:o.protein!=null&&o.protein>=(g.protein||140),unknown:o.protein==null});
    var w=o.weight;
    rows.push({key:'weight',name:'Вес',value:w&&w.partial!=null?ru(w.partial):'—',sub:w?(w.partial!=null&&w.partial<w.low?'быстрее цели · ':w.partial!=null&&w.partial>w.high?'выше цели · ':'')+'коридор '+ru(w.low)+'–'+ru(w.high):'',p:w&&w.partial!=null?(w.partial>w.high||w.partial<w.low?0.6:1):0,ok:!!w&&w.partial!=null&&w.partial<=w.high&&w.partial>=w.low,unknown:!w||w.partial==null});
    return rows;
  }

  /* ---------- SVG ---------- */
  function ring(row){
    var r=17,c=2*Math.PI*r,len=row.unknown?0:c*row.p;
    return '<div class="st-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="st-ring-track" cx="22" cy="22" r="'+r+'"/>'+(len>0?'<circle class="st-ring-val'+(row.ok?'':' low')+'" cx="22" cy="22" r="'+r+'" stroke-dasharray="'+len.toFixed(1)+' '+c.toFixed(1)+'" transform="rotate(-90 22 22)"/>':'')+'</svg><div><b>'+esc(row.value)+'</b><span>'+esc(row.name+(row.sub?' · '+row.sub:''))+'</span></div></div>';
  }
  function scaleY(lo,hi,top,bottom){ return function(v){return top+(hi-v)*(bottom-top)/(hi-lo);}; }

  function weightChart(o){
    // Days run from the first weigh-in to one week past today: the future part is a forecast, not an empty plan.
    var W=Math.max(260,Math.round(o.width||340)),H=210,L=34,R=40,T=14,B=24;
    var weeks=o.weeks||[],series=o.series||[],today=o.today,t=dayNum(today);if(!weeks.length) return '';
    var first=series.length?dayNum(series[0][0]):t;
    var x0=o.range==='cycle'?Math.min(dayNum(weeks[0].from),Math.max(first,dayNum(weeks[0].from)-7)):t-13,x1=t+7;
    var cur=Math.floor((t-dayNum(weeks[0].from))/7)+1;
    var inX=function(d){var n=dayNum(d);return n>=x0&&n<=x1;};
    var pts=series.filter(function(p){return inX(p[0])&&dayNum(p[0])<=t;}),tr=(o.trend||[]).filter(function(p){return inX(p[0]);}),fc=(o.forecast||[]).filter(function(p){return inX(p[0]);});
    var shown=weeks.filter(function(w){return w.week<=cur+1&&dayNum(w.to)>=x0&&dayNum(w.from)<=x1;});
    var vals=pts.map(function(p){return p[1];});
    tr.forEach(function(p){vals.push(p[1]);}); fc.forEach(function(p){vals.push(p[2],p[3]);}); shown.forEach(function(w){vals.push(w.low,w.high);});
    if(!vals.length) return '';
    var lo=Math.floor((Math.min.apply(null,vals)-0.15)*2)/2,hi=Math.ceil((Math.max.apply(null,vals)+0.15)*2)/2;
    var x=function(n){return L+(n-x0)*(W-L-R)/Math.max(1,x1-x0);},y=scaleY(lo,hi,T,H-B),g='',step=hi-lo>3?1:0.5;
    for(var v=lo;v<=hi+1e-9;v+=step) g+='<line class="st-grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v).toFixed(1)+'" y2="'+y(v).toFixed(1)+'"/><text class="st-lbl" x="'+(L-5)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end">'+ru(v)+'</text>';
    shown.forEach(function(w){
      var a=Math.max(dayNum(w.from),x0),b=Math.min(dayNum(w.to)+1,x1+1);if(b<=a) return;
      var cls=w.week===cur?' now':w.week>cur?' next':'';
      g+='<rect class="st-band'+cls+'" x="'+x(a).toFixed(1)+'" width="'+Math.max(1,x(b)-x(a)-1).toFixed(1)+'" y="'+y(w.high).toFixed(1)+'" height="'+(y(w.low)-y(w.high)).toFixed(1)+'" rx="2"><title>Неделя '+w.week+': цель '+ru(w.target,2)+', коридор '+ru(w.low,2)+'–'+ru(w.high,2)+'</title></rect>';
    });
    g+='<line class="st-today" x1="'+x(t).toFixed(1)+'" x2="'+x(t).toFixed(1)+'" y1="'+T+'" y2="'+(H-B)+'"/>';
    if(fc.length>1){
      g+='<path class="st-cone" d="'+fc.map(function(p,i){return (i?'L':'M')+x(dayNum(p[0])).toFixed(1)+' '+y(p[3]).toFixed(1);}).join(' ')+' '+fc.slice().reverse().map(function(p){return 'L'+x(dayNum(p[0])).toFixed(1)+' '+y(p[2]).toFixed(1);}).join(' ')+' Z"/>';
      g+='<path class="st-fc" d="'+fc.map(function(p,i){return (i?'L':'M')+x(dayNum(p[0])).toFixed(1)+' '+y(p[1]).toFixed(1);}).join(' ')+'"/>';
      var end=fc[fc.length-1];
      g+='<text class="st-val" x="'+(x(dayNum(end[0]))+4).toFixed(1)+'" y="'+(y(end[1])+4).toFixed(1)+'">≈'+ru(end[1])+'</text>';
    }
    if(tr.length>1) g+='<path class="st-trend draw" pathLength="1" d="'+tr.map(function(p,i){return (i?'L':'M')+x(dayNum(p[0])).toFixed(1)+' '+y(p[1]).toFixed(1);}).join(' ')+'"/>';
    var sel=o.selected&&inX(o.selected)?o.selected:null;
    if(sel) g+='<line class="st-sel" x1="'+x(dayNum(sel)).toFixed(1)+'" x2="'+x(dayNum(sel)).toFixed(1)+'" y1="'+T+'" y2="'+(H-B)+'"/>';
    pts.forEach(function(p,i){ var last=i===pts.length-1,on=p[0]===sel; g+='<circle class="st-dot'+(last?' last':'')+(on?' on':'')+'" data-i="'+i+'" cx="'+x(dayNum(p[0])).toFixed(1)+'" cy="'+y(p[1]).toFixed(1)+'" r="'+(on?5.5:last?4.5:3)+'"><title>'+short(p[0])+': '+ru(p[1])+' кг</title></circle>'; });
    [[x0,'start'],[t,'middle'],[x1,'end']].forEach(function(k){ g+='<text class="st-lbl'+(k[0]===t?' strong':'')+'" x="'+x(k[0]).toFixed(1)+'" y="'+(H-6)+'" text-anchor="'+k[1]+'">'+(k[0]===t?'сегодня':short(dateOf(k[0])))+'</text>'; });
    var label='Вес: '+pts.length+' утренних замеров, линия тренда, коридор недели'+(fc.length?' и прогноз до '+short(fc[fc.length-1][0]):'');
    return '<svg class="st-chart" data-chart="weight" data-x0="'+x0+'" data-x1="'+x1+'" data-l="'+L+'" data-r="'+R+'" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(label)+'">'+g+'</svg>';
  }

  function barChart(o){
    // Daily bars with a goal line; a missing day stays empty, not zero.
    var W=Math.max(260,Math.round(o.width||340)),H=150,L=38,R=6,T=12,B=22,data=o.data,n=data.length;if(!n) return '';
    var max=Math.max(o.goal||0,Math.max.apply(null,data.map(function(p){return num(p[1])?p[1]:0;})))*1.1||1;
    var y=scaleY(0,max,T,H-B),bw=(W-L-R)/n*0.62,g='';
    (o.ticks||[0,max/2]).forEach(function(v){ if(v<=max) g+='<line class="st-grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v).toFixed(1)+'" y2="'+y(v).toFixed(1)+'"/><text class="st-lbl" x="'+(L-5)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end">'+esc(o.tickLabel?o.tickLabel(v):v)+'</text>'; });
    var every=Math.ceil(n/7);
    data.forEach(function(p,i){
      var cx=L+(i+0.5)*(W-L-R)/n;
      if(num(p[1])) g+='<rect class="st-bar'+(o.goal&&p[1]<o.goal?' low':'')+'" x="'+(cx-bw/2).toFixed(1)+'" y="'+y(p[1]).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0,y(0)-y(p[1])).toFixed(1)+'" rx="3"><title>'+short(p[0])+': '+esc(o.valueLabel?o.valueLabel(p[1]):p[1])+'</title></rect>';
      if(i%every===0||i===n-1) g+='<text class="st-lbl" x="'+cx.toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle">'+short(p[0])+'</text>';
    });
    if(o.goal) g+='<line class="st-goal" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(o.goal).toFixed(1)+'" y2="'+y(o.goal).toFixed(1)+'"/>';
    return '<svg class="st-chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(o.label)+'">'+g+'</svg>';
  }

  function liftChart(o){
    // Estimated 1RM per session, the fitted curve with two weeks ahead, and the level before the break.
    var W=Math.max(120,Math.round(o.width||140)),H=44,pts=o.points,fit=o.fit||[],prior=o.prior;
    var vals=pts.map(function(p){return p[1];}).concat(fit.map(function(p){return p[1];}));if(num(prior)) vals.push(prior);
    var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);if(hi-lo<2){lo-=1;hi+=1;}
    var d0=dayNum(pts[0][0]),d1=Math.max(dayNum(pts[pts.length-1][0]),fit.length?dayNum(fit[fit.length-1][0]):0),span=Math.max(1,d1-d0);
    var x=function(d){return pts.length===1&&!fit.length?W/2:5+(dayNum(d)-d0)*(W-10)/span;},y=scaleY(lo,hi,5,H-5),g='';
    if(num(prior)) g+='<line class="st-prior" x1="2" x2="'+(W-2)+'" y1="'+y(prior).toFixed(1)+'" y2="'+y(prior).toFixed(1)+'"/>';
    if(fit.length>1) g+='<path class="st-fc" d="'+fit.map(function(p,i){return (i?'L':'M')+x(p[0]).toFixed(1)+' '+y(p[1]).toFixed(1);}).join(' ')+'"/>';
    if(pts.length>1) g+='<path class="st-trend thin draw" pathLength="1" d="'+pts.map(function(p,i){return (i?'L':'M')+x(p[0]).toFixed(1)+' '+y(p[1]).toFixed(1);}).join(' ')+'"/>';
    pts.forEach(function(p,i){ g+='<circle class="st-dot'+(i===pts.length-1?' last':'')+'" cx="'+x(p[0]).toFixed(1)+'" cy="'+y(p[1]).toFixed(1)+'" r="'+(i===pts.length-1?3.5:2.2)+'"/>'; });
    return '<svg class="st-spark" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" aria-hidden="true">'+g+'</svg>';
  }

  function muscleChart(o){
    // Weekly sets per muscle on a scale with the 4 / 10 / 20 set marks; last week is a thin tick.
    var W=Math.max(260,Math.round(o.width||340)),rows=o.rows,L=118,R=34,RH=26,H=rows.length*RH+22;
    var max=Math.max(22,Math.ceil(Math.max.apply(null,rows.map(function(r){return Math.max(r.sets,r.prev||0);}))+2));
    var x=function(v){return L+v*(W-L-R)/max;},g='';
    g+='<rect class="st-grow" x="'+x(10).toFixed(1)+'" y="2" width="'+(x(20)-x(10)).toFixed(1)+'" height="'+(H-20)+'"/>';
    [4,10,20].forEach(function(v){ g+='<line class="st-mark-line" x1="'+x(v).toFixed(1)+'" x2="'+x(v).toFixed(1)+'" y1="2" y2="'+(H-18)+'"/><text class="st-lbl" x="'+x(v).toFixed(1)+'" y="'+(H-4)+'" text-anchor="middle">'+v+'</text>'; });
    rows.forEach(function(r,i){
      var yy=4+i*RH,wd=r.sets>0?Math.max(3,x(r.sets)-L):0;
      g+='<text class="st-lbl name" x="0" y="'+(yy+14)+'">'+esc(r.name)+'</text>';
      if(wd>0) g+='<rect class="st-mbar '+esc(r.zone)+'" data-i="'+i+'" x="'+L+'" y="'+(yy+3)+'" width="'+wd.toFixed(1)+'" height="14" rx="3"><title>'+esc(r.name)+': '+ru(r.sets)+' подх.</title></rect>';
      if(num(r.prev)&&r.prev>0) g+='<line class="st-prev" x1="'+x(r.prev).toFixed(1)+'" x2="'+x(r.prev).toFixed(1)+'" y1="'+(yy+1)+'" y2="'+(yy+19)+'"/>';
      g+='<text class="st-val" x="'+(W-2)+'" y="'+(yy+14)+'" text-anchor="end">'+ru(r.sets)+'</text>';
    });
    return '<svg class="st-chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(o.label||'Подходы на мышцу за неделю')+'">'+g+'</svg>';
  }

  function typeVolume(o){
    // One small chart per workout type: each session is compared only with the same type.
    var W=Math.max(260,Math.round(o.width||340)),groups=o.groups.filter(function(gr){return gr.data.length;}),n=groups.length;if(!n) return '';
    var gap=12,cw=(W-gap*(n-1))/n,H=128,T=20,B=30,g='';
    groups.forEach(function(gr,j){
      var data=gr.data.slice(-5),ox=j*(cw+gap),max=Math.max.apply(null,data.map(function(d){return d.t;}))*1.15||1,slot=cw/data.length,bw=Math.min(22,slot*0.62);
      var last=data[data.length-1],prev=data[data.length-2];
      g+='<text class="st-lbl strong" x="'+ox.toFixed(1)+'" y="11">'+esc(gr.label)+'</text>';
      if(prev&&prev.t>0){ var ch=Math.round((last.t/prev.t-1)*100); g+='<text class="st-val '+(ch>=0?'up':'down')+'" x="'+(ox+cw).toFixed(1)+'" y="11" text-anchor="end">'+(ch>0?'+':ch<0?'−':'')+Math.abs(ch)+' %</text>'; }
      data.forEach(function(d,i){
        var cx=ox+slot*(i+0.5),h=Math.max(1,d.t/max*(H-B-T));
        g+='<rect class="st-bar'+(i===data.length-1?'':' soft2')+'" data-i="'+i+'" x="'+(cx-bw/2).toFixed(1)+'" y="'+(H-B-h).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3"><title>'+short(d.date)+': '+ru(d.t/1000)+' т</title></rect>';
        if(i===data.length-1||i===0) g+='<text class="st-lbl" x="'+cx.toFixed(1)+'" y="'+(H-B+14)+'" text-anchor="middle">'+short(d.date)+'</text>';
      });
      g+='<text class="st-lbl" x="'+ox.toFixed(1)+'" y="'+(H-4)+'">'+ru(last.t/1000)+' т</text>';
    });
    return '<svg class="st-chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Объём рабочих подходов по типам тренировок">'+g+'</svg>';
  }

  function indexChart(o){
    // Two lines in percent from the start of the cycle: strength up and weight down is a good cut.
    var W=Math.max(260,Math.round(o.width||340)),H=150,L=36,R=10,T=12,B=22,lines=o.lines.filter(function(l){return l.points.length;});if(!lines.length) return '';
    var all=[];lines.forEach(function(l){l.points.forEach(function(p){all.push(p);});});
    var dates=all.map(function(p){return dayNum(p[0]);}),x0=Math.min.apply(null,dates),x1=Math.max(Math.max.apply(null,dates),x0+7);
    var vs=all.map(function(p){return p[1];}).concat([0]),lo=Math.floor(Math.min.apply(null,vs)/2)*2-1,hi=Math.ceil(Math.max.apply(null,vs)/2)*2+1;
    var x=function(n){return L+(n-x0)*(W-L-R)/Math.max(1,x1-x0);},y=scaleY(lo,hi,T,H-B),g='',step=hi-lo>16?5:2;
    for(var v=Math.ceil(lo/step)*step;v<=hi;v+=step) g+='<line class="st-grid'+(v===0?' zero':'')+'" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v).toFixed(1)+'" y2="'+y(v).toFixed(1)+'"/><text class="st-lbl" x="'+(L-5)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end">'+(v>0?'+':v<0?'−':'')+Math.abs(v)+'%</text>';
    lines.forEach(function(l){
      if(l.points.length>1) g+='<path class="'+l.cls+' draw" pathLength="1" d="'+l.points.map(function(p,i){return (i?'L':'M')+x(dayNum(p[0])).toFixed(1)+' '+y(p[1]).toFixed(1);}).join(' ')+'"/>';
      var e=l.points[l.points.length-1];
      g+='<circle class="'+l.cls+'-dot" cx="'+x(dayNum(e[0])).toFixed(1)+'" cy="'+y(e[1]).toFixed(1)+'" r="4"><title>'+esc(l.label)+': '+(e[1]>0?'+':'')+ru(e[1])+' %</title></circle>';
    });
    [x0,x1].forEach(function(n,i){ g+='<text class="st-lbl" x="'+x(n).toFixed(1)+'" y="'+(H-6)+'" text-anchor="'+(i?'end':'start')+'">'+short(dateOf(n))+'</text>'; });
    return '<svg class="st-chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(o.label||'Сила и вес в процентах от начала цикла')+'">'+g+'</svg>';
  }

  function spark(points){
    // Estimated 1RM per session; one point is a dot, two or more a line.
    var W=92,H=28,vals=points.map(function(p){return p[1];}),lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);
    if(hi-lo<1){lo-=1;hi+=1;}
    var x=function(i){return points.length===1?W/2:6+i*(W-12)/(points.length-1);},y=scaleY(lo,hi,4,H-4);
    var g=points.length>1?'<path class="st-trend thin" d="'+points.map(function(p,i){return (i?'L':'M')+x(i).toFixed(1)+' '+y(p[1]).toFixed(1);}).join(' ')+'"/>':'';
    g+='<circle class="st-dot last" cx="'+x(points.length-1).toFixed(1)+'" cy="'+y(vals[vals.length-1]).toFixed(1)+'" r="3.5"/>';
    return '<svg class="st-spark" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" aria-hidden="true">'+g+'</svg>';
  }

  function foodBars(o){
    var W=Math.max(260,Math.round(o.width||340)),rows=o.rows,H=rows.length*40+6,L=58,R=46,g='';
    rows.forEach(function(r,i){
      var yy=4+i*40,w=W-L-R,fw=Math.min(w,w*r.value/r.goal);
      g+='<text class="st-lbl" x="0" y="'+(yy+16)+'">'+esc(r.name)+'</text><rect class="st-bar soft" x="'+L+'" y="'+yy+'" width="'+w+'" height="24" rx="4"/><rect class="st-bar'+(r.value<r.goal*0.9?' low':'')+'" x="'+L+'" y="'+yy+'" width="'+fw.toFixed(1)+'" height="24" rx="4"/>'+
        '<text class="st-in" x="'+(L+8)+'" y="'+(yy+16)+'">'+esc(r.text)+'</text><text class="st-val" x="'+W+'" y="'+(yy+16)+'" text-anchor="end">'+Math.round(r.value/r.goal*100)+' %</text>';
    });
    return '<svg class="st-chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(o.label)+'">'+g+'</svg>';
  }

  function gauge(o){
    // Ratio scale: green up to the goal, neutral to the midpoint, warm above; the marker is the current value.
    var W=Math.max(260,Math.round(o.width||340)),H=34,x=function(v){return 2+(Math.max(o.min,Math.min(o.max,v))-o.min)/(o.max-o.min)*(W-4);},mid=(o.min+o.max)/2;
    var g='<rect class="st-bar" x="2" y="6" width="'+(x(o.good)-2).toFixed(1)+'" height="10" rx="5"/><rect class="st-band" x="'+x(o.good).toFixed(1)+'" y="6" width="'+(x(mid)-x(o.good)).toFixed(1)+'" height="10"/><rect class="st-warm" x="'+x(mid).toFixed(1)+'" y="6" width="'+(W-2-x(mid)).toFixed(1)+'" height="10" rx="5"/>';
    g+='<rect class="st-mark" x="'+(x(o.value)-1.5).toFixed(1)+'" y="1" width="3" height="20" rx="1.5"/>';
    (o.ticks||[]).forEach(function(t,i,a){ g+='<text class="st-lbl" x="'+x(t).toFixed(1)+'" y="'+(H-2)+'" text-anchor="'+(i===0?'start':i===a.length-1?'end':'middle')+'">'+ru(t,2)+'</text>'; });
    return '<svg class="st-chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Талия к росту '+ru(o.value,2)+', цель ниже '+ru(o.good,2)+'">'+g+'</svg>';
  }

  return {gauge:gauge,dayNum:dayNum,addDays:addDays,weightPlan:weightPlan,weeklyAverages:weeklyAverages,trend:trend,
    localFit:localFit,trendLine:trendLine,pace:pace,forecast:forecast,adaptiveWeeks:adaptiveWeeks,weightAdvice:weightAdvice,
    workingSets:workingSets,muscleSets:muscleSets,workingTonnage:workingTonnage,logFit:logFit,strengthIndex:strengthIndex,
    liftChart:liftChart,muscleChart:muscleChart,typeVolume:typeVolume,indexChart:indexChart,
    e1rm:e1rm,tonnage:tonnage,recorded:recorded,dayStatus:dayStatus,weekGoals:weekGoals,
    ring:ring,weightChart:weightChart,barChart:barChart,spark:spark,foodBars:foodBars};
});
