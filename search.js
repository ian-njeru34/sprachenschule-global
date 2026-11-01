(() => {
 const publicPages = [
  ['index.html','Home'],['about.html','About the school'],['courses.html','Courses'],['learning-method.html','Learning method'],['admissions.html','Admissions'],['contact.html','Contact'],['faq.html','Frequently asked questions'],['germany-pathways.html','Germany pathways'],['e-learning.html','Online learning'],['blog.html','Blog'],['shop.html','Learning materials shop'],['school.html','Student registration and school area']
 ];
 const params = new URLSearchParams(location.search);
 const q = (params.get('q') || '').trim();
 const input = document.getElementById('pageSearchInput');
 const summary = document.getElementById('searchSummary');
 const results = document.getElementById('searchResults');
 if (input) input.value = q;
 const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const normalize = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 function snippet(text, query) {
   const clean = text.replace(/\s+/g,' ').trim(); const at = normalize(clean).indexOf(normalize(query));
   if (at < 0) return clean.slice(0,190) + (clean.length > 190 ? '…' : '');
   const start = Math.max(0, at-75), end = Math.min(clean.length, at+query.length+115);
   return (start ? '…' : '') + clean.slice(start,end) + (end < clean.length ? '…' : '');
 }
 async function run(){
  if(!q){ summary.textContent='Enter a search term to find publicly available pages on this website.'; return; }
  summary.textContent='Searching website pages…';
  const docs = await Promise.all(publicPages.map(async ([url,title])=>{
    try { const r=await fetch(url); if(!r.ok) return null; const html=await r.text(); const doc=new DOMParser().parseFromString(html,'text/html');
      doc.querySelectorAll('script,style,header,footer,nav,form').forEach(n=>n.remove());
      return {url,title:doc.querySelector('title')?.textContent.trim() || title, text:(doc.querySelector('main')?.textContent || doc.body.textContent || '').replace(/\s+/g,' ').trim()};
    } catch(e){return null;}
  }));
  const terms=normalize(q).split(/\s+/).filter(Boolean);
  const found=docs.filter(Boolean).map(d=>{const hay=normalize(d.title+' '+d.text); const hits=terms.filter(t=>hay.includes(t)).length; return {...d,hits};}).filter(d=>d.hits>0).sort((a,b)=>b.hits-a.hits);
  summary.textContent=found.length ? `${found.length} page${found.length===1?'':'s'} found for “${q}”.` : `No pages found for “${q}”. Try different keywords such as “German”, “courses”, “fees” or “admissions”.`;
  results.innerHTML=found.map(d=>`<article class="search-result"><h2><a href="${esc(d.url)}">${esc(d.title)}</a></h2><p>${esc(snippet(d.text,q))}</p><a class="search-result-url" href="${esc(d.url)}">${esc(d.url)}</a></article>`).join('');
 }
 run();
})();
