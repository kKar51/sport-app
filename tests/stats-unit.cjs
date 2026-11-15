'use strict';
// Progress tab calculations: weight plan, weekly averages, 1RM, tonnage, day status and goals.
const assert=require('node:assert/strict'),St=require('../stats.js');
let checks=0;const equal=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(x,m)=>{assert.ok(x,m);checks++;};

const goal={from:'2026-10-12',base:83.3,perWeek:0.5,band:[-0.3,0.2]};
const plan=St.weightPlan(goal,8);
equal(plan.length,8,'One target per cycle week');
equal([plan[0].target,plan[0].low,plan[0].high],[83.3,83,83.5],'Week 1 is the baseline with its corridor');
equal([plan[1].from,plan[1].to,plan[1].target,plan[1].low,plan[1].high],['2026-10-19','2026-10-25',82.8,82.5,83],'Week 2: −0,5 kg, corridor −0,3…−0,8 from week 1');
equal(plan[7].target,79.8,'Week 8 ends at 79,8');
equal(plan[7].to,'2026-12-06','Last week ends on the last cycle day');
equal(St.weightPlan(null,8),[],'No goal, no plan');
equal(St.weightPlan({...goal,base:'83'},8),[],'Text base is rejected, not guessed');

const series=[['2026-10-12',83.4],['2026-10-13',83.3],['2026-10-14',83.3],['2026-10-15',83.0],['2026-10-16',83.1],['2026-10-19',82.9]];
const weeks=St.weeklyAverages(series,plan);
equal([weeks[0].n,weeks[0].avg,weeks[0].state],[5,83.22,'inside'],'Week average with five weigh-ins');
equal([weeks[1].n,weeks[1].avg,weeks[1].partial],[1,null,82.9],'One weigh-in gives a partial value, not a weekly average');
equal(St.weeklyAverages([['2026-10-12',84],['2026-10-13',84],['2026-10-14',84],['2026-10-15',84]],plan)[0].state,'above','Above the corridor');
equal(St.weeklyAverages([['2026-10-12',82],['2026-10-13',82],['2026-10-14',82],['2026-10-15',82]],plan)[0].state,'below','Below the corridor');

const tr=St.trend([['2026-10-10',83.5],['2026-10-11',83.8],['2026-10-12',83.4],['2026-10-13',83.3],['2026-10-20',82.0]]);
equal(tr,[['2026-10-13',83.5]],'Trend needs four weigh-ins inside seven days');

equal(St.e1rm(60,8),76,'Epley: 60×8 ≈ 76');
equal(St.e1rm(100,1),103.3,'Single rep');
equal(St.e1rm(5,20),null,'Above 15 reps is not estimated');
equal(St.e1rm(null,8),null,'Bodyweight set has no 1RM');
equal(St.e1rm(0,8),null,'Zero weight has no 1RM');

equal(St.tonnage({bench:[{w:60,r:8},{w:60,r:8}],pullup:[{w:null,r:8}],x:[{w:20,r:null}]}),960,'Tonnage counts weighted sets with reps only');
equal(St.tonnage(undefined),0,'No sets');

ok(St.recorded({type:'A',sets:{bench:[{w:60,r:8}]}}),'Sets make a recorded workout');
ok(St.recorded({type:'run',sets:{},run:{min:30}}),'A run with minutes is recorded');
ok(!St.recorded({type:'rest',sets:{},run:{}}),'Rest day with a note is not a workout');
ok(!St.recorded({type:'L',sets:{seated_calf:[{w:null,r:null}]}}),'Empty rows are not a workout');

const today='2026-10-17';
equal(St.dayStatus('2026-10-12',{type:'A',sets:{bench:[{w:60,r:8}]}},'A',today),{kind:'gym',type:'A'},'Done gym day');
equal(St.dayStatus('2026-10-14',{type:'rest',sets:{}},'L',today),{kind:'miss',type:'L'},'Planned legs not done is a miss');
equal(St.dayStatus('2026-10-15',{type:'L',sets:{squat:[{w:70,r:10}]}},'rest',today),{kind:'gym',type:'L'},'Moved session counts on the day it was done');
equal(St.dayStatus('2026-10-17',{type:'B',sets:{},run:{min:40,km:7.7}},'run',today),{kind:'run',type:'run'},'A day with only a run is a run day, whatever type was selected');
equal(St.dayStatus('2026-10-17',{type:'B',sets:{ohp:[{w:35,r:10}]},run:{min:20}},'B',today),{kind:'gym',type:'B'},'Sets plus a run stay a gym day');
equal(St.dayStatus('2026-10-18',null,'rest',today).kind,'rest','Future rest');
equal(St.dayStatus('2026-10-19',null,'A',today).kind,'plan','Future gym is planned');
equal(St.dayStatus(today,null,'run',today).kind,'today','Today not yet done');

