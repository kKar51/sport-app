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

  /* ---------- training ---------- */
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
    rows.push({key:'weight',name:'Вес',value:w&&w.partial!=null?ru(w.partial):'—',sub:w?'коридор '+ru(w.low)+'–'+ru(w.high):'',p:w&&w.partial!=null?(w.partial>w.high?0.6:1):0,ok:!!w&&w.partial!=null&&w.partial<=w.high&&w.partial>=w.low-0.5,unknown:!w||w.partial==null});
    return rows;
  }

  /* ---------- SVG ---------- */
  function ring(row){
    var r=17,c=2*Math.PI*r,len=row.unknown?0:c*row.p;
    return '<div class="st-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="st-ring-track" cx="22" cy="22" r="'+r+'"/>'+(len>0?'<circle class="st-ring-val'+(row.ok?'':' low')+'" cx="22" cy="22" r="'+r+'" stroke-dasharray="'+len.toFixed(1)+' '+c.toFixed(1)+'" transform="rotate(-90 22 22)"/>':'')+'</svg><div><b>'+esc(row.value)+'</b><span>'+esc(row.name+(row.sub?' · '+row.sub:''))+'</span></div></div>';
  }
  function scaleY(lo,hi,top,bottom){ return function(v){return top+(hi-v)*(bottom-top)/(hi-lo);}; }

  function weightChart(o){
    var W=Math.max(260,Math.round(o.width||340)),H=o.range==='cycle'?210:190,L=34,R=8,T=12,B=24;
    var plan=o.plan,series=o.series;if(!plan.length) return '';
    var x0=dayNum(o.range==='cycle'?plan[0].from:addDays(o.today,-13)),x1=o.range==='cycle'?dayNum(plan[plan.length-1].to):dayNum(o.today);
    x0=Math.min(x0,dayNum(series.length?series[0][0]:plan[0].from));
    if(o.range!=='cycle') x0=Math.max(x0,dayNum(o.today)-13);
    var inRange=function(d){var n=dayNum(d);return n>=x0&&n<=x1;};
    var vals=series.filter(function(p){return inRange(p[0]);}).map(function(p){return p[1];});
    plan.forEach(function(w){ if(dayNum(w.to)>=x0&&dayNum(w.from)<=x1){ vals.push(w.low,w.high); } });
    if(!vals.length) return '';
    var lo=Math.floor((Math.min.apply(null,vals)-0.2)*2)/2,hi=Math.ceil((Math.max.apply(null,vals)+0.2)*2)/2;
    var x=function(n){return L+(n-x0)*(W-L-R)/Math.max(1,x1-x0);},y=scaleY(lo,hi,T,H-B),g='';
    var step=hi-lo>3?1:0.5;
    for(var v=lo;v<=hi+1e-9;v+=step) g+='<line class="st-grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v).toFixed(1)+'" y2="'+y(v).toFixed(1)+'"/><text class="st-lbl" x="'+(L-5)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end">'+ru(v)+'</text>';
    plan.forEach(function(w){
      var a=Math.max(dayNum(w.from),x0),b=Math.min(dayNum(w.to)+1,x1+1);if(b<=a) return;
      var cur=o.today>=w.from&&o.today<=w.to;
      g+='<rect class="st-band'+(cur?' now':'')+'" x="'+x(a).toFixed(1)+'" width="'+Math.max(1,x(b)-x(a)-1).toFixed(1)+'" y="'+y(w.high).toFixed(1)+'" height="'+(y(w.low)-y(w.high)).toFixed(1)+'" rx="2"/>';
    });
    var pl=plan.map(function(w){return [dayNum(w.from)+3,w.target];}).filter(function(p){return p[0]>=x0-3&&p[0]<=x1+3;});
    if(pl.length>1) g+='<path class="st-plan" d="'+pl.map(function(p,i){return (i?'L':'M')+x(Math.min(Math.max(p[0],x0),x1)).toFixed(1)+' '+y(p[1]).toFixed(1);}).join(' ')+'"/>';
    var tr=trend(series).filter(function(p){return inRange(p[0]);});
    if(tr.length>1) g+='<path class="st-trend" d="'+tr.map(function(p,i){return (i?'L':'M')+x(dayNum(p[0])).toFixed(1)+' '+y(p[1]).toFixed(1);}).join(' ')+'"/>';
    var pts=series.filter(function(p){return inRange(p[0]);});
    pts.forEach(function(p,i){ var last=i===pts.length-1; g+='<circle class="st-dot'+(last?' last':'')+'" cx="'+x(dayNum(p[0])).toFixed(1)+'" cy="'+y(p[1]).toFixed(1)+'" r="'+(last?4.5:3)+'"><title>'+short(p[0])+': '+ru(p[1])+' кг</title></circle>'; });
    var ticks=o.range==='cycle'?[plan[0].from,plan[Math.min(3,plan.length-1)].from,plan[plan.length-1].to]:[dateOf(x0),dateOf(Math.round((x0+x1)/2)),dateOf(x1)];
    ticks.forEach(function(t,i){ g+='<text class="st-lbl" x="'+x(dayNum(t)).toFixed(1)+'" y="'+(H-6)+'" text-anchor="'+(i===0?'start':i===ticks.length-1?'end':'middle')+'">'+short(t)+'</text>'; });
    var last=plan[plan.length-1];
    if(o.range==='cycle') g+='<text class="st-val" x="'+(W-R)+'" y="'+(y(last.high)-6).toFixed(1)+'" text-anchor="end">'+ru(last.target)+'</text>';
    var label='Вес: '+pts.length+' утренних замеров, коридор недели и план до '+ru(last.target)+' кг к '+short(last.to);
    return '<svg class="st-chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(label)+'">'+g+'</svg>';
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

  function volumeChart(o){
    var W=Math.max(260,Math.round(o.width||340)),H=140,B=34,T=20,data=o.data.slice(-8),n=data.length;if(!n) return '';
    var max=Math.max.apply(null,data.map(function(d){return d.t;}))*1.15||1,slot=W/n,bw=Math.min(64,slot*0.6),g='';
    data.forEach(function(d,i){
      var cx=slot*(i+0.5),h=d.t/max*(H-B-T);
      g+='<rect class="st-bar" x="'+(cx-bw/2).toFixed(1)+'" y="'+(H-B-h).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="4"/>'+
        '<text class="st-val" x="'+cx.toFixed(1)+'" y="'+(H-B-h-6).toFixed(1)+'" text-anchor="middle">'+ru(d.t/1000)+' т</text>'+
        '<text class="st-lbl" x="'+cx.toFixed(1)+'" y="'+(H-B+15)+'" text-anchor="middle">'+short(d.date)+'</text>'+
        '<text class="st-lbl" x="'+cx.toFixed(1)+'" y="'+(H-B+28)+'" text-anchor="middle">'+esc(d.label)+'</text>';
    });
    return '<svg class="st-chart" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Объём за тренировку, тонны">'+g+'</svg>';
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

  return {gauge:gauge,dayNum:dayNum,addDays:addDays,weightPlan:weightPlan,weeklyAverages:weeklyAverages,trend:trend,e1rm:e1rm,tonnage:tonnage,recorded:recorded,dayStatus:dayStatus,weekGoals:weekGoals,
    ring:ring,weightChart:weightChart,barChart:barChart,volumeChart:volumeChart,spark:spark,foodBars:foodBars};
});
