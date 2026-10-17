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
equal(St.dayStatus('2026-10-18',null,'rest',today).kind,'rest','Future rest');
equal(St.dayStatus('2026-10-19',null,'A',today).kind,'plan','Future gym is planned');
equal(St.dayStatus(today,null,'run',today).kind,'today','Today not yet done');

const g=St.weekGoals({goals:{gym:3,gymMin:2,runMin:1,runMax:2,steps:8000,sleep:7,protein:140},gym:3,run:1,steps:14454,sleep:6.66,protein:null,weight:weeks[0]});
equal(g.map(r=>r.key),['gym','run','steps','sleep','protein','weight'],'Six weekly goals in order');
equal([g[0].ok,g[1].ok,g[2].ok,g[3].ok],[true,true,true,false],'Gym, run and steps met; sleep short');
ok(g[4].unknown&&g[4].value==='—','Unknown protein stays unknown, not zero');
equal(g[3].value,'6 ч 40','Sleep shown in hours and minutes');
ok(g[5].ok,'Weight inside the corridor');

const svg=St.weightChart({width:343,plan,series,today,range:'cycle'});
ok(svg.startsWith('<svg')&&svg.includes('width="343"'),'Weight chart uses the screen width');
equal((svg.match(/class="st-band/g)||[]).length,8,'Eight weekly corridors on the cycle view');
equal((svg.match(/<circle class="st-dot/g)||[]).length,series.length,'One dot per weigh-in');
ok(!/NaN|undefined/.test(svg),'No broken coordinates');
const two=St.weightChart({width:343,plan,series,today,range:'2w'});
ok(!/NaN|undefined/.test(two)&&(two.match(/class="st-band/g)||[]).length<=3,'Two-week view shows only nearby corridors');
const bars=St.barChart({width:300,data:[['2026-10-11',20649],['2026-10-12',null],['2026-10-13',6000]],goal:8000,label:'Шаги'});
equal((bars.match(/<rect class="st-bar/g)||[]).length,2,'A missing day draws no bar');
ok(bars.includes('st-bar low'),'Below-goal day is highlighted');
ok(!/NaN|undefined/.test(St.gauge({width:300,value:0.5,min:0.4,max:0.6,good:0.45,ticks:[0.4,0.45,0.5,0.6]})),'Gauge renders');
ok(!/NaN|undefined/.test(St.spark([['2026-10-12',76]]))&&!/NaN|undefined/.test(St.spark([['2026-10-12',76],['2026-10-19',80]])),'Sparkline with one and two points');

console.log(`PASS: ${checks} stats checks: weekly weight plan and corridors, averages, trend, 1RM, tonnage, day status, goals, chart output.`);
