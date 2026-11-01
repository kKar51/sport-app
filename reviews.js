(function(root,factory){
'use strict';
if(typeof module==='object'&&module.exports) module.exports=factory();
else root.SportReviews=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';
var FORMAT='sport-review.markdown';
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function isPath(p){ return typeof p==='string'&&/^(weekly\/\d{4}-\d{2}-\d{2}\.md|food\/reviews\/\d{4}-\d{2}-\d{2}(?:_(?:\d{4}-\d{2}-)?\d{2})?\.md|docs\/training-guide\.md)$/.test(p); }
function decode(text){ return {format:FORMAT,text:String(text)}; }
function textOf(file){ var d=file&&file.data; return d&&d.format===FORMAT&&typeof d.text==='string'?d.text:null; }
function title(text,fallback){ var m=String(text).match(/^#\s+(.+)\s*$/m); return m?m[1].replace(/\*\*|`/g,''):fallback; }
function kind(p){ return p.indexOf('weekly/')===0?'Неделя':p.indexOf('food/reviews/')===0?'Питание':'Памятка'; }
function headingId(s){ return 'review-heading-'+String(s).toLowerCase().trim().replace(/[^\w\u0400-\u04ff -]/g,'').replace(/ /g,'-'); }
function list(files){
  return Object.keys(files||{}).filter(function(p){return isPath(p)&&p.indexOf('docs/')!==0&&textOf(files[p])!=null;}).map(function(p){
    var text=textOf(files[p]),date=p.match(/\d{4}-\d{2}-\d{2}/)[0];
    return {path:p,date:date,kind:kind(p),title:title(text,kind(p)+' · '+date)};
  }).sort(function(a,b){return b.date.localeCompare(a.date)||a.path.localeCompare(b.path);});
}
function localPath(from,url){
  if(!url||/[\s\\\x00-\x1f\x7f]/.test(url)||/^[a-z][a-z0-9+.-]*:/i.test(url)||url.charAt(0)==='/') return null;
  var raw=url.split('#')[0];if(!raw)return null;
  var parts=from.split('/');parts.pop();var good=true;
  raw.split('/').forEach(function(p){if(p==='..'){if(!parts.length)good=false;else parts.pop();}else if(p&&p!=='.')parts.push(p);});
  var path=parts.join('/');return good&&isPath(path)?path:null;
}
// Escape every token. Raw HTML, images and arbitrary local URLs never become markup.
function inline(text,from){
  var re=/(`[^`\n]+`|!?\[[^\]\n]+\]\([^\s)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g,out='',at=0,m;
  while((m=re.exec(text))){
    out+=esc(text.slice(at,m.index));var s=m[0];
    if(s.charAt(0)==='`')out+='<code>'+esc(s.slice(1,-1))+'</code>';
    else if(s.slice(0,2)==='**')out+='<strong>'+esc(s.slice(2,-2))+'</strong>';
    else if(s.charAt(0)==='*')out+='<em>'+esc(s.slice(1,-1))+'</em>';
    else{
      var link=s.match(/^(!?)\[([^\]]+)\]\(([^)]+)\)$/),label=esc(link[2]),url=link[3],local=localPath(from,url);
      if(link[1])out+=label;
      else if(local)out+='<button type="button" class="review-inline-link" data-act="review-open" data-path="'+esc(local)+'" data-anchor="'+esc(url.split('#')[1]||'')+'">'+label+'</button>';
      else if(/^https:\/\/[^\s<>"'\\]+$/i.test(url))out+='<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>';
      else out+=label;
    }
    at=re.lastIndex;
  }
  return out+esc(text.slice(at));
}
function cells(s){ return s.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(function(x){return x.trim();}); }
function tableRule(s){ var a=cells(s);return a.length>0&&a.every(function(x){return /^:?-{3,}:?$/.test(x);}); }
function markdown(text,from){
  var lines=String(text||'').replace(/\r\n?/g,'\n').split('\n'),h='',i=0;
  function special(n){var s=lines[n]||'';return !s.trim()||/^\s*(#{1,6}\s|```|[-*+]\s|\d+\.\s|>\s?|---+\s*$)/.test(s)||(n+1<lines.length&&s.indexOf('|')>=0&&tableRule(lines[n+1]));}
  while(i<lines.length){
    var s=lines[i];if(!s.trim()){i++;continue;}
    if(/^\s*```/.test(s)){var code=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i++]);if(i<lines.length)i++;h+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';continue;}
    if(i+1<lines.length&&s.indexOf('|')>=0&&tableRule(lines[i+1])){
      var headers=cells(s);h+='<div class="review-table" role="region" aria-label="Таблица разбора" tabindex="0"><table><thead><tr>'+headers.map(function(c){return '<th scope="col">'+inline(c,from)+'</th>';}).join('')+'</tr></thead><tbody>';i+=2;
      while(i<lines.length&&lines[i].trim()&&lines[i].indexOf('|')>=0){var row=cells(lines[i++]);h+='<tr>'+headers.map(function(c,n){return '<td>'+inline(row[n]||'',from)+'</td>';}).join('')+'</tr>';}
      h+='</tbody></table></div>';continue;
    }
    var heading=s.match(/^\s*(#{1,6})\s+(.+)$/);if(heading){var level=Math.min(6,Math.max(2,heading[1].length+1));h+='<h'+level+' id="'+esc(headingId(heading[2]))+'" tabindex="-1">'+inline(heading[2],from)+'</h'+level+'>';i++;continue;}
    if(/^\s*---+\s*$/.test(s)){h+='<hr>';i++;continue;}
    var li=s.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);if(li){var ordered=/\d/.test(li[1]),tag=ordered?'ol':'ul';h+='<'+tag+'>';while(i<lines.length&&(li=lines[i].match(/^\s*([-*+]|\d+\.)\s+(.+)$/))&&/\d/.test(li[1])===ordered){h+='<li>'+inline(li[2],from)+'</li>';i++;}h+='</'+tag+'>';continue;}
    if(/^\s*>/.test(s)){var quote=[];while(i<lines.length&&/^\s*>/.test(lines[i]))quote.push(lines[i++].replace(/^\s*>\s?/,''));h+='<blockquote>'+inline(quote.join(' '),from)+'</blockquote>';continue;}
    var paragraph=[s];i++;while(i<lines.length&&!special(i))paragraph.push(lines[i++]);h+='<p>'+inline(paragraph.join(' '),from)+'</p>';
  }
  return h;
}
function article(file,path){
  var text=textOf(file);if(text==null)return null;
  var name=title(text,kind(path)),body=text.replace(/^#\s+[^\n]*\n?/,'');
  // Keep the audit trail available without interrupting a weekly letter.
  var split=path.indexOf('weekly/')===0?body.search(/^---\s*$/m):-1;
  var html=split<0?markdown(body,path):markdown(body.slice(0,split),path)+'<details class="review-sources"><summary>Источники и проверка</summary>'+markdown(body.slice(split).replace(/^---\s*\n?/,''),path)+'</details>';
  return {title:name,kind:kind(path),html:html};
}
return {isPath:isPath,decode:decode,textOf:textOf,list:list,localPath:localPath,markdown:markdown,article:article};
});
