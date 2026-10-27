(function(root){
  const celebration=Date.parse('2026-11-14T00:00:00-05:00');
  const celebrationEnd=Date.parse('2026-11-16T00:00:00-05:00');
  root.ImportadosDates={celebration,celebrationEnd,phase(now=Date.now()){
    return {open:true,celebrating:now>=celebration&&now<celebrationEnd,celebrated:now>=celebrationEnd,
      status:'NIQUÍA · YA PUEDES VISITARNOS',
      copy:'Ya estamos abiertos.',
      bello:'En Bello, te esperamos en Niquía: Diagonal 55 Av 38-33, edificio Valkiria. Horario: 9:00 a. m. – 8:00 p. m.'};
  }};
})(globalThis);
