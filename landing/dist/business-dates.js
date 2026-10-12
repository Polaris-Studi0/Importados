(function(root){
  const opening=Date.parse('2026-10-15T00:00:00-05:00');
  const celebration=Date.parse('2026-11-14T00:00:00-05:00');
  const celebrationEnd=Date.parse('2026-11-16T00:00:00-05:00');
  root.ImportadosDates={opening,celebration,celebrationEnd,phase(now=Date.now()){
    return {open:now>=opening,celebrating:now>=celebration&&now<celebrationEnd,celebrated:now>=celebrationEnd,
      status:now>=opening?'NIQUÍA · ABIERTOS DESDE EL 15 DE OCTUBRE':'NIQUÍA ABRE EL 15 DE OCTUBRE',
      copy:now>=opening?'Ya estamos abiertos desde el 15 de octubre.':'Abrimos nuestras puertas el 15 de octubre.',
      bello:now>=opening?'En Bello, ya puedes visitarnos en Niquía desde el 15 de octubre.':'En Bello, abrimos Niquía el 15 de octubre. Hasta entonces, te esperamos en Santa Lucía.'};
  }};
})(globalThis);
