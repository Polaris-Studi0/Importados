(function(root){
  const celebration=Date.parse('2026-11-14T00:00:00-05:00');
  const celebrationEnd=Date.parse('2026-11-16T00:00:00-05:00');
  root.ImportadosDates={celebration,celebrationEnd,phase(now=Date.now()){
    return {open:false,celebrating:now>=celebration&&now<celebrationEnd,celebrated:now>=celebrationEnd,
      status:'NIQUÍA · APERTURA MUY PRONTO',
      copy:'Apertura muy pronto.',
      bello:'En Bello, Niquía abrirá muy pronto. Mientras tanto, te esperamos en Santa Lucía.'};
  }};
})(globalThis);
