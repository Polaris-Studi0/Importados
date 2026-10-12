(() => {
  'use strict';
  const groups = [
    {id:'esencia',name:'La marca',eyebrow:'EL PUNTO DE PARTIDA',title:'La esencia de Importados',description:'Una tienda de variedades. Un mundo de posibilidades. Una forma cercana de acompañar cada descubrimiento.',pages:[0,1],tags:['Venta al detal','Medellín + Bello','Tú, cercano y respetuoso']},
    {id:'identidad',name:'Identidad visual',eyebrow:'RECONOCIBLES A PRIMERA VISTA',title:'Así se ve Importados.',description:'Amarillo que invita. Negro que organiza. El contenedor se convierte en un lenguaje visual claro, moderno y propio.',pages:[2,3,4,5,6,7],tags:['Logo','Color','Tipografía','Sistema gráfico']},
    {id:'aplicaciones',name:'En cada formato',eyebrow:'DE LA IDEA A LA PIEZA',title:'La misma marca. En todas partes.',description:'Un sistema que se adapta al feed, a la landing, a una fachada y a una bolsa. El producto siempre conserva el protagonismo.',pages:[8,9,10,11],tags:['Redes','Web','Fotografía','Tienda']},
    {id:'voz',name:'Cómo hablamos',eyebrow:'CERCANÍA CON CRITERIO',title:'Hablar como Importados.',description:'Hablamos de tú, con curiosidad y respeto. Respondemos la duda, damos información clara y proponemos un siguiente paso útil.',pages:[12,13,14],tags:['De tú','Natural','Claro','Sin presión']},
    {id:'atencion',name:'Atención y PQRS',eyebrow:'CADA CONVERSACIÓN CUENTA',title:'Te escuchamos. Te orientamos.',description:'Guiones que ayudan a consultar, visitar y resolver. Una atención cálida se completa con información fiable y seguimiento real.',pages:[15,16,17],tags:['WhatsApp','Atención humana','Casos sensibles','PQRS']},
    {id:'redes',name:'Redes y campañas',eyebrow:'CONTENIDO QUE SÍ ACOMPAÑA',title:'Un feed con mucho por descubrir.',description:'Productos, ideas de uso y personas reales. Una guía para publicar con intención y preparar la apertura de Niquía.',pages:[18,19,20,21,22,26],tags:['Instagram','Calendario editorial','14 y 15 noviembre']},
    {id:'fotografia',name:'Fotos de producto',eyebrow:'DESEABLES Y FIELES',title:'El producto, tal como es.',description:'Luz suave, encuadres claros y detalles que ayudan a elegir. Un método práctico para crear buenas fotos con el celular.',pages:[23,24],tags:['Catálogo','Editorial','Celular','Edición fiel']},
    {id:'operacion',name:'Cuidar la marca',eyebrow:'UNA GUÍA PARA EL EQUIPO',title:'La coherencia se trabaja cada día.',description:'Roles claros, datos vigentes y una revisión sencilla. Aquí está la base para mantener el sistema y aprender de los resultados.',pages:[25,27,28,29],tags:['Revisión','Métricas','Datos de marca','Recursos']}
  ];
  const pages=window.BRAND_PAGES || [];
  const content=document.querySelector('#chapter-content');
  const menu=document.querySelector('#menu-button');
  const navigation=document.querySelector('#navigation');
  const pad=n=>String(n).padStart(2,'0');
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl=s=>/^https:\/\//.test(s)?s:'#';
  const inline=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g,(_,label,url)=>`<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`);
  function markdown(source){
    const lines=source.split('\n');let html='',i=0;
    while(i<lines.length){
      let line=lines[i].trim();if(!line){i++;continue;}
      if(line.startsWith('|')){
        const rows=[];while(i<lines.length&&lines[i].trim().startsWith('|')){
          const row=lines[i++].trim();if(/^\|\s*[-: ]+\|/.test(row))continue;
          rows.push(row.replace(/^\||\|$/g,'').split('|').map(s=>s.trim()));
        }
        html+='<p class="table-hint">Desliza para ver toda la tabla <span aria-hidden="true">→</span></p><div class="table-wrap" tabindex="0" role="region" aria-label="Tabla de referencia con desplazamiento horizontal"><table><thead><tr>'+rows[0].map(cell=>`<th scope="col">${inline(cell)}</th>`).join('')+'</tr></thead><tbody>'+rows.slice(1).map(row=>'<tr>'+row.map(cell=>`<td>${inline(cell)}</td>`).join('')+'</tr>').join('')+'</tbody></table></div>';continue;
      }
      if(line.startsWith('## ')){html+=`<h3>${inline(line.slice(3).replace(/^\d+\s*[·.\-]\s*/,''))}</h3>`;i++;continue;}
      if(line.startsWith('> ')){
        html+='<blockquote>';while(i<lines.length&&lines[i].trim().startsWith('> '))html+=`<p>${inline(lines[i++].trim().slice(2))}</p>`;html+='</blockquote>';continue;
      }
      if(/^(- |\d+\. )/.test(line)){
        const ordered=/^\d+\. /.test(line);const tag=ordered?'ol':'ul';html+=`<${tag}>`;
        while(i<lines.length&&(ordered?/^\d+\. /:/^- /).test(lines[i].trim()))html+=`<li>${inline(lines[i++].trim().replace(/^(- |\d+\. )/,''))}</li>`;
        html+=`</${tag}>`;continue;
      }
      if(/^https:\/\//.test(line))html+=`<p><a href="${esc(line)}" target="_blank" rel="noopener noreferrer">${esc(line)} ↗</a></p>`;
      else html+=`<p>${inline(line)}</p>`;i++;
    }
    return html;
  }
  const logo='<svg viewBox="250 190 1200 510" role="img" aria-label="Logo de Importados"><image href="../assets/logo.png" width="1676" height="939"/></svg>';
  const colors=[['Amarillo','#FFE321','Marcos y foco'],['Negro','#101010','Marca y texto'],['Blanco','#FFFFFF','Lectura y fotos'],['Superficie','#F3F3F0','Fondos de apoyo'],['Texto secundario','#626260','Información de apoyo']];
  function palette(){return '<div class="palette-intro"><p>Selecciona un color para copiar su código HEX.</p></div><div class="swatches">'+colors.map(([name,hex,use])=>`<button class="swatch" data-color="${hex}" aria-label="Copiar color ${name} ${hex}"><span class="swatch-color" style="--swatch:${hex}"></span><span class="swatch-info"><strong>${name}</strong><span>${hex}</span><small>${use}</small></span></button>`).join('')+'</div>';}
  function posters(){return `<div class="format-preview"><div class="poster"><div class="poster-inner"><span class="label">IMPORTADOS · TECNOLOGÍA</span><div class="product-art product-1" role="img" aria-label="Audífonos negros de ejemplo"></div><h3>Tu próximo<br>favorito.</h3></div><p class="preview-label">Descubrimiento</p></div><div class="poster"><div class="poster-inner"><span class="label">IMPORTADOS · DÍA A DÍA</span><div class="product-art product-2" role="img" aria-label="Vaso verde de ejemplo"></div><h3>Para llevar<br>a todas partes.</h3></div><p class="preview-label">Uso cotidiano</p></div><div class="poster poster-opening"><div class="poster-inner corrugated"><span class="label">IMPORTADOS NIQUÍA</span><div class="date">14 y 15<span>noviembre 2026</span></div><p class="place">Dg. 55 AV 33<br>Niquía, Bello</p><span aria-hidden="true">✦</span></div><p class="preview-label" style="color:#bcbcb7">Inauguración</p></div></div><p class="article-caption-note">Composiciones de referencia. Los productos son ilustrativos; para publicar una oferta se necesitan fotos y datos de la referencia real.</p>`;}
  function photos(){return `<div class="photo-preview"><div class="photo-example"><div class="photo-frame"><div class="product-art" role="img" aria-label="Vaso verde sobre fondo limpio de ejemplo"></div></div><strong>Catálogo</strong><p>Fondo limpio. Detalle fiel.</p></div><div class="photo-example"><div class="photo-frame"><img src="../assets/hero.png" alt="Composición editorial de productos sobre fondo amarillo" loading="lazy" width="1254" height="1254"></div><strong>Editorial</strong><p>Color de marca. Contexto.</p></div></div><p class="article-caption-note">Imágenes ilustrativas del prototipo para mostrar los dos lenguajes. No representan inventario confirmado.</p>`;}
  const channels=[
    {name:'WhatsApp',text:'¡Hola! Te ayudamos con ese producto. ¿Lo buscas para Santa Lucía o Niquía?',note:'Una pregunta útil y un siguiente paso. Revisar precio y existencia antes de confirmarlos.'},
    {name:'Instagram',text:'Un favorito para acompañarte en el día a día. Mira sus detalles y pregúntanos por las opciones disponibles.',note:'Invitar a descubrir con un beneficio de uso comprobable y una sola acción.'},
    {name:'PQRS',text:'Gracias por contarnos lo ocurrido. Queremos revisar tu caso y darle seguimiento. Te indicamos el siguiente paso por el canal de atención.',note:'Escuchar, registrar y asignar responsable. La calidez se acompaña con una acción real.'}
  ];
  function voice(){return `<div class="voice-preview"><div class="voice-card"><span class="label">EVITAR</span><p>Estimado cliente, proceda a informar el artículo de su interés.</p><small>Distante y difícil de conversar.</small></div><div class="voice-card good"><span class="label">ASÍ HABLA IMPORTADOS</span><p>¡Hola! ¿Qué producto te llamó la atención? Te ayudamos a conocerlo.</p><small>De tú. Cercano, claro y respetuoso.</small></div></div>`;}
  function channelPreview(){return `<div class="channel-tabs" role="tablist" aria-label="Ejemplos de voz por canal">${channels.map((c,i)=>`<button type="button" id="tab-${i}" role="tab" data-channel="${i}" aria-selected="${i===0}" aria-controls="channel-panel" tabindex="${i===0?0:-1}">${c.name}</button>`).join('')}</div><div class="channel-example" id="channel-panel" role="tabpanel" aria-labelledby="tab-0" tabindex="0"><p>${channels[0].text}</p><small>${channels[0].note}</small></div>`;}
  function facts(){return `<div class="mini-facts"><div class="fact-card"><span class="label">MEDELLÍN</span><h3>Santa Lucía</h3><p>Cr. 87 # 47 DD 50<br>9:00 a. m. a 8:00 p. m.</p><strong>Días y festivos por confirmar</strong></div><div class="fact-card"><span class="label">BELLO</span><h3>Niquía</h3><p>Dg. 55 AV 33<br>Inauguración 14 y 15 noviembre de 2026</p><strong>Horario por confirmar</strong></div></div>`;}
  function resources(){return `<div class="resource-links"><a href="../assets/logo.png" download="Importados-logo-principal.png"><strong>Logo principal</strong><span>PNG suministrado ↓</span></a><a href="assets/fonts/BricolageGrotesque-ExtraBold.ttf" download><strong>Bricolage Grotesque 800</strong><span>Titulares · TTF ↓</span></a><a href="assets/fonts/BricolageGrotesque-Bold.ttf" download><strong>Bricolage Grotesque 700</strong><span>Titulares · TTF ↓</span></a><a href="assets/fonts/Manrope-Variable.ttf" download><strong>Manrope</strong><span>Texto · Fuente variable ↓</span></a><a href="assets/fonts/BricolageGrotesque-OFL.txt" download><strong>Licencia Bricolage</strong><span>OFL · Conservar con la fuente ↓</span></a><a href="assets/fonts/Manrope-OFL.txt" download><strong>Licencia Manrope</strong><span>OFL · Conservar con la fuente ↓</span></a></div><p class="article-caption-note">Para imprimir a gran escala, preparar y validar el maestro vectorial. El PNG conserva el arte suministrado.</p>`;}
  function visual(index,page){
    if(index===5)return palette();
    if(index===6)return `<div class="type-display"><span class="label">BRICOLAGE GROTESQUE · TITULARES</span><p class="display-sample">Pequeñas cosas.<br>Grandes favoritos.</p><span class="label">MANROPE · TEXTO Y CONTROLES</span><p class="body-sample">Información clara, una pregunta útil y un siguiente paso.</p><p class="alphabet">Aa Bb Cc · 0123456789 · á é í ó ú ü ñ</p></div>`;
    if(index===8)return posters();
    if(index===9||index===23)return photos();
    if(index===12)return voice();
    if(index===14)return channelPreview();
    if(index===28)return facts();
    if(index===29)return resources();
    const assets={logo:'logo_principal',protection:'proteccion',misuse:'usos_logo',system:'sistema',physical:'aplicaciones'};
    if(assets[page.asset])return `<figure><img src="assets/figures/${assets[page.asset]}.png" alt="${esc(page.caption)}" loading="lazy"><figcaption>${esc(page.caption)}</figcaption></figure>`;
    return '';
  }
  function closeMenu(){navigation.classList.remove('is-open');menu.setAttribute('aria-expanded','false');document.querySelector('#manual').inert=false;document.body.style.overflow='';}
  const nav=document.querySelector('#chapter-nav');nav.innerHTML=groups.map((g,i)=>`<a class="chapter-link" href="#${g.id}" data-chapter="${g.id}"><span class="nav-number">${pad(i+1)}</span><span>${g.name}</span><span class="nav-arrow" aria-hidden="true">↗</span></a>`).join('');
  let currentGroup='';
  function render(){
    if(location.hash==='#manual'&&currentGroup){closeMenu();document.querySelector('#manual').focus({preventScroll:true});return;}
    const [id,articleId]=location.hash.slice(1).split('/');const groupIndex=Math.max(0,groups.findIndex(g=>g.id===id));const group=groups[groupIndex];
    const wasRendered=Boolean(currentGroup);
    if(currentGroup===group.id&&articleId){document.getElementById(articleId)?.scrollIntoView({behavior:'instant',block:'start'});closeMenu();return;}
    currentGroup=group.id;
    document.title=`${group.name} · Manual de marca Importados`;
    nav.querySelectorAll('a').forEach(a=>{if(a.dataset.chapter===group.id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    document.querySelector('#breadcrumb').textContent=group.eyebrow;document.querySelector('#chapter-count').textContent=`${pad(groupIndex+1)} / ${pad(groups.length)}`;
    let html=groupIndex===0?`<section class="manifesto corrugated"><div><span class="label">MANUAL DE MARCA IMPORTADOS</span><h1>Todo un mundo.<br><span>Una misma<br>marca.</span></h1><p>La guía para que cada pieza, cada foto y cada conversación se sienta Importados.</p></div><div class="manifesto-art">${logo}<div class="manifesto-foot"><span>MEDELLÍN + BELLO</span><span>2026</span></div></div></section><div class="principles"><div class="principle"><span aria-hidden="true">✦</span><h2>Despertar curiosidad</h2><p>Mostrar algo útil, agradable o especial por descubrir.</p></div><div class="principle"><span aria-hidden="true">↗</span><h2>Ayudar a decidir</h2><p>Producto real, datos claros y una acción sencilla.</p></div><div class="principle"><span aria-hidden="true">↔</span><h2>Hablar de cerca</h2><p>De tú, con respeto y sin presionar la compra.</p></div></div>`:`<header class="chapter-heading"><h1>${group.title}</h1><p>${group.description}</p><div class="chapter-tags">${group.tags.map(t=>`<span>${t}</span>`).join('')}</div></header>`;
    html+=`<nav class="chapter-anchors" aria-label="Temas de ${group.name}">${group.pages.map(index=>`<a href="#${group.id}/tema-${index}">${esc(pages[index].title)}</a>`).join('')}</nav>`;
    html+=group.pages.map((index,i)=>{const p=pages[index];return `<article class="article" id="tema-${index}"><header class="article-title"><h2>${esc(p.title)}</h2><span class="article-index">${pad(i+1)} / ${pad(group.pages.length)}</span></header>${visual(index,p)}<div class="article-body">${markdown(p.body)}</div></article>`;}).join('');
    content.innerHTML=html;content.classList.remove('animate-in');requestAnimationFrame(()=>content.classList.add('animate-in'));
    const previous=document.querySelector('#previous-chapter'),next=document.querySelector('#next-chapter');previous.hidden=groupIndex===0;next.hidden=groupIndex===groups.length-1;
    if(groupIndex>0){previous.href='#'+groups[groupIndex-1].id;previous.innerHTML=`<small>← Anterior</small><strong>${groups[groupIndex-1].name}</strong>`;}
    if(groupIndex<groups.length-1){next.href='#'+groups[groupIndex+1].id;next.innerHTML=`<small>Siguiente →</small><strong>${groups[groupIndex+1].name}</strong>`;}
    closeMenu();if(wasRendered)document.querySelector('#manual').focus({preventScroll:true});if(articleId){requestAnimationFrame(()=>document.getElementById(articleId)?.scrollIntoView({behavior:'instant',block:'start'}));}else window.scrollTo({top:0,behavior:'instant'});
  }
  menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';navigation.classList.toggle('is-open',open);menu.setAttribute('aria-expanded',String(open));document.querySelector('#manual').inert=open;document.body.style.overflow=open?'hidden':'';if(open)nav.querySelector('[aria-current=page]')?.focus();});
  nav.addEventListener('click',()=>{if(menu.getAttribute('aria-expanded')==='true'){closeMenu();document.querySelector('#manual').focus({preventScroll:true});}});
  document.addEventListener('keydown',e=>{
    if(menu.getAttribute('aria-expanded')!=='true')return;
    if(e.key==='Escape'){closeMenu();menu.focus();}
    if(e.key==='Tab'){
      const focusable=[document.querySelector('.brand'),menu,...nav.querySelectorAll('a')];
      const first=focusable[0],last=focusable.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  let timer;
  async function copyColor(value){const status=document.querySelector('#copy-status');try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(value);else{const el=document.createElement('textarea');el.value=value;el.style.position='fixed';el.style.opacity='0';document.body.append(el);el.select();const copied=document.execCommand('copy');el.remove();if(!copied)throw new Error('unavailable');}status.textContent=`${value} copiado`;}catch{status.textContent=`Código de color: ${value}. Puedes seleccionarlo y copiarlo.`;}status.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>status.classList.remove('show'),3500);}
  content.addEventListener('click',e=>{const swatch=e.target.closest('[data-color]');if(swatch)copyColor(swatch.dataset.color);const tab=e.target.closest('[data-channel]');if(tab)selectChannel(Number(tab.dataset.channel));});
  function selectChannel(index){const c=channels[index];content.querySelectorAll('[data-channel]').forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});const panel=document.querySelector('#channel-panel');panel.innerHTML=`<p>${c.text}</p><small>${c.note}</small>`;panel.setAttribute('aria-labelledby',`tab-${index}`);}
  content.addEventListener('keydown',e=>{const tab=e.target.closest('[data-channel]');if(!tab)return;let i=Number(tab.dataset.channel);if(e.key==='ArrowRight')i=(i+1)%channels.length;else if(e.key==='ArrowLeft')i=(i+channels.length-1)%channels.length;else if(e.key==='Home')i=0;else if(e.key==='End')i=channels.length-1;else return;e.preventDefault();selectChannel(i);document.querySelector(`#tab-${i}`).focus();});
  window.addEventListener('hashchange',render);window.addEventListener('resize',()=>{if(window.innerWidth>760)closeMenu();});
  if(pages.length===30)render();else content.innerHTML='<div class="article"><h1>El manual no pudo cargarse.</h1><p>Recarga esta página para volver a intentarlo.</p></div>';
})();
