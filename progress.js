(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.SportProgress=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  var DAY=86400000,MAX_DAYS=730;
  var KINDS=['weights','waist','lower','steps','sleep'];
  var MIN_DAY=dayNumber('0001-01-01');
  var MAX_DAY=dayNumber('9999-12-31');

  // Calendar arithmetic uses UTC dates, independent of device timezone and DST.
  function dayNumber(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var parts=value.split('-').map(Number),year=parts[0],month=parts[1],day=parts[2];
    if(year<1||month<1||month>12||day<1||day>31) return null;
    var date=new Date(0);
    date.setUTCFullYear(year,month-1,day); date.setUTCHours(0,0,0,0);
    if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day) return null;
    return Math.floor(date.getTime()/DAY);
  }
  function validDate(value){ return dayNumber(value)!==null; }
  function dateString(day){
    if(!Number.isInteger(day)||day<MIN_DAY||day>MAX_DAY) return null;
    var date=new Date(day*DAY);
    return String(date.getUTCFullYear()).padStart(4,'0')+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-'+String(date.getUTCDate()).padStart(2,'0');
  }
  function addDays(date,amount){
    var day=dayNumber(date);
    return day===null||!Number.isInteger(amount)?null:dateString(day+amount);
  }
  function numeric(value){ return typeof value==='number'&&Number.isFinite(value)&&value>=0; }
  function sourceName(value){
    return typeof value==='string'&&value.trim()?value.trim():'manual';
  }
  function historyFrom(series,today){
    var byDate=Object.create(null);
    (Array.isArray(series)?series:[]).forEach(function(row){
      if(!Array.isArray(row)) return;
      var day=dayNumber(row[0]);
      if(day===null||day>today||!numeric(row[1])) return;
      // A later valid entry wins; an invalid duplicate never erases real data.
      byDate[row[0]]={date:row[0],day:day,value:row[1],source:sourceName(row[2])};
    });
    return Object.keys(byDate).sort().map(function(date){ return byDate[date]; });
  }
  function inRange(history,from,to){
    if(to<MIN_DAY||from>to) return [];
    return history.filter(function(point){ return point.day>=from&&point.day<=to; });
  }
  function mean(points,minimum){
    if(!points.length||points.length<minimum) return null;
    // This also avoids overflowing when finite input values are very large.
    return points.reduce(function(result,point,index){ return result+(point.value-result)/(index+1); },0);
  }
  function difference(a,b){
    if(a===null||b===null) return null;
    var value=a-b;
    return value===0?0:value;
  }
  function goalFor(kind,opts){
    if(kind==='steps'&&numeric(opts.stepsTarget)) return function(value){ return value>=opts.stepsTarget; };
    var target=opts.sleepTarget;
    if(kind==='sleep'&&Array.isArray(target)&&target.length===2&&numeric(target[0])&&numeric(target[1])&&target[0]<=target[1]){
      return function(value){ return value>=target[0]&&value<=target[1]; };
    }
    return null;
  }

  /**
   * Build daily display points without changing input records.
   * count/goalDays describe the selected chart range. Summary fields describe a
   * fixed seven-day window, independently of that range. Steps exclude today
   * from both summary windows and goals; today's chart point is partial.
   * firstDate/lastDate describe all valid history up to today, so stale data can
   * be labelled even when the selected chart contains no measurements.
   */
  function build(kind,series,opts){
    if(KINDS.indexOf(kind)<0) throw new RangeError('Unsupported progress kind');
    opts=opts&&typeof opts==='object'?opts:{};
    var today=dayNumber(opts.today);
    if(today===null) throw new RangeError('Progress today must be a valid YYYY-MM-DD date');
    var period=opts.period===7||opts.period===30||opts.period==='cycle'?opts.period:30;
    var cycle=dayNumber(opts.cycleStart),from;
    if(period==='cycle') from=cycle===null?today-29:Math.min(today,cycle);
    else from=today-period+1;
    from=Math.max(MIN_DAY,today-MAX_DAYS+1,from);

    var history=historyFrom(series,today),byDay=Object.create(null);
    history.forEach(function(point){ byDay[point.day]=point; });
    var points=[];
    for(var day=from;day<=today;day++){
      var actual=byDay[day];
      points.push({
        date:dateString(day),value:actual?actual.value:null,
        average:kind==='weights'?mean(inRange(history,day-6,day),4):null,
        source:actual?actual.source:null,partial:kind==='steps'&&day===today
      });
    }

    var summaryTo=today-(kind==='steps'?1:0),summaryFrom=Math.max(MIN_DAY,summaryTo-6);
    var latest=inRange(history,summaryFrom,summaryTo),previous=inRange(history,summaryTo-13,summaryTo-7);
    var measurement=kind==='waist'||kind==='lower',minimum=kind==='weights'?4:1;
    var latestMean=measurement?null:mean(latest,minimum),previousMean=measurement?null:mean(previous,minimum);
    var comparisonMinimum=kind==='weights'?4:5;
    var delta=!measurement&&latest.length>=comparisonMinimum&&previous.length>=comparisonMinimum?difference(latestMean,previousMean):null;
    var goal=goalFor(kind,opts),known=points.filter(function(point){ return point.value!==null; });
    var goalDays=goal?known.filter(function(point){ return !point.partial&&goal(point.value); }).length:null;
    var summaryGoalDays=goal?latest.filter(function(point){ return goal(point.value); }).length:null;

    var first=history[0]||null,last=history[history.length-1]||null,baseline=null;
    if(measurement&&last){
      var candidates=inRange(history,last.day-35,last.day-21),bestDistance=Infinity;
      candidates.forEach(function(point){
        var distance=Math.abs(point.day-(last.day-28));
        // Sorted ascending: equal distances consistently choose the earlier day.
        if(distance<bestDistance){ baseline=point; bestDistance=distance; }
      });
    }
    var cycleHistory=cycle!==null&&cycle<=today?inRange(history,cycle,today):[];
    var sinceStart=cycleHistory.length>=2?difference(cycleHistory[cycleHistory.length-1].value,cycleHistory[0].value):null;

    return {
      kind:kind,from:dateString(from),to:opts.today,points:points,count:known.length,totalDays:points.length,
      summaryFrom:dateString(summaryFrom),summaryTo:dateString(summaryTo),summaryCount:latest.length,mean:latestMean,
      previousCount:previous.length,previousMean:previousMean,delta:delta,
      goalDays:goalDays,summaryGoalDays:summaryGoalDays,
      change:baseline?difference(last.value,baseline.value):null,changeFrom:baseline?baseline.date:null,
      sinceStart:sinceStart,firstDate:first?first.date:null,lastDate:last?last.date:null
    };
  }
  return {build:build,validDate:validDate,addDays:addDays};
});
