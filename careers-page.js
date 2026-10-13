document.querySelector('.menu-toggle').addEventListener('click', function () {
  const expanded = this.getAttribute('aria-expanded') === 'true';
  this.setAttribute('aria-expanded', String(!expanded));
  this.setAttribute('aria-label', expanded ? 'Abrir menú' : 'Cerrar menú');
  document.getElementById('mobile-nav').hidden = expanded;
});

document.querySelectorAll('.mobile-nav a').forEach(link => link.addEventListener('click', () => {
  document.getElementById('mobile-nav').hidden = true;
  const toggle = document.querySelector('.menu-toggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Abrir menú');
}));

document.querySelectorAll('a[href="#privacidad-postulaciones"]').forEach(link => link.addEventListener('click', () => {
  document.getElementById('privacidad-postulaciones').open = true;
}));

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if (!reducedMotion.matches && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js-motion');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
  reducedMotion.addEventListener('change', event => {
    if (event.matches) {
      document.documentElement.classList.remove('js-motion');
      observer.disconnect();
    }
  });
}
