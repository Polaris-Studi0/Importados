// Operational follow-ups are not long-term shopping memory. A new session still
// asks the customer to confirm the branch before resuming an outstanding case.
export function isAttentionFollowup(value){
  const text=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return /^[?¿\s]+$/.test(text)||/sigo esperando|aun espero|me (?:dejaron|tienen) esperando|no (?:me )?(?:han )?(?:respondido|responden|contestan)|cuantos? dias (?:mas|hay que esperar|tengo que esperar|debo esperar|para (?:una|la) respuesta)|(?:otros?|mas) (?:dos|tres|\d+) dias|(?:dos|tres|\d+) dias (?:mas|esperando)|(?:la |una )?respuesta pendiente|alguna (?:respuesta|novedad)|que (?:groseria|falta de respeto)|insolentes?|p[eé]sima atenci[oó]n|disque/.test(text);
}
export function pendingNeedsReview(tasks,now=Date.now()){
  return !!tasks?.some(t=>['high','urgent'].includes(t.priority)||Number.isFinite(Date.parse(t.created_at))&&now-Date.parse(t.created_at)>=15*60000);
}
export function safeAttentionReply(snapshot,generated,reason){
  const original=String(generated||'').trim();
  const value=original.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  // Keep the model's useful conversation. Only replace explicit false claims
  // and acceptance of a prolonged wait; requesting an approval is allowed.
  const unsafe=/podemos esperar|(?:espera|esperar|espere|esperes) (?:otros? |hasta |unos? )?(?:dos|tres|\d+) dias|(?:voy a|te voy a|vamos a) (?:generar|emitir|enviar) (?:la |las |tu |tus )?facturas?|te (?:genero|emito) (?:la |las )?facturas?|ya (?:avise|avisamos|notifique|notificamos|contacte|contactamos)|(?:el pago|tu pago) (?:ya )?(?:esta|quedo) aprobado|(?:ya (?:genere|generamos|envie|enviamos)|(?:factura|documento).*ya esta (?:list[oa]|generad[oa]))|(?:en|dentro de) (?:\d+|cinco|diez|quince|veinte|treinta) minutos (?:te|lo|la)|(?:te (?:llega|respondo|responderan)|llega tu pedido) (?:hoy|manana|en \d+)|(?:te (?:doy|damos|aplico|aplicamos|regalo)|tienes aprobado) (?:un |el )?(?:descuento|envio)|(?:el envio|tu domicilio) (?:es|sera|queda) (?:gratis|sin costo)/.test(value);
  if(!unsafe&&original)return original;
  if(isAttentionFollowup(snapshot.message?.text)||pendingNeedsReview(snapshot.pending_tasks))return 'Lamento la espera y la molestia. Aún no tengo la confirmación que necesitas. Voy a consultar cómo podemos resolver tu caso para que puedas decidir cómo seguir.';
  return reason==='stock_check'?'Voy a confirmar la disponibilidad y el precio de lo que necesitas.':'Dame un momento y te confirmo.';
}
