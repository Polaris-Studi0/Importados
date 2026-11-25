import {pendingNeedsReview} from './bot-attention.js';
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const greeting=/^(?:hola|holi|hey|buenos dias|buenas tardes|buenas noches|buenas)(?: (?:hola|buenos dias|buenas tardes|buenas noches|como estas))*$/;
const courtesy=/^(?:ok(?:ay)?|dale+|listo|perfecto|gracias+|muchas gracias+|mil gracias|quedo (?:atento|atenta|pendiente)|por favor gracias)(?: (?:ok(?:ay)?|dale+|listo|perfecto|gracias+|muchas gracias+|por (?:su|tu) (?:atencion|ayuda)|muy amable|quedo (?:atento|atenta|pendiente)))*$/;
// Whole messages only: a courtesy followed by a new question must keep routing.
// The same pattern is enforced by record_bot_quiet_turn in PostgreSQL.
export const ACKNOWLEDGEMENT_PATTERN='^(?:ok(?:ay|ey)?|dale+|vale|listo+|perfecto|esta bien|de acuerdo|entendido|bueno|gracias+|muchas gracias+|muchisimas gracias|mil gracias|(?:quedo|estare) (?:atento|atenta|pendiente)|(?:yo )?(?:espero|esperare)|por (?:su|tu) (?:atencion|ayuda)|muy amable)(?: (?:y |entonces )?(?:ok(?:ay|ey)?|dale+|vale|listo+|perfecto|esta bien|de acuerdo|entendido|bueno|gracias+|muchas gracias+|muchisimas gracias|mil gracias|(?:quedo|estare) (?:atento|atenta|pendiente)|(?:yo )?(?:espero|esperare)|por (?:su|tu) (?:atencion|ayuda)|muy amable))*$';
export function isAcknowledgement(body){
  if(/[?¿]/.test(body||''))return false;
  return new RegExp(ACKNOWLEDGEMENT_PATTERN).test(normalize(body))||/^(?:\s|👍|🙏|👌|🙌|😊|🙂|❤\uFE0F?)+$/u.test(String(body||''))&&!!String(body||'').trim();
}
export const isGreeting=body=>greeting.test(normalize(body));
export const isBranchArrival=body=>/\[SEDE:/i.test(body||'')||/^hola[,\s]+quiero comunicarme con la sede\b/i.test(String(body||'').trim());
export function isPendingPriceQuestion(text,tasks){
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return /^(?:y )?(?:(?:el )?precio|cuanto (?:vale|cuesta|sale))(?: porfa| por favor)?$/.test(norm(text))&&!!tasks?.some(t=>/\bprecio\b|cuanto (?:vale|cuesta)|\bvalor\b/.test(norm(t.question)));
}
export function isPendingFollowup(body,tasks){
  const text=String(body||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return !!tasks?.length&&(/^(?:y entonces|alguna (?:respuesta|novedad)|aun espero|sigo esperando|(?:pero )?no (?:demores|tardes) tanto|que paso|ya tienes (?:la )?respuesta|(?:si|aun|todavia) (?:lo|la|los|las) tienen|(?:si )?(?:hay|tienen) disponibilidad)$/.test(text)||/^[¿?\s]+$/.test(body));
}
export function employmentFollowupReply(s){
  if(s.human_resolution||s.message.kind!=='text'||!s.information?.some(i=>i.text?.includes('https://tiendasimportados.com/trabaja-con-nosotros')&&/labor|postula|empleo|hoja/i.test(i.topic)))return null;
  if((s.checkout?.cart?.length||s.checkout?.pending_selection)&&!['ordered','cancelled'].includes(s.checkout.stage))return null;
  const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q=norm(s.onboarding_request||s.message.text),history=(s.history||[]).map(h=>({...h,text:norm(h.text)}));
  const employmentHistory=history.slice(-8).some(h=>/hoja de vida|postula|formulario oficial/.test(h.text));
  const related=/hoja de vida|postula/.test(q)||employmentHistory;
  if(!related)return null;
  let reply='';
  if(/formulario|hoja de vida|postula/.test(q)&&/error|fall[ao]|no (?:puedo|se puede|me deja) (?:enviar|subir|adjuntar)/.test(q)||employmentHistory&&/^(?:(?:siempre|todavia|aun|otra vez) )?(?:me )?(?:sale|surge|aparece|da|marca) (?:un |el |ese |mismo )?error[.!\s]*$/.test(q))reply='Lamento el inconveniente. ¿Qué mensaje de error aparece al enviar el formulario? Cópialo aquí sin incluir tus datos personales para poder revisarlo.';
  else if(/ya (?:llene|complete|diligencie|envie) (?:el )?formulario/.test(q)||/ahora que (?:sigue|prosigue)|que sigue (?:ahora|despues)/.test(q)&&history.some(h=>h.role==='customer'&&/ya (?:llene|complete|diligencie|envie) (?:el )?formulario/.test(h.text)))reply='Si al enviarlo viste la confirmación de recepción del formulario, no necesitas repetirlo. Enviar tu hoja de vida no confirma que tengamos vacantes abiertas ni garantiza una contratación.';
  else if(/^ya (?:la )?envie (?:la )?hoja de vida[.!\s]*$/.test(q))reply='¿La enviaste por el formulario de nuestra página? Ese es el canal para formalizar la postulación.';
  return reply?{intent:'information',reply_text:reply,actions:[],checkout:{}}:null;
}
export function physicalHoursReply(s){
  if(s.human_resolution||s.message.kind!=='text')return null;
  if((s.checkout?.cart?.length||s.checkout?.pending_selection)&&!['ordered','cancelled'].includes(s.checkout.stage))return null;
  const q=String(s.onboarding_request||s.message.text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/whatsapp|este chat|domicilio|pedido|llega/.test(q)||!/horario|que hora|abren|abre|cierran|cierra/.test(q)||!/tienda|fisic|almacen|sede|abren|abre|cierran|cierra|hoy|domingo|sabado/.test(q))return null;
  // The channel's 09–20 schedule never substitutes for store-specific hours.
  if(s.information?.some(i=>/^(?:schedule:|horario fisico)/i.test(String(i.topic).normalize('NFD').replace(/[\u0300-\u036f]/g,''))))return null;
  const pending=s.pending_tasks?.some(t=>/horario|cierre|abren|cierran/.test(t.question.toLowerCase()));
  return {intent:pending?'clarification':'handoff',reply_text:pending?'Estoy pendiente de confirmar el horario de la tienda. Te respondo por aquí cuando lo tenga.':'Dame un momento y te confirmo el horario de la tienda.',actions:pending?[]:[{type:'propose_human_task',reason:'missing_information',question:'Confirmar el horario físico de '+s.branch.name+' para la consulta: '+String(s.onboarding_request||s.message.text).slice(0,300)}],checkout:{}};
}
export function verifiedPriceReply(s,now=Date.now()){
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const q=norm(s.onboarding_request||s.message.text),shopping=s.checkout||{};
  if(s.message.kind!=='text'||s.human_resolution||(shopping.cart?.length||shopping.pending_selection)&&!['ordered','cancelled'].includes(shopping.stage))return null;
  if(!/(?:cuanto (?:cuesta|vale|sale)|(?:que|cual) (?:es el )?precio|(?:y el |el )?precio(?: de| del| tiene| para|$))/.test(q)||/\b(?:dame|deme|comprar|comprarlo|comprarlos|me llevo|agrega|pedido|foto|imagen|horario|direccion|talla|color|garantia|envio|domicilio|[2-9]|[1-9]\d|dos|tres|cuatro|cinco)\b|\b(?:quiero|necesito)(?! saber\b)/.test(q))return null;
  const matches=(s.products||[]).filter(p=>p.branch_id===s.branch.id&&norm(p.name).length>=4&&(' '+q+' ').includes(' '+norm(p.name)+' ')&&p.active&&p.stock_verified&&p.available_quantity>0&&Number.isSafeInteger(p.price_cop)&&p.price_cop>=0&&Date.parse(p.stock_valid_until)>now&&(!p.offer_starts_at||Date.parse(p.offer_starts_at)<=now)&&(!p.offer_ends_at||Date.parse(p.offer_ends_at)>now));
  if(matches.length!==1)return null;
  const p=matches[0],words=new Set('cuanto cuesta cuestan vale valen sale salen que cual es el la los las un una precio de del tiene y me dices das puedes podrias por favor porfa hola gracias quiero saber necesito'.split(' '));
  if(q.replace(norm(p.name),' ').split(' ').filter(Boolean).some(w=>!words.has(w)))return null;
  return {intent:'discovery',reply_text:'El '+p.name+' cuesta $'+p.price_cop.toLocaleString('es-CO')+' por unidad. ¿Te gustaría comprarlo?',offered_product_ids:[p.id],actions:[],checkout:{}};
}
export function onboardingRequest(history,current=''){
  const clean=value=>String(value||'').replace(/\[(?:ORIGEN|SEDE|METODO_SELECCION):[^\]]*\]/gi,'').replace(/^hola[,\s]+quiero comunicarme con la sede[^.\n?!]+(?:[.\n]+|$)/i,'').trim();
  // A branch name and a question can arrive together in the same message.
  const request=clean(current);
  if(/[?¿]/.test(request)||/\b(?:quiero|quisiera|tienen|venden|busco|necesito|cuanto|precio|horario|informacion|pedido|producto|hoja de vida|formulario)\b/.test(normalize(request)))return request.slice(0,2000);
  // Only the intake before any substantive reply. Never revive an old enquiry.
  const messages=[...history].reverse();
  for(const m of messages){
    if(m.role!=='customer'){
      if(!/Soy el asistente virtual|Responde S[IÍ]|¿En cuál sede te atendemos|\[aviso privacidad\]|Nuestro horario de atención|Ya estamos atendiendo de nuevo/i.test(m.text||''))return '';
      continue;
    }
    const value=clean(m.text),text=normalize(value);
    if(!value||isGreeting(value)||isAcknowledgement(value)||/^(?:si|si acepto|yo acepto|si yo acepto|acepto(?: gracias)?|si acepto gracias|autorizo|\d{1,2})$/.test(text))continue;
    if(text.length>5&&!/^\[Archivo de tipo /i.test(value))return value.slice(0,2000);
  }
  return '';
}
export function socialReply(context){
  const s=context.snapshot;
  if(s.message.kind!=='text'||s.human_resolution)return null;
  const shopping=s.checkout||{};
  if((shopping.cart?.length||shopping.pending_selection)&&!['ordered','cancelled'].includes(shopping.stage))return null;
  const text=normalize(s.message.text),pending=!!s.pending_tasks?.length;
  const waiting=isPendingFollowup(s.message.text,s.pending_tasks);
  const pricePending=isPendingPriceQuestion(s.message.text,s.pending_tasks);
  if(!greeting.test(text)&&!courtesy.test(text)&&!waiting&&!pricePending)return null;
  if((waiting||pricePending)&&pendingNeedsReview(s.pending_tasks))return null;
  const reply=pending?'Estoy pendiente de la confirmación de tu consulta. Te respondo por aquí cuando la tenga.':greeting.test(text)?'¡Hola! ¿En qué te puedo ayudar?':'¡Con gusto! Aquí estamos si necesitas algo más.';
  return {intent:'clarification',reply_text:reply,actions:[],checkout:{}};
}
export function fallbackQuestion(snapshot){
  const recent=[...(snapshot.history||[]).filter(m=>m.role==='customer').slice(-3).map(m=>m.text),snapshot.message.text].filter(t=>t&&!isGreeting(t)&&!courtesy.test(normalize(t)));
  const detail=recent.join(' | ').slice(-650);
  return 'Revisar la consulta del cliente: '+detail+(snapshot.message.attachment?' (Adjunto recibido; revisar la imagen o archivo de esta conversación sin asumir su contenido.)':'');
}
export function naturalResolutionText(generated,answer){
  let value=String(generated||'').trim();
  // Preserve a question supplied by the operator (e.g. delivery or pickup).
  // Remove an invented invitation as a whole clause, including its pronouns.
  if(!/[?¿]/.test(answer))value=value.replace(/\s*(?:¿\s*(?:(?:Lo|La|Los|Las|Te)\s+)?(?:Quieres|Deseas|Prefieres|Gustaría)\b|¿\s*Te gustaría\b|(?:Si quieres|Si lo deseas|Si\s+(?:puedo|podemos)|(?:Puedo|Podemos))\s+(?:consultar|verificar|confirmar|preguntar|ayudar|pedir|buscar)|¿\s*(?:Lo|La|Los|Las|Te)\s*$)[\s\S]*$/i,'').trim();
  value=value.replace(/([.!?])\s+(?:Si|¿(?:Lo|La|Los|Las|Te))\s*$/i,'$1').trim();
  // A resolution answers its original question, never the customer's last thanks.
  const first=/^([^.!?]+)[.!]\s*/.exec(value);
  if(first&&(isAcknowledgement(first[1])||/^con gusto$/i.test(first[1].trim())))value=value.slice(first[0].length).trim();
  value=value.replace(/^(?:Consulté|Consultamos) con la sede [^:]+:\s*/i,'');
  const norm=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/\b(?:no|sin|solo|unicamente|hasta|excepto)\b/.test(norm(answer))&&!/\b(?:no|sin|solo|unicamente|hasta|excepto)\b/.test(norm(value)))return String(answer).trim();
  const numbers=text=>(String(text).match(/\d+(?:[.,]\d+)*/g)||[]).map(n=>n.replace(/[.,]/g,''));
  if(numbers(answer).some(n=>!numbers(value).includes(n)))return String(answer).trim();
  return value||String(answer).trim();
}