const g=St.weekGoals({goals:{gym:3,gymMin:2,runMin:1,runMax:2,steps:8000,sleep:7,protein:140},gym:3,run:1,steps:14454,sleep:6.66,protein:null,weight:weeks[0]});
equal(g.map(r=>r.key),['gym','run','steps','sleep','protein','weight'],'Six weekly goals in order');
equal([g[0].ok,g[1].ok,g[2].ok,g[3].ok],[true,true,true,false],'Gym, run and steps met; sleep short');
ok(g[4].unknown&&g[4].value==='—','Unknown protein stays unknown, not zero');
equal(g[3].value,'6 ч 40','Sleep shown in hours and minutes');
ok(g[5].ok,'Weight inside the corridor');
ok(!St.weekGoals({goals:{},gym:0,run:0,steps:null,sleep:null,protein:null,weight:{partial:81,low:82,high:82.5}})[5].ok,'Below the corridor is not shown as met');

// Adaptive weeks: each week aims at last week's real average minus the pace.
const real=[['2026-10-12',83.4],['2026-10-13',83.3],['2026-10-14',83.3],['2026-10-15',83.0],['2026-10-16',83.1],['2026-10-17',82.7],['2026-10-18',82.6],
  ['2026-10-19',82.4],['2026-10-20',82.1],['2026-10-21',81.7],['2026-10-22',82.0]];
const aw=St.adaptiveWeeks(real,goal,8);
equal([aw[0].target,aw[0].avg,aw[0].state,aw[0].basis],[83.3,83.06,'inside','start'],'Week 1 starts from the base');
equal([aw[1].target,aw[1].low,aw[1].high,aw[1].basis],[82.56,82.26,82.76,'actual'],'Week 2 target = week 1 average − 0,5');
equal([aw[1].avg,aw[1].state],[82.05,'below'],'Week 2 is faster than the corridor');
equal(St.weightAdvice(aw,2,0.5).kind,'below','Faster than planned → eat a little more');
const early=St.adaptiveWeeks(real.slice(0,9),goal,8);
equal([early[1].n,St.weightAdvice(early,2,0.5).kind],[2,'none'],'Two weigh-ins in a week give no calorie advice yet');
const sparse=St.adaptiveWeeks([['2026-10-12',83.4],['2026-10-19',82.9]],goal,3);
equal([sparse[1].target,sparse[1].basis,sparse[2].target],[82.8,'plan',82.3],'Without four weigh-ins the chain continues from targets');
equal(St.adaptiveWeeks(real,{...goal,perWeek:0},2)[1].target,83.06,'Pace 0 holds the average of last week');
equal(St.adaptiveWeeks(real,{...goal,perWeek:-0.25},2)[1].target,83.31,'Negative pace is a gain');

const pc=St.pace(real,'2026-10-23');
ok(pc&&pc.perWeek<-0.8&&pc.perWeek>-1.6,'Pace from three weeks of weigh-ins is about −1,2 kg/week');
equal(St.pace(real.slice(0,4),'2026-10-23'),null,'Fewer than five weigh-ins give no pace');
const fc=St.forecast(pc,'2026-10-30');
equal(fc.length,9,'Forecast runs day by day to one week after today');
ok(fc.every(p=>p[2]<p[1]&&p[1]<p[3]),'Forecast band surrounds the line');
ok(fc[fc.length-1][3]-fc[fc.length-1][2]>fc[0][3]-fc[0][2],'Band widens further out');
const tl=St.trendLine(real,'2026-10-01','2026-10-30',3.5);
equal([tl[0][0],tl[tl.length-1][0],tl.length],['2026-10-12','2026-10-22',11],'Trend covers the days between the first and last weigh-in');
ok(tl.every((p,i)=>!i||p[1]<=tl[i-1][1]+0.05),'Trend of a steady loss goes down without jumps');

