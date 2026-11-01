// Synthetic private Markdown: authenticated pull, read-only navigation and offline reuse.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),key='sport-journal.v1',artifacts=process.env.TEST_ARTIFACT_DIR;
const weekly='weekly/2025-06-01.md',food='food/reviews/2025-05-26_2025-06-01.md';
const note='# Тестовая неделя\n\n**Итог:** три занятия.\n\n- Следующий шаг без спешки.\n\n[Питание](../'+food+')\n\n[Пояснения](../docs/training-guide.md#пример-корпуса)\n\n<script>window.reviewInjected=true</script>\n\n[Опасная ссылка](javascript:alert(1))\n\n![Изображение](https://example.test/private.jpg)\n\n---\n\nТестовая проверка.';
const foodText='# Тестовое питание\n\n| День | Итог |\n|---|---|\n| Понедельник | UNKNOWN |\n\n[Письмо](../../'+weekly+')';
const program={title:'Синтетический цикл',start:'2025-05-26',weeks:8,phases:[{from:1,to:8,key:'main',name:'Работа',hint:''}],schedule:{1:'A',2:'rest',3:'A',4:'rest',5:'A',6:'rest',7:'rest'},sessions:{A:{title:'Тест',items:[]},L:{items:[]},B:{items:[]}}};
const original={'program.json':{sha:'program',data:program},'body/2025-05.json':{sha:'body',data:{weights:{'2025-05-31':70},unknownField:'preserve'}},'workouts/2025-05-31.json':{sha:'workout',data:{date:'2025-05-31',type:'A',sets:{},run:{},note:'Синтетическая запись'}}};
const remote={...original,[weekly]:{sha:'review',text:note},[food]:{sha:'food-review',text:foodText},'docs/training-guide.md':{sha:'guide',text:'# Памятка\n\n## Пример корпуса\n\nКонтролируем движение.'},'photos/private.md':{sha:'excluded',text:'NEVER LOAD THIS'}};
let checks=0;function eq(a,b,msg){assert.deepEqual(a,b,msg);checks++;}function ok(v,msg){assert.ok(v,msg);checks++;}
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(p!==root&&!p.startsWith(root+path.sep))return res.writeHead(403).end();const f=p===root?path.join(root,'index.html'):p;fs.readFile(f,(e,b)=>{if(e)return res.writeHead(404).end();res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'}[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'}).end(b);});});
(async()=>{
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/';const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,timezoneId:'Europe/Moscow',serviceWorkers:'block'}),requests=[],external=[],errors=[];
await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin===new URL(url).origin)return route.continue();if(u.hostname!=='api.github.com'){external.push(u.href);return route.abort();}const method=route.request().method();if(method==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,PUT,OPTIONS','access-control-allow-headers':'*'}});requests.push({method,path:u.pathname});let data;
if(u.pathname.includes('/git/trees/'))data={tree:Object.entries(remote).map(([p,f])=>({type:'blob',path:p,sha:f.sha}))};
else if(u.pathname.includes('/git/blobs/')){const f=Object.values(remote).find(f=>f.sha===u.pathname.split('/').pop());assert(f,'Expected mock blob');data={content:Buffer.from(f.text==null?JSON.stringify(f.data):f.text).toString('base64')};}
else throw new Error('Unexpected API request '+method+' '+u.pathname);
return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedJournal=text;}}}));
await page.addInitScript(({key,files})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({cfg:{owner:'synthetic',repo:'synthetic',branch:'main',token:'synthetic-token'},files,pending:{},lastSync:0,dailyDrafts:{'2025-05-31':{fields:{steps:'123'}}}}));},{key,files:original});
await page.goto(url);await page.waitForFunction(key=>!!JSON.parse(localStorage.getItem(key)).files['weekly/2025-06-01.md'],key);
await page.locator('#tabs [data-tab="reviews"]').click();eq(await page.locator('.review-card').count(),2,'Only reports appear in the list');
await page.locator('[data-act="review-open"][data-path="'+weekly+'"]').click();ok((await page.locator('.review-article').innerText()).includes('три занятия'),'Letter readable');eq(await page.locator('.review-article script,.review-article img').count(),0,'No active HTML or remote images');eq(await page.evaluate(()=>window.reviewInjected),undefined);eq(await page.locator('a[href^="javascript:"]').count(),0);eq(await page.locator('.review-sources').getAttribute('open'),null,'Audit trail starts collapsed');
await page.locator('.review-sources summary').click();ok((await page.locator('.review-sources').innerText()).includes('Тестовая проверка'));
await page.locator('.review-inline-link[data-path="'+food+'"]').click();eq(await page.locator('.review-table table').count(),1);ok((await page.locator('.review-table').innerText()).includes('UNKNOWN'));eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Table does not widen phone page');
await page.locator('.review-inline-link[data-path="'+weekly+'"]').click();await page.locator('.review-inline-link[data-path="docs/training-guide.md"]').click();eq(await page.evaluate(()=>document.activeElement.id),'review-heading-пример-корпуса','Related guide opens at linked heading');
await page.locator('[data-act="review-list"]').click();eq(await page.locator('.review-card').count(),2);
const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);for(const [p,f]of Object.entries(original))eq(stored.files[p],f,'Reading preserves '+p);eq(stored.pending,{});eq(stored.dailyDrafts['2025-05-31'].fields.steps,'123','Daily draft preserved');eq(stored.files[weekly].data.text,note,'Exact Markdown persists');eq(stored.files['photos/private.md'],undefined,'Unrelated private paths not loaded');eq(requests.filter(r=>r.method==='PUT').length,0,'Reading sends no writes');eq(external,[],'Private text causes no third-party fetch');
await page.locator('#gear').click();await page.locator('[data-act="copy"]').click();eq(await page.evaluate(()=>JSON.parse(window.copiedJournal).food),{},'Markdown does not enter monthly food export');await page.locator('#gear').click();
await context.setOffline(true);await page.locator('[data-act="review-open"][data-path="'+weekly+'"]').click();ok((await page.locator('.review-article').innerText()).includes('три занятия'),'Cached report readable offline');await context.setOffline(false);await page.reload();await context.setOffline(true);await page.locator('#tabs [data-tab="reviews"]').click();await page.locator('[data-act="review-open"][data-path="'+weekly+'"]').click();ok((await page.locator('.review-article').innerText()).includes('три занятия'),'Report restored from storage');
for(const width of [320,375,430]){await page.setViewportSize({width,height:812});eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page overflow '+width);}
if(artifacts){fs.mkdirSync(artifacts,{recursive:true});await page.setViewportSize({width:375,height:812});await page.screenshot({path:path.join(artifacts,'synthetic-letter.png'),fullPage:true});}
eq(errors,[],'No script errors');await context.close();
// Empty and missing-file states need no remote token and never fabricate a report.
const empty=await browser.newContext({serviceWorkers:'block'});await empty.addInitScript(({key,program})=>localStorage.setItem(key,JSON.stringify({cfg:{token:''},files:{'program.json':{data:program}},pending:{}})),{key,program});const blank=await empty.newPage();await blank.goto(url);await blank.locator('#tabs [data-tab="reviews"]').click();ok((await blank.locator('#view').innerText()).includes('Разборов пока нет'));await empty.close();
console.log('PASS: '+checks+' review sync, navigation, privacy and offline-storage checks.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
