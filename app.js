document.querySelector('.menu-toggle').addEventListener('click',function(){const nav=document.getElementById('mobile-nav');const expanded=this.getAttribute('aria-expanded')==='true';this.setAttribute('aria-expanded',String(!expanded));this.setAttribute('aria-label',expanded?'Abrir menú':'Cerrar menú');nav.hidden=expanded;});
document.querySelectorAll('.mobile-nav a').forEach(a=>a.addEventListener('click',()=>{document.getElementById('mobile-nav').hidden=true;document.querySelector('.menu-toggle').setAttribute('aria-expanded','false');document.querySelector('.menu-toggle').setAttribute('aria-label','Abrir menú');}));
const promotionSection = document.getElementById('promociones');
const blackFriday = document.getElementById('black-friday');
const raffle = document.getElementById('apertura');
const promoBanner = document.querySelector('[data-promo-banner]');

function updatePromotions() {
  const { blackFridayVisible, raffleVisible } = ImportadosDates.promotions();
  const showPromotions = blackFridayVisible || raffleVisible;
  blackFriday.hidden = !blackFridayVisible;
  raffle.hidden = !raffleVisible;
  promotionSection.hidden = !showPromotions;
  promotionSection.classList.toggle('promotions-single', blackFridayVisible !== raffleVisible);

  document.querySelectorAll('[data-promo-link]').forEach(link => { link.hidden = !showPromotions; });
  document.querySelectorAll('[data-raffle-link]').forEach(link => { link.hidden = !raffleVisible; });

  promoBanner.href = blackFridayVisible ? '#black-friday' : raffleVisible ? '#rifa' : '#sedes';
  promoBanner.querySelector('b').textContent = blackFridayVisible
    ? 'Black Friday · 27 al 30 de noviembre'
    : raffleVisible ? 'Rifa de una moto · Sorteo el 24 de diciembre' : 'Encuentra tu sede';
}

updatePromotions();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updatePromotions();
});
setInterval(updatePromotions, 60000);

ImportadosLocations.initFinder();
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
if(!reducedMotion.matches&&'IntersectionObserver' in window){document.documentElement.classList.add('js-motion');const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}});},{threshold:.08,rootMargin:'0px 0px -25px 0px'});document.querySelectorAll('.reveal').forEach(element=>observer.observe(element));reducedMotion.addEventListener('change',event=>{if(event.matches){document.documentElement.classList.remove('js-motion');observer.disconnect();}});}