const svg=St.weightChart({width:343,series:real,weeks:aw,today:'2026-10-23',range:'cycle',trend:tl,forecast:fc});
ok(svg.startsWith('<svg')&&svg.includes('width="343"'),'Weight chart uses the screen width');
equal((svg.match(/class="st-band/g)||[]).length,3,'Corridors only for past weeks, this week and the next one');
ok(svg.includes('st-band now')&&svg.includes('st-band next'),'This week and the next one are marked');
equal((svg.match(/<circle class="st-dot/g)||[]).length,real.length,'One dot per weigh-in');
ok(svg.includes('st-cone')&&svg.includes('≈'),'Forecast band with its end value');
ok(!/NaN|undefined/.test(svg),'No broken coordinates');
ok(/data-x1="\d+"/.test(svg),'Chart carries its day range for taps');
const two=St.weightChart({width:343,series:real,weeks:aw,today:'2026-10-23',range:'2w',trend:tl,forecast:fc});
ok(!/NaN|undefined/.test(two)&&(two.match(/<circle class="st-dot/g)||[]).length===real.filter(p=>p[0]>='2026-10-10').length,'Two-week view');
// History is not cut by a new cycle: weigh-ins before the current weeks stay on the "all" view, a new cycle is a marker.
const before=[['2026-09-20',85],['2026-09-27',84.5]].concat(real);
const all=St.weightChart({width:343,series:before,weeks:aw,today:'2026-10-23',range:'all',trend:tl,forecast:fc,marks:[{date:'2026-10-12',label:'цикл 2'}]});
equal((all.match(/<circle class="st-dot/g)||[]).length,before.length,'All-time view keeps weigh-ins from before the cycle');
ok(all.includes('st-cycle-mark')&&all.includes('цикл 2'),'Cycle start is drawn as a marker');
const four=St.weightChart({width:343,series:before,weeks:aw,today:'2026-10-23',range:'4w',trend:tl,forecast:fc});
equal((four.match(/<circle class="st-dot/g)||[]).length,before.filter(p=>p[0]>='2026-09-26').length,'Four-week view counts back 28 days from today');

// Working sets, muscles and strength curve.
equal(St.workingSets([{w:40,r:15},{w:60,r:10},{w:70,r:8},{w:70,r:null}]),[{w:60,r:10},{w:70,r:8}],'Warm-up under 70 % and empty rows are left out');
equal(St.workingSets([{w:30,r:8},{w:40,r:5}],true).length,2,'Assisted sets are all kept');
equal(St.workingSets([{w:0,r:9},{w:0,r:7}]).length,2,'Bodyweight sets count');
const M=require('../muscles.js');
const ms=St.muscleSets([{bench:[{w:40,r:15},{w:60,r:10},{w:70,r:8}],ez_curl:[{w:28,r:10}]}],id=>M.info(id));
equal([ms.chest,ms.chest_upper,ms.triceps,ms.biceps],[2,1,1,1],'Bench: 2 working sets → chest 2, upper chest and triceps 1; curl → biceps 1');
equal(M.info('x_unknown','Жим гантелей на наклонной скамье').muscles.chest_upper,1,'Unknown exercise is matched by name');
equal(M.plates(70,20),[25],'70 kg on a 20 kg bar is 25 per side');
equal(M.plates(62.5,20),[20,1.25],'62,5 kg: 20 + 1,25 per side');
equal(M.plates(15,20),null,'Lighter than the bar is not a barbell load');
equal([M.zone(3).key,M.zone(10).key,M.zone(20).key,M.zone(21).key],['low','grow','grow','high'],'Volume zones');
equal(St.workingTonnage({bench:[{w:40,r:15},{w:60,r:10}],assisted_pullup:[{w:30,r:8}]},id=>id==='assisted_pullup'),600,'Tonnage of working sets without counterweight exercises');
const lf=St.logFit([['2026-10-12',76],['2026-10-19',86.7],['2026-10-26',90]]);
ok(lf&&lf.at('2026-11-09')>90&&lf.at('2026-11-09')<100,'Log curve keeps growing but slower');
equal(St.logFit([['2026-10-12',76],['2026-10-19',86.7]]),null,'Two sessions are not enough for a curve');
equal(St.strengthIndex([[['2026-10-12',76],['2026-10-19',88]],[['2026-10-15',80],['2026-10-21',76]]]).map(p=>p[1]),[0,0,7.9,5.4],'Strength index averages each lift against its own start');
ok(!/NaN|undefined/.test(St.liftChart({points:[['2026-10-12',76]],prior:96}))&&!/NaN|undefined/.test(St.liftChart({points:[['2026-10-12',76],['2026-10-19',88]],fit:[['2026-10-12',76],['2026-11-02',95]],prior:96})),'Lift chart with one or more sessions');
ok(!/NaN|undefined/.test(St.muscleChart({rows:[{name:'Грудь',sets:4,prev:2,zone:'keep'},{name:'Икры',sets:0,prev:3,zone:'low'}]})),'Muscle chart');
ok(!/NaN|undefined/.test(St.typeVolume({groups:[{label:'Верх A',data:[{date:'2026-10-12',t:3000},{date:'2026-10-19',t:3600}]},{label:'Ноги',data:[{date:'2026-10-15',t:4000}]}]})),'Volume by workout type');
const bars=St.barChart({width:300,data:[['2026-10-11',20649],['2026-10-12',null],['2026-10-13',6000]],goal:8000,label:'Шаги'});
equal((bars.match(/<rect class="st-bar/g)||[]).length,2,'A missing day draws no bar');
ok(bars.includes('st-bar low'),'Below-goal day is highlighted');
ok(!/NaN|undefined/.test(St.gauge({width:300,value:0.5,min:0.4,max:0.6,good:0.45,ticks:[0.4,0.45,0.5,0.6]})),'Gauge renders');
ok(!/NaN|undefined/.test(St.spark([['2026-10-12',76]]))&&!/NaN|undefined/.test(St.spark([['2026-10-12',76],['2026-10-19',80]])),'Sparkline with one and two points');

// Weekly answers for the progress cards (synthetic numbers).
equal(St.weekStart('2026-11-15'),'2026-11-09','Sunday belongs to the week that started on Monday');
equal(St.weekStart('2026-11-09'),'2026-11-09','Monday starts its own week');
const wcs=[['2026-11-02',80],['2026-11-03',80],['2026-11-04',80],['2026-11-05',80],['2026-11-09',79],['2026-11-10',79.1],['2026-11-11',78.9],['2026-11-12',79]];
const wc=St.weekChange(wcs,'2026-11-15',{perWeek:0.5,band:[-0.3,0.2]});
equal([wc.avg,wc.prevAvg,wc.change,wc.shown,wc.state],[79,80,-1,-1,'faster'],'A kilo in a week at pace 0,5 is faster than the zone');
equal(wc.zone,[-0.8,-0.3],'Pace 0,5 gives the zone −0,8…−0,3');
const wcIn=St.weekChange([['2026-11-02',80],['2026-11-03',80],['2026-11-04',80],['2026-11-05',80],['2026-11-09',79.16],['2026-11-10',79.16],['2026-11-11',79.16],['2026-11-12',79.16]],'2026-11-15',{perWeek:0.5,band:[-0.3,0.2]});
equal([wcIn.shown,wcIn.state],[-0.8,'inside'],'−0,84 shows as −0,8 and is inside, so label and digits agree');
const wcFew=St.weekChange(wcs.slice(0,7),'2026-11-15',{perWeek:0.5});
equal([wcFew.n,wcFew.change,wcFew.state],[3,null,null],'Three weigh-ins this week: no change and no verdict');
equal(St.weekChange(wcs,'2026-11-10',{perWeek:0.5}).n,2,'Days after today are not counted');
equal(St.weekChange([],'2026-11-15',null).avg,null,'No weigh-ins, no average');
const wk=[{from:'2026-10-12',n:3},{from:'2026-10-19',n:3},{from:'2026-10-26',n:1},{from:'2026-11-02',n:2},{from:'2026-11-09',n:3}];
equal(St.streak(wk,'2026-11-15',2),2,'A week with one training ends the streak');
equal(St.streak([...wk.slice(0,4),{from:'2026-11-09',n:1}],'2026-11-11',2),1,'An unfinished current week below the minimum does not break the streak');
equal(St.streak([{from:'2026-11-09',n:0}],'2026-11-11',2),0,'No full weeks yet');

console.log(`PASS: ${checks} stats checks: weekly weight plan and corridors, averages, trend, 1RM, tonnage, day status, goals, chart output.`);
