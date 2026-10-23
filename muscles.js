/* Exercise catalog: which muscles an exercise trains and what equipment it uses.
   A primary muscle counts a full set, a secondary one half a set (fractional counting, as in the 2024 volume meta-analysis by Pelland et al.).
   Unknown exercises are matched by name, so a new substitute still lands in the right muscle groups. */
(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.SportMuscles=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  var MUSCLES=[
    {key:'chest_upper',name:'Верх груди',group:'Грудь'},
    {key:'chest',name:'Грудь',group:'Грудь'},
    {key:'front_delt',name:'Передняя дельта',group:'Плечи'},
    {key:'side_delt',name:'Средняя дельта',group:'Плечи'},
    {key:'rear_delt',name:'Задняя дельта',group:'Плечи'},
    {key:'lats',name:'Широчайшие',group:'Спина'},
    {key:'upper_back',name:'Верх спины',group:'Спина'},
    {key:'lower_back',name:'Поясница',group:'Спина'},
    {key:'biceps',name:'Бицепс',group:'Руки'},
    {key:'triceps',name:'Трицепс',group:'Руки'},
    {key:'quads',name:'Квадрицепс',group:'Ноги'},
    {key:'hamstrings',name:'Бицепс бедра',group:'Ноги'},
    {key:'glutes',name:'Ягодицы',group:'Ноги'},
    {key:'calves',name:'Икры',group:'Ноги'},
    {key:'abs',name:'Пресс',group:'Кор'},
    {key:'obliques',name:'Косые, кор',group:'Кор'}
  ];

  // Shared muscle profiles; P = primary, S = secondary.
  var PRESS_FLAT={chest:1,chest_upper:0.5,front_delt:0.5,triceps:0.5};
  var PRESS_INCLINE={chest_upper:1,chest:0.5,front_delt:0.5,triceps:0.5};
  var PRESS_OVERHEAD={front_delt:1,side_delt:0.5,triceps:0.5};
  var PULL_VERTICAL={lats:1,upper_back:0.5,biceps:0.5};
  var ROW={upper_back:1,lats:1,rear_delt:0.5,biceps:0.5};
  var ROW_BENT={upper_back:1,lats:1,rear_delt:0.5,biceps:0.5,lower_back:0.5};
  var SQUAT={quads:1,glutes:1,lower_back:0.5};
  var SQUAT_SUPPORTED={quads:1,glutes:0.5};
  var LUNGE={quads:1,glutes:1};
  var HINGE={hamstrings:1,glutes:1,lower_back:0.5};
  var REAR={rear_delt:1,upper_back:0.5};
  var CORE_ANTI={obliques:1,abs:0.5};

  var CATALOG={
    bench:{m:PRESS_FLAT,eq:'barbell'}, db_bench:{m:PRESS_FLAT,eq:'dumbbell'}, smith_bench:{m:PRESS_FLAT,eq:'smith'}, chest_press:{m:PRESS_FLAT,eq:'machine'},
    pullup:{m:PULL_VERTICAL,eq:'bodyweight'}, wide_pullup:{m:PULL_VERTICAL,eq:'bodyweight'}, assisted_pullup:{m:PULL_VERTICAL,eq:'assisted'},
    pulldown_reverse:{m:PULL_VERTICAL,eq:'cable'}, pulldown_close:{m:PULL_VERTICAL,eq:'cable'}, lat_pulldown:{m:PULL_VERTICAL,eq:'cable'},
    incline_db:{m:PRESS_INCLINE,eq:'dumbbell'}, incline_bb:{m:PRESS_INCLINE,eq:'barbell'}, incline_machine:{m:PRESS_INCLINE,eq:'machine'},
    incline_smith:{m:PRESS_INCLINE,eq:'smith'}, hammer_incline:{m:PRESS_INCLINE,eq:'lever'}, low_high_fly:{m:{chest_upper:1,front_delt:0.5},eq:'cable'},
    bb_row:{m:ROW_BENT,eq:'barbell'}, tbar_row:{m:ROW_BENT,eq:'lever'}, seated_cable_row:{m:ROW,eq:'cable'}, chest_supported_row:{m:ROW,eq:'machine'},
    db_row:{m:ROW,eq:'dumbbell'}, machine_row:{m:ROW,eq:'machine'},
    lat_raise:{m:{side_delt:1},eq:'dumbbell'}, cable_lateral:{m:{side_delt:1},eq:'cable'}, machine_lat_raise:{m:{side_delt:1},eq:'machine'},
    face_pull:{m:REAR,eq:'cable'}, rear_delt_fly:{m:REAR,eq:'dumbbell'}, reverse_pec_deck:{m:REAR,eq:'machine'},
    ohp:{m:PRESS_OVERHEAD,eq:'barbell'}, db_shoulder_press:{m:PRESS_OVERHEAD,eq:'dumbbell'}, machine_shoulder_press:{m:PRESS_OVERHEAD,eq:'machine'}, smith_ohp:{m:PRESS_OVERHEAD,eq:'smith'},
    cable_crunch:{m:{abs:1},eq:'cable'}, decline_crunch:{m:{abs:1},eq:'plate'}, machine_crunch:{m:{abs:1},eq:'machine'},
    reverse_crunch:{m:{abs:1},eq:'bodyweight'}, reverse_crunch_floor:{m:{abs:1},eq:'bodyweight'}, hanging_leg_raise:{m:{abs:1,obliques:0.5},eq:'bodyweight'},
    captain_chair:{m:{abs:1},eq:'bodyweight'}, ab_wheel:{m:{abs:1,lats:0.5},eq:'bodyweight'}, plank:{m:{abs:1,obliques:0.5},eq:'bodyweight'}, dead_bug:{m:{abs:1},eq:'bodyweight'},
    pallof:{m:CORE_ANTI,eq:'cable'}, woodchop:{m:CORE_ANTI,eq:'cable'}, side_plank:{m:CORE_ANTI,eq:'bodyweight'},
    ez_curl:{m:{biceps:1},eq:'ez'}, db_curl:{m:{biceps:1},eq:'dumbbell'}, cable_curl:{m:{biceps:1},eq:'cable'}, preacher_curl:{m:{biceps:1},eq:'machine'},
    hammer_curl:{m:{biceps:1},eq:'dumbbell'}, rope_hammer:{m:{biceps:1},eq:'cable'},
    rope_pushdown:{m:{triceps:1},eq:'cable'}, bar_pushdown:{m:{triceps:1},eq:'cable'}, overhead_ext:{m:{triceps:1},eq:'cable'},
    ez_french:{m:{triceps:1},eq:'ez'}, db_overhead_ext:{m:{triceps:1},eq:'dumbbell'}, dips:{m:{triceps:1,chest:0.5,front_delt:0.5},eq:'bodyweight'},
    squat:{m:SQUAT,eq:'barbell'}, hack_squat:{m:SQUAT_SUPPORTED,eq:'machine'}, leg_press:{m:SQUAT_SUPPORTED,eq:'machine'}, goblet_squat:{m:SQUAT_SUPPORTED,eq:'dumbbell'},
    rdl:{m:HINGE,eq:'barbell'}, db_rdl:{m:HINGE,eq:'dumbbell'}, sl_rdl:{m:{hamstrings:1,glutes:1},eq:'dumbbell'},
    hyperextension:{m:{glutes:1,lower_back:1,hamstrings:0.5},eq:'plate'},
    bulgarian:{m:LUNGE,eq:'dumbbell'}, reverse_lunge:{m:LUNGE,eq:'dumbbell'}, walking_lunge:{m:LUNGE,eq:'dumbbell'}, step_up:{m:LUNGE,eq:'dumbbell'},
    leg_curl:{m:{hamstrings:1},eq:'machine'}, ball_leg_curl:{m:{hamstrings:1},eq:'bodyweight'},
    calf_raise:{m:{calves:1},eq:'machine'}, seated_calf:{m:{calves:1},eq:'machine'}, legpress_calf:{m:{calves:1},eq:'machine'}
  };

  // Name rules for exercises outside the catalog; the first match wins.
  var RULES=[
    [/(жим|хаммер).*наклон|наклон.*(жим|хаммер)|верх груди|снизу вверх/i,PRESS_INCLINE],
    [/жим.*(лёжа|лежа)|бабочк|сведени|отжимания от пола|кроссовер.*груд/i,PRESS_FLAT],
    [/брусь/i,{triceps:1,chest:0.5,front_delt:0.5}],
    [/армейск|жим.*(стоя|сидя|над головой|на плечи)|швунг/i,PRESS_OVERHEAD],
    [/мах|разведени.*стороны/i,{side_delt:1}],
    [/face pull|к лицу|обратн.*(развод|бабочк)|задн.*дельт/i,REAR],
    [/подтяг|верхн.*блок|пуловер/i,PULL_VERTICAL],
    [/тяга.*(наклон|т-гриф|штанг)/i,ROW_BENT],
    [/тяга.*(горизонт|гантел|тренаж|упор|блок)|гребл/i,ROW],
    [/румынск|становая|good morning|наклоны со штангой/i,HINGE],
    [/гиперэкст|разгибани.*спин/i,{glutes:1,lower_back:1,hamstrings:0.5}],
    [/ягодичн.*мост|отведени.*ног/i,{glutes:1,hamstrings:0.5}],
    [/присед|гакк|жим ногами/i,SQUAT_SUPPORTED],
    [/выпад|сплит|зашагив/i,LUNGE],
    [/сгибани.*ног/i,{hamstrings:1}],
    [/разгибани.*ног/i,{quads:1}],
    [/носк|икр/i,{calves:1}],
    [/сгибани|бицепс|молот/i,{biceps:1}],
    [/разгибани|французск|трицепс/i,{triceps:1}],
    [/шраг/i,{upper_back:1}],
    [/скручив|пресс|подъём ног|подъем ног|колен.*вис|планк|ролик/i,{abs:1}],
    [/pallof|дровосек|боков/i,CORE_ANTI]
  ];

  function info(id,name){
    var c=CATALOG[id];
    if(c) return {muscles:c.m,eq:c.eq,known:true};
    for(var i=0;i<RULES.length;i++) if(RULES[i][0].test(String(name||''))) return {muscles:RULES[i][1],eq:null,known:false};
    return {muscles:{},eq:null,known:false};
  }

  // Bars a weight is logged with: the journal stores the total weight, bar included.
  var BARS={barbell:20,ez:10};
  var PLATES=[25,20,15,10,5,2.5,1.25];
  function plates(total,bar){
    if(typeof total!=='number'||!isFinite(total)||typeof bar!=='number'||total<bar) return null;
    var side=Math.round((total-bar)/2*100)/100,out=[];
    for(var i=0;i<PLATES.length&&side>0.001;i++) while(side>=PLATES[i]-0.001){ out.push(PLATES[i]); side=Math.round((side-PLATES[i])*100)/100; }
    return side>0.001?null:out;
  }

  // Weekly hard sets per muscle. At least 10 sets a week grows a muscle better than fewer (Schoenfeld et al. 2017);
  // above ~20 the gain per extra set gets small.
  var ZONES=[{to:4,key:'low',name:'мало'},{to:10,key:'keep',name:'поддержание'},{to:20.5,key:'grow',name:'рост'},{to:Infinity,key:'high',name:'много'}];
  function zone(sets){ for(var i=0;i<ZONES.length;i++) if(sets<ZONES[i].to) return ZONES[i]; return ZONES[ZONES.length-1]; }

  return {MUSCLES:MUSCLES,CATALOG:CATALOG,info:info,BARS:BARS,plates:plates,ZONES:ZONES,zone:zone};
});
