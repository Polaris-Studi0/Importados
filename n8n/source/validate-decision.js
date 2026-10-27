const c = $('Validar turno y contexto').first().json.context;
const j = $input.first().json;
function blocked(reason){
 return [{json:{http_status:409,response:{contract:'importados.bot.decision.v1',status:reason,turn_id:c.turn_id,conversation_id:c.conversation_id,send_allowed:false,requires_commit:false,mutations_executed:[],decision:null,evidence:{intent:typeof j.output==='object'?j.output?.intent:null,tools_used:(j.intermediateSteps||[]).map(s=>s.action?.tool).filter(Boolean)}}}}];
}
if(Date.parse(c.expires_at)<=Date.now()) return blocked('stale_context');
let d=j.output;
try{if(typeof d==='string') d=JSON.parse(d);}catch{return blocked('invalid_agent_output');}
if(d?.human_task_id!==undefined&&typeof d.human_task_id!=='string'||d?.human_priority!==undefined&&!['normal','high'].includes(d.human_priority))return blocked('invalid_handoff_fields');
const intents=['information','discovery','quote','qr','handoff','order_status','clarification','close','checkout'];
if(!d||typeof d!=='object'||!intents.includes(d.intent)||typeof d.reply_text!=='string'||!d.reply_text.trim()||d.reply_text.length>1800||!Array.isArray(d.product_ids)||!Array.isArray(d.quote_items)||typeof d.qr_asset_id!=='string'||typeof d.human_reason!=='string'||typeof d.human_question!=='string') return blocked('invalid_agent_output');
if(d.product_ids.length>5||d.quote_items.length>10||new Set(d.product_ids).size!==d.product_ids.length) return blocked('invalid_references');
// Audio has no transcript in this integration. Do not invent checkout data,
// advance a purchase, or offer a transcription that cannot be performed.
const untranscribedAudio=c.message.kind==='audio'&&!c.human_resolution;
if(untranscribedAudio)d={intent:'clarification',reply_text:'¿Me lo puedes escribir, por favor? Así seguimos con tu consulta.',product_ids:[],quote_items:[],qr_asset_id:'',human_reason:'',human_question:'',checkout:{},confirmed_item:null,media_ids:[],accept_summary:false,cancel_cart:false};
function isPendingPriceQuestion(text,tasks){
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return /^(?:y )?(?:(?:el )?precio|cuanto (?:vale|cuesta|sale))(?: porfa| por favor)?$/.test(norm(text))&&!!tasks?.some(t=>/\bprecio\b|cuanto (?:vale|cuesta)|\bvalor\b/.test(norm(t.question)));
}
function isPendingFollowup(body,tasks){
  const text=String(body||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return !!tasks?.length&&(/^(?:y entonces|alguna (?:respuesta|novedad)|aun espero|sigo esperando|(?:pero )?no (?:demores|tardes) tanto|que paso|ya tienes (?:la )?respuesta|(?:si|aun|todavia) (?:lo|la|los|las) tienen|(?:si )?(?:hay|tienen) disponibilidad)$/.test(text)||/^[¿?\s]+$/.test(body));
}
const shoppingActive=(c.checkout?.cart?.length||c.checkout?.pending_selection)&&!['ordered','cancelled'].includes(c.checkout?.stage);
if(c.message.kind==='text'&&!c.human_resolution&&!shoppingActive&&(isPendingPriceQuestion(c.message.text,c.pending_tasks)||isPendingFollowup(c.message.text,c.pending_tasks)))d={intent:'clarification',reply_text:'Aún falta la confirmación del equipo. Te respondemos por aquí cuando la tengamos.',product_ids:[],quote_items:[],qr_asset_id:'',human_reason:'',human_question:'',checkout:{},confirmed_item:null,media_ids:[],accept_summary:false,cancel_cart:false};
function verifiedPriceReply(s,now=Date.now()){
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
function employmentFollowupReply(s){
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
function physicalHoursReply(s){
  if(s.human_resolution||s.message.kind!=='text')return null;
  if((s.checkout?.cart?.length||s.checkout?.pending_selection)&&!['ordered','cancelled'].includes(s.checkout.stage))return null;
  const q=String(s.onboarding_request||s.message.text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/whatsapp|este chat|domicilio|pedido|llega/.test(q)||!/horario|que hora|abren|abre|cierran|cierra/.test(q)||!/tienda|fisic|almacen|sede|abren|abre|cierran|cierra|hoy|domingo|sabado/.test(q))return null;
  // Never substitute channel hours for store-specific verified hours.
  if(s.information?.some(i=>/^(?:schedule:|horario fisico)/i.test(String(i.topic).normalize('NFD').replace(/[\u0300-\u036f]/g,''))))return null;
  const pending=s.pending_tasks?.some(t=>/horario|cierre|abren|cierran/.test(t.question.toLowerCase()));
  return {intent:pending?'clarification':'handoff',reply_text:pending?'Estoy pendiente de confirmar el horario de la tienda. Te respondo por aquí cuando lo tenga.':'Dame un momento y te confirmo el horario de la tienda.',actions:pending?[]:[{type:'propose_human_task',reason:'missing_information',question:'Confirmar el horario físico de '+s.branch.name+' para la consulta: '+String(s.onboarding_request||s.message.text).slice(0,300)}],checkout:{}};
}
const proceduralEligible=['information','clarification','handoff','close'].includes(d.intent)&&!d.product_ids.length&&!d.quote_items.length&&!d.qr_asset_id&&!d.confirmed_item&&!d.accept_summary&&!d.cancel_cart&&(d.media_ids===undefined||Array.isArray(d.media_ids)&&!d.media_ids.length)&&(d.checkout===undefined||d.checkout&&typeof d.checkout==='object'&&!Array.isArray(d.checkout)&&!Object.values(d.checkout).some(Boolean))&&(d.intent==='handoff'?['missing_information',''].includes(d.human_reason):!d.human_reason&&!d.human_question);
const proceduralReply=proceduralEligible?(employmentFollowupReply(c)||physicalHoursReply(c)):null;
const verifiedEnquiry=verifiedPriceReply(c);
if(verifiedEnquiry)d={intent:verifiedEnquiry.intent,reply_text:verifiedEnquiry.reply_text,product_ids:verifiedEnquiry.offered_product_ids,quote_items:[],qr_asset_id:'',human_reason:'',human_question:'',checkout:{},confirmed_item:null,media_ids:[],accept_summary:false,cancel_cart:false};
// A clarification during an active purchase must use the durable checkout
// questions; free-form prose cannot declare that an unfinished order is ready.
const collecting=['collecting','stock_review'].includes(c.checkout?.stage)&&(c.checkout?.pending_selection||c.checkout?.cart?.length);
if(!c.human_resolution&&!untranscribedAudio&&collecting&&['clarification','information'].includes(d.intent)&&(d.intent==='clarification'||Object.values(d.checkout||{}).some(Boolean)))d.intent='checkout';
const available=p=>p.active&&p.stock_verified&&p.available_quantity>0&&Date.parse(p.stock_valid_until)>Date.now()&&(!p.offer_starts_at||Date.parse(p.offer_starts_at)<=Date.now())&&(!p.offer_ends_at||Date.parse(p.offer_ends_at)>Date.now());
const ACKNOWLEDGEMENT_PATTERN="^(?:ok(?:ay|ey)?|dale+|vale|listo+|perfecto|esta bien|de acuerdo|entendido|bueno|gracias+|muchas gracias+|muchisimas gracias|mil gracias|(?:quedo|estare) (?:atento|atenta|pendiente)|(?:yo )?(?:espero|esperare)|por (?:su|tu) (?:atencion|ayuda)|muy amable)(?: (?:y |entonces )?(?:ok(?:ay|ey)?|dale+|vale|listo+|perfecto|esta bien|de acuerdo|entendido|bueno|gracias+|muchas gracias+|muchisimas gracias|mil gracias|(?:quedo|estare) (?:atento|atenta|pendiente)|(?:yo )?(?:espero|esperare)|por (?:su|tu) (?:atencion|ayuda)|muy amable))*$";
function isAcknowledgement(body){
  if(/[?¿]/.test(body||''))return false;
  return new RegExp(ACKNOWLEDGEMENT_PATTERN).test(String(body||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim())||/^(?:\s|👍|🙏|👌|🙌|😊|🙂|❤\uFE0F?)+$/u.test(String(body||''))&&!!String(body||'').trim();
}
const lastPublicReply=[...(c.history||[])].reverse().find(h=>['assistant','operator'].includes(h.role))?.text||'';
const purchaseQuestion=/[?¿]/.test(lastPublicReply)&&/comprar|compra|pedido|resumen|confirmas|aceptas/i.test(lastPublicReply);
const quietAcknowledgement=c.message.kind==='text'&&!c.human_resolution&&!shoppingActive&&!purchaseQuestion&&isAcknowledgement(c.message.text);
if(quietAcknowledgement)d={intent:'clarification',reply_text:'Estoy pendiente de la confirmación. Te respondo por aquí cuando la tenga.',product_ids:[],quote_items:[],qr_asset_id:'',human_reason:'',human_question:'',checkout:{},confirmed_item:null,accept_summary:false,cancel_cart:false,media_ids:[]};
if(proceduralReply)d={intent:proceduralReply.intent,reply_text:proceduralReply.reply_text,product_ids:[],quote_items:[],qr_asset_id:'',human_reason:proceduralReply.actions[0]?.reason||'',human_question:proceduralReply.actions[0]?.question||'',checkout:{},confirmed_item:null,accept_summary:false,cancel_cart:false,media_ids:[]};
const tools=(j.intermediateSteps||[]).map(s=>s.action?.tool).filter(Boolean);
// Missing tool evidence may only fall back to the literal approved answer.
// Never accept an ungrounded generated fact or any proposed side effect.
const literalAnswer=c.human_resolution&&d.intent==='information'&&!tools.includes('consultar_informacion')&&!d.product_ids.length&&!d.quote_items.length&&!d.qr_asset_id&&!d.human_reason&&!d.human_question&&!Object.values(d.checkout||{}).some(Boolean)&&!(d.media_ids||[]).length&&!d.accept_summary&&!d.cancel_cart;
if(literalAnswer)d.reply_text=c.human_resolution.answer;

// A human-task proposal carries no verified fact or side effect. Validate its
// fields below without depending on an optional model tool round-trip.
const required={information:'consultar_informacion',discovery:'buscar_promociones',quote:'cotizar_carrito',qr:'consultar_qr',order_status:'consultar_pedido'};
const confirmedDiscovery=d.intent==='discovery'&&!d.product_ids.length&&!d.quote_items.length&&!d.qr_asset_id&&(c.confirmed_answers||[]).length>0&&tools.includes('consultar_informacion');
if(required[d.intent]&&!tools.includes(required[d.intent])&&!verifiedEnquiry&&!literalAnswer&&!confirmedDiscovery&&!proceduralReply) return blocked('missing_tool_evidence');
for(const id of d.product_ids){if(typeof id!=='string'||!c.products.some(p=>p.id===id&&available(p))) return blocked('unverified_product');}
if(d.intent!=='quote'&&d.quote_items.length || d.intent!=='qr'&&d.qr_asset_id || d.intent!=='handoff'&&(d.human_reason||d.human_question)) return blocked('incompatible_actions');
if(c.human_resolution && (d.intent!=='information'||d.product_ids.length||d.quote_items.length||d.qr_asset_id||d.human_reason||d.human_question)) return blocked('invalid_resolution_actions');
if(c.human_resolution && /el equipo responde|según (?:el administrador|la intranet)|sobre tu consulta/i.test(d.reply_text)) return blocked('internal_attribution');
const checkout=d.checkout||{};
const fields=['customer_name','recipient_name','recipient_phone','fulfillment_type','delivery_address','delivery_zone','payment_method'];
if(typeof checkout!=='object'||Array.isArray(checkout)||Object.keys(checkout).some(k=>!fields.includes(k))||Object.values(checkout).some(v=>typeof v!=='string'||v.length>300)) return blocked('invalid_checkout');
if(checkout.fulfillment_type&&!['delivery','pickup'].includes(checkout.fulfillment_type)||checkout.payment_method&&!['transfer','addi','sistecredito','cash_prepaid'].includes(checkout.payment_method)) return blocked('invalid_checkout');
if(c.human_resolution&&(Object.values(checkout).some(Boolean)||d.accept_summary||d.cancel_cart))return blocked('invalid_resolution_actions');
// Explicit self-receipt uses the name confirmed for THIS purchase only.
if(d.intent==='checkout'&&collecting&&c.checkout?.customer_name&&/^(?:lo\s+)?recibo yo(?:[.!]|$|\s+en\s)/i.test(c.message.text.trim())&&!/\b(?:pero|mejor|recibe|recibira|recibirá|destinatario)\b/i.test(c.message.text))checkout.recipient_name=c.checkout.customer_name;
if(Object.values(checkout).some(Boolean)&&!['quote','checkout','qr'].includes(d.intent))return blocked('incompatible_actions');
if(d.accept_summary&&(!c.checkout?.summary_delivered||!['checkout','qr'].includes(d.intent)))return blocked('summary_not_delivered');
let confirmedItem=null;
let sizeQuestion='';
// Repeated selection metadata is already verified in the durable snapshot.
// Discard that redundant proposal before revalidating a generated excerpt.
const existingSelection=c.checkout?.pending_selection;
if(d.intent==='checkout'&&d.confirmed_item&&existingSelection&&['source_task_id','unit_price_cop','quantity','name','variant'].every(k=>String(existingSelection[k]??'').toLowerCase()===String(d.confirmed_item[k]??'').toLowerCase()))d.confirmed_item=null;
if(d.confirmed_item!=null){
 const i=d.confirmed_item;
 const answer=(c.confirmed_answers||[]).find(a=>a.id===i.source_task_id)?.answer;
 const excerpt=typeof i.source_excerpt==='string'?i.source_excerpt.trim():'';
 const name=typeof i.name==='string'?i.name.trim():'',variant=typeof i.variant==='string'?i.variant.trim():'';
 const prices=excerpt.match(/[0-9]{1,3}(?:[.][0-9]{3})+|[0-9]{4,}/g)||[];
 if(d.intent!=='checkout'||c.human_resolution||!tools.includes('consultar_informacion')||!answer||!excerpt||excerpt.length>800||!name||name.length>160||variant.length>80
 ||!answer.toLowerCase().includes(excerpt.toLowerCase())||!excerpt.toLowerCase().includes(name.toLowerCase())||variant&&!excerpt.toLowerCase().includes(variant.toLowerCase())
 ||prices.length!==1||Number(prices[0].replaceAll('.',''))!==i.unit_price_cop||!Number.isSafeInteger(i.unit_price_cop)||i.unit_price_cop<=0
 ||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>99||d.accept_summary)return blocked('unverified_confirmed_item');
 confirmedItem={source_task_id:i.source_task_id,source_excerpt:excerpt,name,variant,unit_price_cop:i.unit_price_cop,quantity:i.quantity};
 const sizeToken='(?:XXXS|XXS|XS|XXXL|XXL|XL|S|M|L|[2-5]XL|[0-9]{1,3})';
 const listed=new RegExp('\\btall(?:as?)?\\s*:?\\s*('+sizeToken+'\\b(?:\\s*(?:,|/|y|o)\\s*'+sizeToken+'\\b)+)','i').exec(excerpt);
 const sizes=listed?[...new Set(listed[1].toUpperCase().match(new RegExp(sizeToken+'\\b','g'))||[])]:[];
 if(sizes.length>1){
  const selected=variant.toUpperCase();
  const mentioned=sizes.filter(size=>new RegExp('(?:^|\\s)'+size+'(?:$|[\\s,.!?])','i').test(c.message.text));
  const prior=c.checkout?.pending_selection;
  const alreadyChosen=prior&&prior.source_task_id===i.source_task_id&&prior.name?.toLowerCase()===name.toLowerCase()&&prior.variant?.toUpperCase()===selected&&prior.unit_price_cop===i.unit_price_cop;
  if(!sizes.includes(selected)||!alreadyChosen&&(mentioned.length!==1||mentioned[0]!==selected)){
   sizeQuestion='Claro, ¿qué talla prefieres: '+sizes.join(' o ')+'?';
   confirmedItem=null;
  }
 }

}
const pending=c.checkout?.pending_selection;
if(confirmedItem&&pending&&['source_task_id','unit_price_cop','quantity','name','variant'].every(k=>String(pending[k]??'').toLowerCase()===String(confirmedItem[k]??'').toLowerCase()))confirmedItem=null;
const mediaIds=d.media_ids||[];
if(!Array.isArray(mediaIds)||mediaIds.length>2||new Set(mediaIds).size!==mediaIds.length||mediaIds.some(id=>!(c.product_images||[]).some(a=>a.id===id))||mediaIds.length&&['qr','handoff','close','order_status'].includes(d.intent))return blocked('unverified_image');
const actions=[];
let quote=null;
if(d.intent==='quote'){
 if(!d.quote_items.length) return blocked('empty_quote');
 const seen=new Set(),items=[];
 for(const i of d.quote_items){
  if(!i||typeof i.product_id!=='string'||seen.has(i.product_id)||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>99) return blocked('invalid_quote');
  seen.add(i.product_id);
  const p=c.products.find(p=>p.id===i.product_id);
  if(!p||!available(p)||i.quantity>p.available_quantity) return blocked('stock_requires_check');
  items.push({product_id:p.id,name:p.name,quantity:i.quantity,unit_price_cop:p.price_cop,line_total_cop:p.price_cop*i.quantity});
 }
 const subtotal_cop=items.reduce((a,i)=>a+i.line_total_cop,0);
 if(!Number.isSafeInteger(subtotal_cop)) return blocked('invalid_total');
 quote={items,subtotal_cop,delivery_included:false,reserved:false,order_created:false};
 actions.push({type:'propose_quote',items:d.quote_items});
}
if(d.intent==='qr'){
 const asset=c.qr_assets.find(q=>q.id===d.qr_asset_id);
 if(!asset||c.qr_assets.length!==1||!c.payment.ready_for_qr||!c.payment.quote_id) return blocked('qr_not_authorized');
 actions.push({type:'propose_qr',asset_id:asset.id,branch_id:c.branch.id,quote_id:c.payment.quote_id});
}
if(d.intent==='handoff'){
 if(!['human_request','missing_information','stock_check','payment_review','pqrs'].includes(d.human_reason)||!d.human_question.trim()||d.human_question.length>800) return blocked('invalid_handoff');
 let question=d.human_question.trim();
 // Remove a generated catalog questionnaire appended after the actual question.
 // Keep multiple customer questions intact; only this boilerplate suffix is removed.
 if(['missing_information','stock_check'].includes(d.human_reason)){
  const concise=question.replace(/([?])\s*(?:Indi(?:c|qu)[a-z]*\b|Por favor (?:indicar|verificar)\b|Si (?:hay modelos agotados|no aparecen?\b|es as[ií](?=\s|[,.:]|$)|los hay\b))[\s\S]*$/i,'$1').trim();
  if(concise)question=concise;
 }
 // Preserve an explicit price enquiry when a model shortens the human task.
 const priceQuestion=/\bprecio\b|cuanto (?:cuesta(?:n)?|vale(?:n)?|sale(?:n)?)/i;
 const normalizeQuestion=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const originalQuestion=String(c.onboarding_request||c.message.text).trim();
 const asksPrice=priceQuestion.test(normalizeQuestion(originalQuestion));
 const instructionRequest=/instruccion|prompt|secreto|token|api.?key|system|ignora|olvida|reglas? internas?/i.test(normalizeQuestion(originalQuestion));
 if(['missing_information','stock_check'].includes(d.human_reason)&&asksPrice){
  if(!shoppingActive&&!c.human_resolution&&!instructionRequest&&originalQuestion.length<=500)question='En '+c.branch.name+': '+originalQuestion;
  else if(!priceQuestion.test(normalizeQuestion(question)))question=question.slice(0,730)+' ¿Cuál es el precio vigente?';
 }
 const taskId=d.human_task_id||'';
 const allowedKinds=['human_request','missing_information','stock_check','pqrs'];
 if(taskId&&!c.pending_tasks?.some(t=>t.id===taskId&&allowedKinds.includes(t.kind)&&allowedKinds.includes(d.human_reason)))return blocked('invalid_task_update');
 actions.push({type:'propose_human_task',reason:d.human_reason,question,related_message_id:c.message.id,task_id:taskId,priority:d.human_priority||'normal'});
}
if(d.intent==='order_status'&&!c.order) return blocked('unknown_order');
// Critical acknowledgements follow verified state, not promises generated by the model.
let replyText=d.reply_text.trim();
function naturalResolutionText(generated,answer){
  let value=String(generated||'').trim();
  // Preserve a question supplied by the operator (e.g. delivery or pickup).
  // Remove an invented invitation as a whole clause, including its pronouns.
  if(!/[?¿]/.test(answer))value=value.replace(/\s*(?:¿\s*(?:(?:Lo|La|Los|Las|Te)\s+)?(?:Quieres|Deseas|Prefieres|Gustaría)\b|¿\s*Te gustaría\b|(?:Si quieres|Si lo deseas|Si\s+(?:puedo|podemos)|(?:Puedo|Podemos))\s+(?:consultar|verificar|confirmar|preguntar|ayudar|pedir|buscar)|¿\s*(?:Lo|La|Los|Las|Te)\s*$)[\s\S]*$/i,'').trim();
  value=value.replace(/([.!?])\s+(?:Si|¿(?:Lo|La|Los|Las|Te))\s*$/i,'$1').trim();
  // A resolution answers its original question, never the customer's last thanks.
  const first=/^([^.!?]+)[.!]\s*/.exec(value);
  if(first&&(isAcknowledgement(first[1])||/^con gusto$/i.test(first[1].trim())))value=value.slice(first[0].length).trim();
  value=value.replace(/^(?:Consulté|Consultamos) con la sede [^:]+:\s*/i,'');
  const numbers=text=>(String(text).match(/\d+(?:[.,]\d+)*/g)||[]).map(n=>n.replace(/[.,]/g,''));
  if(numbers(answer).some(n=>!numbers(value).includes(n)))return String(answer).trim();
  return value||String(answer).trim();
}
if(c.human_resolution)replyText=naturalResolutionText(replyText,c.human_resolution.answer);
// Asking a price alone does not authorize starting a cart. The quotation has
// already passed stock/price/tool validation above; present it without mutations.
const enquiry=String(c.onboarding_request||c.message.text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const priceOnly=/(?:cuanto (?:cuesta|vale|sale)|(?:que|cual) (?:es el )?precio|(?:y el |el )?precio(?: de| del| tiene| para|$))/.test(enquiry)&&! /\b(?:quiero|necesito|dame|deme|comprar|comprarlo|comprarlos|me llevo|agrega|pedido)\b/.test(enquiry);
if(d.intent==='quote'&&quote&&!shoppingActive&&!c.human_resolution&&priceOnly){
 const items=quote.items;replyText=items.map(i=>i.quantity===1?'El '+i.name+' cuesta $'+i.unit_price_cop.toLocaleString('es-CO')+'.':i.quantity+' × '+i.name+': $'+i.line_total_cop.toLocaleString('es-CO')+'.').join(' ')+' ¿Te gustaría comprarlo?';
 d.intent='discovery';d.product_ids=items.map(i=>i.product_id);quote=null;actions.length=0;for(const k of Object.keys(checkout))checkout[k]='';confirmedItem=null;d.accept_summary=false;d.cancel_cart=false;
}


if(d.intent==='handoff'){
 const acknowledgements={
  human_request:'Dame un momento, voy a consultar tu caso.',
  missing_information:'Dame un momento y te confirmo.',
  stock_check:'Dame un momento y te confirmo la disponibilidad.',
  payment_review:c.message.attachment_received?'Recibí el archivo. El equipo debe revisar el comprobante; el pago aún no está confirmado.':'Para revisar el pago, adjunta el comprobante. El equipo debe validarlo antes de confirmar la compra.',
  pqrs:'Dame un momento, voy a consultar tu caso.'
 };
 const task=actions.find(a=>a.type==='propose_human_task');
  const update=!!task?.task_id;
  const complaint=d.human_reason==='pqrs'||/otros? (?:dos|tres|cuatro|\d+) dias|reclamo|molest|inconform|llevo esperando/i.test(String(c.message.text).normalize('NFD').replace(/[\u0300-\u036f]/g,''));
  replyText=complaint?'Lamento la demora y la molestia. '+(update?'Añadimos tu reclamo a la consulta pendiente para que el equipo lo revise.':'Dejamos tu reclamo pendiente de revisión por el equipo.'):update?'Añadimos esta información a tu consulta pendiente. Aún falta la confirmación del equipo.':acknowledgements[d.human_reason];
}
if(d.intent==='checkout') replyText='Continúo con tu selección y los datos que indicas. El resumen y el pago requieren las comprobaciones de la compra.';
if(sizeQuestion) replyText=sizeQuestion;
if(d.intent==='order_status') replyText=c.order.summary;
if(d.intent==='qr') replyText='Revisa que el valor y la sede correspondan a tu cotización antes de pagar.';
return [{json:{http_status:200,response:{
 contract:'importados.bot.decision.v1',status:'decision_ready',mode:c.mode,source:c.source,turn_id:c.turn_id,conversation_id:c.conversation_id,
 expected_control_version:c.control_version,expected_context_version:c.context_version,expected_context_fingerprint:c.context_fingerprint,expires_at:c.expires_at,
 send_allowed:false,requires_commit:true,mutations_executed:[],
 decision:{media_ids:sizeQuestion?[]:mediaIds,intent:sizeQuestion?'clarification':d.intent,reply_text:quietAcknowledgement?'':replyText,offered_product_ids:d.product_ids,quote,actions,checkout:sizeQuestion?{}:checkout,confirmed_item:confirmedItem,accept_summary:d.accept_summary===true,cancel_cart:d.cancel_cart===true},
 evidence:{tools_used:[...new Set(tools)],literal_answer_fallback:!!literalAnswer,quiet_acknowledgement:!!quietAcknowledgement},
 integration_note:'Propuesta sin efectos. El Worker revalida control, consentimiento y contexto antes de registrar y enviar. Piloto con transacciones de compra; el modelo nunca aprueba pagos ni crea pedidos.'
}}}];
