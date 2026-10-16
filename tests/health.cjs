'use strict';
process.env.TZ='Europe/Moscow';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright'),Health=require('../health.js');
const root=path.resolve(__dirname,'..'),key='sport-journal.v1';let checks=0;
const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const ok=(x,message)=>{assert.ok(x,message);checks++;};
const base={format:'sport-health.v1',date:'2026-10-14',source:'Apple Health',steps:8500,sleep:[
  {start:'2026-10-13T22:00:00+03:00',end:'2026-10-14T08:00:00+03:00',state:'In Bed'},
  {start:'2026-10-13T23:00:00+03:00',end:'2026-10-14T07:30:00+03:00',state:'Asleep'},
  {start:'2026-10-13T23:00:00+03:00',end:'2026-10-14T00:00:00+03:00',state:'Базовый'},
  {start:'2026-10-14T00:00:00+03:00',end:'2026-10-14T01:00:00+03:00',state:'Deep'},
  {start:'2026-10-14T07:30:00+03:00',end:'2026-10-14T08:00:00+03:00',state:'Бодрствование'}
]};
const text=x=>JSON.stringify(x),parse=x=>Health.parse(text(x));
equal(parse(base).sleepHours,8.5,'Union avoids counting stages and their parent interval twice');
equal(parse(base).sleepIntervals.length,1,'Before-midnight stages stay with the wake-up day');
equal(parse({...base,sleep:[...base.sleep].reverse()}).sleepIntervals,parse(base).sleepIntervals,'Input order does not affect intervals');
equal(parse({...base,steps:'8\u00a0500'}).steps,8500,'Localized thousands spaces');
equal(parse({...base,steps:0,sleep:[]}).steps,0,'Explicit zero remains zero');
equal(parse({...base,steps:null}).steps,null,'Missing step count is unknown');
equal(parse({...base,sleep:[]}).sleepHours,null,'No sleep records is unknown, not zero');
equal(parse({...base,sleep:[base.sleep[0],base.sleep[4]]}).sleepHours,null,'In-bed/awake records are not sleep');
for(const state of ['Быстрый','REM','Основной','asleep unspecified',1,3,4,5,'3']) equal(parse({...base,sleep:[{...base.sleep[2],state}]}).sleepHours,1,`Asleep category ${state}`);
equal(parse({...base,sleep:[{start:'2026-10-13T11:00:00+03:00',end:'2026-10-13T13:00:00+03:00',state:'Core'},{start:'2026-10-14T11:00:00+03:00',end:'2026-10-14T13:00:00+03:00',state:'REM'}]}).sleepHours,2,'Sleep clipped to noon-to-noon window');
equal(parse({...base,date:'2024-02-29',sleep:[]}).date,'2024-02-29','Valid leap day');
const plain='SPORT_HEALTH_V1\ndate=2026-10-14\nsource=Apple Health\nsteps=8500\nsleep:\n2026-10-13T23:00:00+03:00|2026-10-14T07:30:00+03:00|Спит';
equal(Health.parse(plain).sleepHours,8.5,'Shortcut text format works');
equal(Health.parse(plain.replace('steps=8500','steps=')).steps,null,'Empty step field stays unknown');
const activity=plain.replace('steps=8500','steps=8500\nactiveKcal=612,4\nexerciseMin=47');
equal([Health.parse(activity).activeKcal,Health.parse(activity).exerciseMin],[612,47],'Active energy and exercise minutes are read and rounded');
equal([Health.parse(plain).activeKcal,Health.parse(plain).exerciseMin],[null,null],'Older shortcut text without activity stays unknown');
equal(Health.parse(activity.replace('activeKcal=612,4','activeKcal=')).activeKcal,null,'Empty active energy is unknown, not zero');
equal(parse({...base,steps:null,sleep:[],activeKcal:300}).activeKcal,300,'A day with only activity is accepted');
for(const [input,label] of [
  [{...base,date:'2025-02-29'},'Invalid calendar day'],[{...base,date:'2099-01-01'},'Future date'],
  [{...base,steps:true},'Boolean steps'],[{...base,steps:[]},'Array is not zero steps'],[{...base,steps:-1},'Negative steps'],[{...base,steps:2.5},'Fractional steps'],
  [{...base,steps:'8500 шагов'},'Unconverted quantity'],[{...base,activeKcal:'600 ккал'},'Active energy with unit'],[{...base,exerciseMin:2000},'Exercise minutes beyond a day'],[{...base,steps:null,sleep:[]},'No readings'],
  [{...base,sleep:[{...base.sleep[2],state:'Unrecognized'}]},'Unknown sleep state'],
  [{...base,sleep:[{...base.sleep[2],start:'2026-10-13T23:00:00'}]},'Timezone required'],
  [{...base,sleep:[{...base.sleep[2],end:'2026-10-13T22:00:00+03:00'}]},'Reversed interval']
]){assert.throws(()=>parse(input),undefined,label);checks++;}

