const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
export function orderSnapshot(order,branchName,now){
  const pickup=order.fulfillment_type==='pickup';
  const labels={preparing:'en preparación',ready:pickup?'listo para recoger':'listo para despacho',dispatched:'en camino',delivered:'entregado',cancelled:'cancelado'};
  const terminal=['delivered','cancelled'].includes(order.status)||(pickup&&order.status==='ready');
  const due=Date.parse(order.promised_at);
  const timing=terminal?'complete':!Number.isFinite(due)?'missing':due>now?'current':'expired';
  let estimate='';
  if(timing==='current'){
    const date=new Date(due),time=new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',hour:'numeric',minute:'2-digit',hour12:true}).format(date).replace(/\.$/,'');
    const when=day(date)===day(new Date(now))?'hoy':`el ${new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',day:'numeric',month:'long'}).format(date)}`;
    estimate=` ${pickup?'Estará listo para recoger':'La llegada está estimada para'} ${when}, alrededor de las ${time}. Es una hora aproximada.`;
  }
  const total=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(order.total)+Number(order.delivery_fee));
  const summary=`Tu pedido ${order.order_number} de ${order.branch_name||branchName} está ${labels[order.status]||'pendiente de revisión'}. Total: ${total}.${estimate}`;
  return {id:order.id,number:order.order_number,status:order.status,timing,promised_at:order.promised_at,summary};
}
export function orderStatusReply(context){
  const s=context.snapshot,t=normalize(s.message.text);
  if(s.message.kind!=='text'||/\b(cancel|cambi|modific|devol|reembols|si compro|si pido)/.test(t))return null;
  const wantsTime=/\b(?:cuando|a que hora|en cuanto(?: tiempo)?|cuanto (?:falta|tarda)|tiempo estimado)\b/.test(t)&&/\b(?:llega|llegara|llegar|entrega|pedido|domicilio|listo)\b/.test(t);
  const tracking=wantsTime||/\b(?:estado|seguimiento)\b/.test(t)&&/\b(?:pedido|compra|envio|imp[- ]?\d+)\b/.test(t)
    ||/\b(?:ya salio|por donde va|(?:como|donde) (?:va|esta) mi pedido)\b/.test(t);
  if(!tracking)return null;
  const order=s.order;
  if(!order)return {intent:'clarification',reply_text:/\bimp[- ]?\d+/.test(t)?'No encuentro ese pedido asociado a este chat. ¿Puedes revisar el número?':'¿Me compartes el número de tu pedido para revisarlo?',actions:[],checkout:{}};
  if(wantsTime&&['missing','expired'].includes(order.timing))return {intent:'handoff',reply_text:order.timing==='expired'?'La hora estimada ya pasó. Dame un momento y te confirmo cómo va tu pedido.':'Dame un momento y te confirmo el tiempo de entrega.',actions:[{type:'propose_human_task',reason:'missing_information',question:`Confirmar el tiempo de ${order.status==='ready'?'despacho o entrega':'entrega'} del pedido ${order.number}. ${order.timing==='expired'?'La estimación registrada ya venció.':'No tiene estimación registrada.'}`}],checkout:{}};
  return {intent:'order_status',reply_text:order.summary,actions:[],checkout:{}};
}
