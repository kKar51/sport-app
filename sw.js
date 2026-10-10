// Offline shell for the journal. GitHub API calls are never cached.
var CACHE='sport-journal-v2';
var SHELL=['./','index.html','app.css','app.js','manifest.webmanifest','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png'];

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

// Network first with a short timeout, so a weak gym signal still opens the app quickly.
function networkFirst(req){
  return new Promise(function(resolve){
    var settled=false;
    var fromCache=function(){ return caches.match(req,{ignoreSearch:true}).then(function(r){ return r||(req.mode==='navigate'?caches.match('index.html'):null); }); };
    var timer=setTimeout(function(){ fromCache().then(function(r){ if(r&&!settled){ settled=true; resolve(r); } }); },2500);
    fetch(req).then(function(res){
      if(res&&res.ok){ var copy=res.clone(); caches.open(CACHE).then(function(c){ c.put(req,copy); }); }
      if(!settled){ settled=true; clearTimeout(timer); resolve(res); }
    }).catch(function(){
      fromCache().then(function(r){ if(!settled){ settled=true; clearTimeout(timer); resolve(r||Response.error()); } });
    });
  });
}

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET') return;
  var url=new URL(req.url);
  if(url.origin===self.location.origin||url.host==='fonts.googleapis.com'||url.host==='fonts.gstatic.com'){
    e.respondWith(networkFirst(req));
  }
});
