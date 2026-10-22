(function(){
  const pages = [
    "index.html","about.html","admissions.html","contact.html","courses.html",
    "e-learning.html","faq.html","germany-pathways.html","learning-method.html",
    "school.html","shop.html"
  ];
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg>';
  const wrap = document.querySelector('.nav-wrap');
  if (!wrap || document.getElementById('siteSearchToggle')) return;
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.id = 'siteSearchToggle'; toggle.className = 'site-search-toggle';
  toggle.setAttribute('aria-label','Open website search'); toggle.setAttribute('aria-expanded','false');
  toggle.innerHTML = icon;
  const actions = wrap.querySelector('.nav-actions');
  if (actions) actions.prepend(toggle); else wrap.insertBefore(toggle, wrap.querySelector('.menu-toggle'));
  const panel = document.createElement('section');
  panel.className = 'site-search-panel'; panel.id = 'siteSearchPanel'; panel.hidden = true;
  panel.setAttribute('aria-label','Search all website pages');
  panel.innerHTML = '<div class="site-search-inner"><form class="site-search-form" role="search"><label class="sr-only" for="siteSearchInput">Search the website</label><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg><input id="siteSearchInput" type="search" placeholder="Search courses, fees, admissions, lessons..." autocomplete="off"><button type="button" class="site-search-close" aria-label="Close search">×</button></form><div class="site-search-hint">Search across all pages of Sprachenschule.</div><div class="site-search-results" id="siteSearchResults" aria-live="polite"></div></div>';
  document.querySelector('.site-header').appendChild(panel);
  const input=panel.querySelector('input'), results=panel.querySelector('.site-search-results');
  let indexPromise;
  function clean(s){return (s||'').replace(/\s+/g,' ').trim();}
  function getIndex(){
    if(indexPromise) return indexPromise;
    indexPromise=Promise.all(pages.map(async file=>{
      try {
        const response=await fetch(file);
        if(!response.ok) return null;
        const raw=await response.text(), doc=new DOMParser().parseFromString(raw,'text/html');
        doc.querySelectorAll('script,style,noscript,svg,header,footer').forEach(n=>n.remove());
        const title=clean(doc.querySelector('title')?.textContent)||file;
        const body=clean(doc.body.textContent);
        const headings=[...doc.querySelectorAll('h1,h2,h3')].map(h=>clean(h.textContent)).filter(Boolean);
        return {file,title,body,headings};
      } catch(e){return null;}
    })).then(items=>items.filter(Boolean));
    return indexPromise;
  }
  function escape(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function excerpt(body, terms){
    const lower=body.toLowerCase(); let at=-1;
    for(const term of terms){const p=lower.indexOf(term);if(p>=0&&(at<0||p<at))at=p;}
    if(at<0) return body.slice(0,150)+(body.length>150?'…':'');
    const start=Math.max(0,at-65), end=Math.min(body.length,at+terms[0].length+105);
    return (start?'…':'')+body.slice(start,end)+(end<body.length?'…':'');
  }
  function render(items, query){
    const terms=query.toLowerCase().split(/\s+/).filter(t=>t.length>1);
    if(!terms.length){results.innerHTML='';return;}
    const ranked=items.map(p=>{
      const text=(p.title+' '+p.body+' '+p.headings.join(' ')).toLowerCase();
      const hits=terms.filter(t=>text.includes(t)).length;
      const titleHits=terms.filter(t=>p.title.toLowerCase().includes(t)).length;
      return {...p,score:hits+titleHits*2,matched:terms.every(t=>text.includes(t))};
    }).filter(p=>p.score>0).sort((a,b)=>b.score-a.score);
    if(!ranked.length){results.innerHTML='<p class="site-search-empty">No matches found. Try different keywords.</p>';return;}
    results.innerHTML=ranked.slice(0,8).map(p=>'<a class="site-search-result" href="'+escape(p.file)+'"><span class="site-search-result-title">'+escape(p.title.replace(/\s*\|\s*Sprachenschule/i,''))+'</span><span class="site-search-result-excerpt">'+escape(excerpt(p.body,terms))+'</span><span class="site-search-result-link">Open page ↗</span></a>').join('');
  }
  toggle.addEventListener('click',()=>{
    const opening=panel.hidden; panel.hidden=!opening; toggle.setAttribute('aria-expanded',String(opening));
    if(opening){input.focus();getIndex().then(items=>{if(input.value.trim())render(items,input.value.trim());});}
  });
  panel.querySelector('.site-search-close').addEventListener('click',()=>{panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();});
  panel.querySelector('form').addEventListener('submit',e=>e.preventDefault());
  let timer;
  input.addEventListener('input',()=>{
    clearTimeout(timer);
    const q=input.value.trim();
    if(!q){results.innerHTML='';return;}
    results.innerHTML='<p class="site-search-loading">Searching all pages…</p>';
    timer=setTimeout(()=>getIndex().then(items=>render(items,q)),120);
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
  document.addEventListener('click',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!toggle.contains(e.target)){panel.hidden=true;toggle.setAttribute('aria-expanded','false');}});
})();