const program={title:'Synthetic health test',start:'2026-10-05',weeks:8,phases:[{from:1,to:8,key:'main',name:'Основная',hint:''}],schedule:{1:'A',2:'A',3:'A',4:'A',5:'A',6:'A',7:'rest'},sessions:{A:{title:'Тест',items:[]},L:{title:'Ноги',items:[]},B:{title:'Верх',items:[]}}};
const healthPath='health/2026-10-14.json';
const seed={cfg:{token:''},files:{'program.json':{sha:'synthetic',data:program},'body/2026-10.json':{sha:'manual',data:{weights:{'2026-10-14':80},waist:{},steps:{'2026-10-14':0},sleep:{'2026-10-14':7.2},extraField:'preserve'}},'food/2026-10.json':{sha:'food',data:{days:{},unknown:'preserve'}},[healthPath]:{sha:'existing-import',data:{...parse({...base,steps:5,sleep:[]}),extraField:'preserve'}}},pending:{'food/2026-10.json':1},lastSync:0};
const server=http.createServer((req,res)=>{const name=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname)),file=name===root?path.join(root,'index.html'):name;if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream');res.end(b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Moscow',serviceWorkers:'block'});
  let external=0;await ctx.route('**/*',r=>{if(r.request().url().startsWith(url))return r.continue();external++;return r.abort();});
  await ctx.addInitScript(({key,seed})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(seed));},{key,seed});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-15T12:00:00+03:00')});await page.goto(url);
  const store=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),act=x=>page.locator(`[data-act="${x}"]`);
  async function enter(input){await page.locator('#gear').click();await act('health-open').click();await page.locator('#health-json').fill(input);await act('health-preview').click();}
  await enter(plain);
  equal((await store()).files,seed.files,'Preview does not write data');
  ok(await page.locator('#health-manual-warning').isVisible(),'Preview explains manual priority');
  await act('health-apply').click();let saved=await store();
  equal(saved.files['body/2026-10.json'],seed.files['body/2026-10.json'],'Import never modifies manual data');
  equal(saved.files['food/2026-10.json'],seed.files['food/2026-10.json'],'Unrelated pending file remains intact');
  equal(saved.files[healthPath].data.steps,8500,'Step import stored separately');
  equal(saved.files[healthPath].data.sleepHours,8.5,'Sleep stored separately');
  equal(saved.files[healthPath].data.extraField,'preserve','Unknown import fields survive update');
  equal(Object.keys(saved.pending).sort(),['food/2026-10.json',healthPath].sort(),'Only the import adds a dirty file');
  equal(await page.locator('#in-steps').inputValue(),'0','Manual zero takes priority');
  equal(await page.locator('#in-sleep').inputValue(),'7,2','Manual sleep takes priority');
  const afterFirst=JSON.parse(JSON.stringify(saved));
  await enter(plain);ok(await page.locator('#health-already-imported').isVisible(),'Duplicate detected');await act('health-apply').click();
  equal((await store()).files,afterFirst.files,'Duplicate is an exact no-op, including timestamps');
  await enter(text({...base,steps:9000,sleep:[]}));await act('health-apply').click();saved=await store();
  equal(saved.files[healthPath].data.steps,9000,'New import replaces the step total, never adds it');
  equal(saved.files[healthPath].data.sleepHours,8.5,'Missing sleep does not erase prior import');
  const fallback={...base,date:'2026-10-13',sleep:base.sleep.map(x=>({...x,start:x.start.replace('2026-10-13','2026-10-12').replace('2026-10-14','2026-10-13'),end:x.end.replace('2026-10-13','2026-10-12').replace('2026-10-14','2026-10-13')}))};
  await enter(text(fallback));await act('health-apply').click();
  equal(await page.locator('#in-steps').inputValue(),'8500','Import fills a day without manual steps');
  equal(await page.locator('#in-sleep').inputValue(),'8,5','Import fills a day without manual sleep');
  ok((await page.locator('[data-health-provenance="sleep"]').innerText()).includes('Apple Health'),'Source appears beside imported values');
  await page.locator('#in-sleep').fill('7');await page.locator('#in-sleep').blur();
  equal((await store()).files['body/2026-10.json'].data.sleep['2026-10-13'],7,'User can override an imported value');
  equal((await store()).files['health/2026-10-13.json'].data.sleepHours,8.5,'Manual edit does not alter Health snapshot');
  await page.reload();await enter(text({...base,steps:-1}));
  ok(await page.locator('#health-error').isVisible(),'Invalid input is explained');equal(await act('health-apply').count(),0,'Invalid input cannot be applied');
  const beforeInvalid=await store();await page.locator('#health-json').fill(plain);await act('health-preview').click();
  await page.locator('#health-json').fill(plain+'\nbroken');equal(await act('health-apply').count(),0,'Changing the draft invalidates its preview');
  await act('health-preview').click();equal((await store()).files,beforeInvalid.files,'Invalid draft leaves records intact');
  for(const width of [320,390,844]){await page.setViewportSize({width,height:844});await page.locator('#health-json').fill(plain);await act('health-preview').click();ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`Import screen fits ${width}px`);}
  await page.setViewportSize({width:390,height:844});
  if(process.env.TEST_ARTIFACT_DIR){fs.mkdirSync(process.env.TEST_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TEST_ARTIFACT_DIR,'health-preview.png'),fullPage:true});}
  const guide=await ctx.newPage();await guide.goto(url+'/health-setup.html');
  for(const width of [320,390,844]){await guide.setViewportSize({width,height:844});ok(await guide.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),`Guide fits ${width}px`);}
  equal(external,0,'No clipboard data or sample records leave the local test');equal(errors,[],'No JavaScript errors');
  // A second device receives the separate Health file through the existing GitHub pull.
  const remoteSeed=JSON.parse(JSON.stringify(seed));remoteSeed.cfg={owner:'synthetic',repo:'synthetic',branch:'main',token:'synthetic-not-a-real-token'};remoteSeed.pending={};
  const remoteRecord=parse({...base,date:'2026-10-12',steps:7777,sleep:[]});
  // The iPhone automation uploads raw shortcut text; the journal only reads it.
  const autoText=(date,steps,extra)=>`SPORT_HEALTH_V1\ndate=${date}\nsource=Apple Health\nsteps=${steps}\n${extra||''}sleep:\n`;
  const autoFiles={'health/auto/2026-10-11.txt':autoText('2026-10-11',6543,'activeKcal=612\nexerciseMin=47\n'),'health/auto/2026-10-12.txt':autoText('2026-10-12',1111),'health/auto/2026-10-10.txt':autoText('2026-10-09',2222)};
  const remotePath='health/2026-10-12.json',remoteContext=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Moscow',serviceWorkers:'block'});
  await remoteContext.addInitScript(({key,seed})=>localStorage.setItem(key,JSON.stringify(seed)),{key,seed:remoteSeed});
  let puts=0;await remoteContext.route('**/*',route=>{
    const req=route.request(),u=new URL(req.url());if(req.url().startsWith(url))return route.continue();
    if(u.host!=='api.github.com')return route.abort();
    if(req.method()!=='GET'){puts++;return route.fulfill({status:500,body:'Unexpected write'});}
    if(u.pathname.endsWith('/git/trees/main'))return route.fulfill({json:{tree:[...Object.keys(remoteSeed.files).map(p=>({path:p,type:'blob',sha:remoteSeed.files[p].sha})),{path:remotePath,type:'blob',sha:'remote-health'},...Object.keys(autoFiles).map(p=>({path:p,type:'blob',sha:'auto-'+p.slice(12,22)}))]}});
    if(u.pathname.endsWith('/git/blobs/remote-health'))return route.fulfill({json:{content:Buffer.from(text(remoteRecord)).toString('base64')}});
    const autoPath=Object.keys(autoFiles).find(p=>u.pathname.endsWith('/git/blobs/auto-'+p.slice(12,22)));
    if(autoPath)return route.fulfill({json:{content:Buffer.from(autoFiles[autoPath]).toString('base64')}});
    return route.fulfill({status:404,json:{message:'Not found'}});
  });
  const remotePage=await remoteContext.newPage();await remotePage.clock.install({time:new Date('2026-10-15T12:00:00+03:00')});await remotePage.goto(url);
  // Poll with evaluate: waitForFunction falls back to eval, which the journal's CSP forbids.
  const waitFile=async p=>{for(let i=0;i<100;i++){if(await remotePage.evaluate(({key,p})=>!!JSON.parse(localStorage.getItem(key)).files[p],{key,p}))return;await remotePage.waitForTimeout(100);}throw new Error('File not pulled: '+p);};
  await waitFile(remotePath);
  const received=await remotePage.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  equal(received.files[remotePath].data,remoteRecord,'GitHub pull recognizes the new Health path');
  equal(received.files['body/2026-10.json'],remoteSeed.files['body/2026-10.json'],'Pulling Health leaves manual body records untouched');
  await waitFile('health/auto/2026-10-11.txt');
  // Read the result the way the user sees it: overview of each day, stepping back from 15 October.
  const day=async back=>{await remotePage.locator('#tabs [data-tab=overview]').click();for(let k=0;k<back;k++)await remotePage.locator('[data-act=prev]').first().click();
    const activity=remotePage.locator('#daily-activity');
    return {steps:(await remotePage.locator('#in-steps').inputValue()).replace(/\D/g,''),text:await remotePage.locator('.daily-entry').innerText(),activity:await activity.count()?await activity.innerText():''};};
  let shown=await day(4);
  equal(shown.steps,'6543','Automatic upload fills steps for its day');
  ok(shown.activity.includes('612')&&shown.activity.includes('47 мин'),'Overview shows watch activity for the day');
  ok(shown.text.includes('автоматически'),'Automatic source is labelled');
  await remotePage.reload();shown=await day(3);
  equal(shown.steps,'7777','Confirmed import keeps priority over the automatic upload');
  await remotePage.reload();shown=await day(5);
  equal([shown.steps,shown.activity],['',''],'An automatic file whose date does not match its name is ignored');
  equal(Object.keys((await remotePage.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)).pending),[],'Automatic files never become pending writes');
  equal(puts,0,'Reading remote Health does not queue a write');await remoteContext.close();
  console.log(`PASS: ${checks} Health checks: sleep interval union, missing values, validation, manual priority, duplicates, partial imports, activity, automatic uploads, persistence, mobile layout.`);
  console.log('NOT_RUN: creating/running the shortcut and iOS clipboard permissions on a physical iPhone.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
