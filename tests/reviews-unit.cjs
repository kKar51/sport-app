'use strict';
const assert=require('node:assert/strict');
const R=require('../reviews.js');
let checks=0;
function eq(a,b){assert.deepEqual(a,b);checks++;}
for(const p of ['weekly/2025-06-01.md','food/reviews/2025-05-26_2025-06-01.md','food/reviews/2025-05-26_31.md','docs/training-guide.md'])eq(R.isPath(p),true);
for(const p of ['../weekly/2025-06-01.md','photos/secret.jpg','program.md','docs/private.md','weekly/x.md','weekly/2025-06-01.md/extra','food/reviews/evil.html'])eq(R.isPath(p),false);
const path='weekly/2025-06-01.md',file=text=>({sha:'synthetic',data:R.decode(text)});
eq(R.textOf(file('Текст')), 'Текст');eq(R.textOf({data:{}}),null);
eq(R.list({[path]:file('# Тестовая неделя'),'weekly/2025-05-25.md':file('# Раньше'),'docs/training-guide.md':file('# Справка'),'other.md':file('Игнор')} ).map(x=>x.title),['Тестовая неделя','Раньше']);
eq(R.localPath(path,'../food/reviews/2025-05-26_2025-06-01.md'),'food/reviews/2025-05-26_2025-06-01.md');
eq(R.localPath(path,'../docs/training-guide.md#пример'),'docs/training-guide.md');
for(const url of ['../../weekly/2025-06-01.md','//example.test','javascript:alert(1)','../photos/x.jpg','https://example.test','../weekly/2025-06-01.md?token=x'])eq(R.localPath(path,url),null);
let html=R.markdown('# Заголовок\n\n**Важно** и `код`\n\n- Один\n- Два\n\n1. Шаг\n2. Ещё\n\n> Цитата\n\n| А | Б |\n|---|---|\n| 1 | 2 |\n\n```\n<script>x</script>\n```',path);
for(const token of ['<h2','<strong>Важно</strong>','<code>код</code>','<ul>','<ol>','<blockquote>','<table>','<th scope="col">А</th>','&lt;script&gt;x&lt;/script&gt;'])eq(html.includes(token),true);
html=R.markdown('<img src=x onerror=alert(1)> [плохо](javascript:alert(1)) ![фото](https://example.test/private.jpg) [источник](https://example.test/page) [питание](../food/reviews/2025-05-26_31.md)',path);
eq(html.includes('<img'),false);eq(html.includes('href="javascript:'),false);eq(html.includes('src='),true); // Raw text remains escaped, not an element.
eq(html.includes('target="_blank" rel="noopener noreferrer"'),true);eq(html.includes('data-path="food/reviews/2025-05-26_31.md"'),true);
eq(R.markdown('[кавычки](https://example.test/"bad)',path).includes('href='),false);
const article=R.article(file('# Письмо\n\nГлавное\n\n---\n\nИсточник'),path);
eq(article.title,'Письмо');eq(article.html.includes('<details'),true);eq(article.html.includes('Главное'),true);eq(R.article(null,path),null);
eq(R.markdown('',path),'');eq(R.markdown('## Пример «цели» · сегодня',path).includes('id="review-heading-пример-цели--сегодня"'),true);
console.log('PASS: '+checks+' review parsing, path and safety checks.');
