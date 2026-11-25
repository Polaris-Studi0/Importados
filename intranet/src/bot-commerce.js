import {rpc,db,fail} from './whatsapp-core.js';
import {checkoutReply} from './bot-checkout.js';
import {pendingNeedsReview} from './bot-attention.js';
import {orderStatusReply,orderSnapshot} from './bot-orders.js';
import {isPendingFollowup,isPendingPriceQuestion,socialReply,employmentFollowupReply,verifiedPriceReply,naturalResolutionText} from './bot-conversation.js';
export const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const serviceOpen=(now=Date.now())=>{const h=new Date(now-5*3600000);const m=h.getUTCHours()*60+h.getUTCMinutes();return {attention:m>=540&&m<1200,delivery:m>=540&&m<1140};};
export const asksBranches=text=>/^(?:(?:hola|por favor|porfa|oye|y|me|puedes|podrias|mostrar|muestra|muestrame|dime|dime cuales|cuales|que|son|las|todas|sus|tienen|sedes|hay|ver|quisiera|conocer|quiero|saber|donde|estan|ubicadas)\s*)+$/.test(normalize(text))&&/\bsedes\b/.test(normalize(text));
export function branchFromText(text){const n=normalize(text);if(/^(?:sede )?1$/.test(n)||/\bsanta lucia\b/.test(n))return 'santa-lucia';if(/^(?:sede )?2$/.test(n)||/\bniquia\b/.test(n))return 'niquia';return null;}
export const asksChangeBranch=text=>/^(?:(?:quiero|deseo|podemos|puedo|por favor|porfa) )?(?:cambiar(?: de)?|cambio de|cambiame de|otra) sede$/.test(normalize(text));
export const branchMenu=branches=>'¿En qué sede te atendemos?\n'+['santa-lucia','niquia'].map((id,i)=>`${i+1}. ${branches.find(b=>b.id===id)?.name||id}`).join('\n')+'\nPuedes responder con el nombre o el número.';

export function commerceSnapshot(data,now=Date.now()){
 const c=data.conversation,checkout=data.checkout?.state||{};
 const products=(data.products||[]).map(p=>{
  const count=data.inventory?.find(i=>i.product_id===p.id),held=(data.holds||[]).filter(h=>h.product_id===p.id).reduce((a,h)=>a+h.quantity,0);
  return {id:p.id,branch_id:c.branch_id,name:p.name,description:p.description?.length<=600?p.description:'',category:p.category,price_cop:Number(p.price),active:p.active,available_quantity:Math.max(0,(count?.quantity||0)-held),stock_verified:!!count&&Date.parse(count.valid_until)>now,stock_valid_until:count?.valid_until||null,offer_starts_at:p.offer_starts_at,offer_ends_at:p.offer_ends_at,regular_price_cop:p.regular_price?Number(p.regular_price):null};
 });
 const qrs=(data.qrs||[]).map(q=>({id:q.id,branch_id:q.branch_id,label:q.label,active:q.active}));
 const images=(data.products||[]).filter(p=>p.storage_path&&!p.storage_path.endsWith('.webp')&&products.some(x=>x.id===p.id)).map(p=>({id:p.id,product_id:p.id,caption:p.name}));
 return {products,product_images:images,qr_assets:qrs,last_options:data.offered_delivered?(checkout.offered_ids||[]).filter(id=>products.some(p=>p.id===id)):[],cart:checkout.stage==='ordered'?[]:(checkout.items||[]).filter(i=>i.product_id).map(i=>({product_id:i.product_id,quantity:i.quantity})),checkout:{...checkout,pending_selection:checkout.stage==='ordered'?null:checkout.pending_selection,cart:checkout.stage==='ordered'?[]:checkout.cart||[],summary_delivered:data.summary_delivered===true},payment:{ready_for_qr:checkout.payment_method==='transfer'&&!!checkout.quote_id&&checkout.accepted_quote_id===checkout.quote_id&&Date.parse(checkout.reservation_until)>now,quote_id:checkout.quote_id||''},order:data.order?orderSnapshot(data.order,data.branches.find(b=>b.id===data.order.branch_id)?.name||'',now):null};
}

export function directConversationReply(packet){
 const s=packet.snapshot,text=normalize(s.message.text),shopping=s.checkout||{},active=!!(shopping.pending_selection||shopping.cart?.length||shopping.items?.length)&&!['ordered','cancelled'].includes(shopping.stage);
 const tracking=orderStatusReply(packet);if(tracking)return tracking;
 const patch=checkoutReply(packet);if(patch)return patch;
 if(active){
  const payment=/^(?:por )?transferencia(?: bancaria)?$|^(?:con )?(?:el )?qr$/.test(text)?'transfer':/^(?:con |por )?addi$/.test(text)?'addi':/^(?:con |por )?sistecredito$/.test(text)?'sistecredito':/^(?:en )?efectivo(?: al recoger| en la sede)?$|^pago en (?:la )?sede$/.test(text)?'cash_prepaid':null;
  if(payment)return {intent:'checkout',reply_text:'Continuemos con tu compra.',actions:[],checkout:{payment_method:payment},accept_summary:s.checkout.summary_delivered===true};
  if(s.checkout.summary_delivered&&/^(?:si|si confirmo|confirmo|acepto|de acuerdo|esta bien|correcto|si esta correcto|todo correcto|listo)$/.test(text))return {intent:'checkout',reply_text:'Continuemos con tu compra.',actions:[],checkout:{},accept_summary:true};
 }
 if(/\b(?:medios|metodos|formas) de pago\b|^como (?:puedo )?pagar$/.test(text))return {intent:'information',reply_text:'Puedes pagar por transferencia, Addi o Sistecrédito, con validación del equipo. Si recoges en la sede, también puedes pagar en efectivo. Para domicilio no tenemos pago contraentrega.',actions:[],checkout:{}};
 if(/^(?:tienen|manejan|hacen|hay|cuentan con) (?:servicio de )?domicilios?$/.test(text))return {intent:'information',reply_text:'Podemos gestionar tu compra a domicilio. Recibimos solicitudes de 9:00 a. m. a 7:00 p. m.; la sede debe confirmar cobertura, valor y tiempo de entrega según tu dirección. ¿Qué te gustaría comprar?',actions:[],checkout:{}};
 if(/\b(?:horario|hora|atienden|atencion)\b/.test(text)&&/whatsapp|este chat/.test(text))return {intent:'information',reply_text:'Por WhatsApp atendemos todos los días de 9:00 a. m. a 8:00 p. m., hora de Colombia. Los domicilios se gestionan hasta las 7:00 p. m.',actions:[],checkout:{}};
 if(!active&&(isPendingFollowup(s.message.text,s.pending_tasks)||isPendingPriceQuestion(s.message.text,s.pending_tasks)||text.length>12&&s.pending_tasks?.some(t=>normalize(t.question).endsWith(text)))){
  if(s.pending_tasks.length===1&&pendingNeedsReview(s.pending_tasks)){const t=s.pending_tasks[0];return {intent:'handoff',reply_text:'Lamento la espera. Aún no tengo la confirmación que necesitas; voy a consultar cómo sigue tu caso.',actions:[{type:'propose_human_task',reason:'missing_information',question:'El cliente solicita seguimiento de esta consulta: '+t.question.slice(0,500),related_message_id:s.message.id,task_id:t.id,priority:'high'}],checkout:{}};}
  return {intent:'clarification',reply_text:'Aún estoy pendiente de esa confirmación. Te responderemos por aquí cuando la tengamos.',actions:[],checkout:{}};}
 return employmentFollowupReply(s)||verifiedPriceReply(s)||socialReply(packet);
}
export const hasCommerce=decision=>decision.intent==='checkout'||decision.intent==='quote'||decision.intent==='qr'||decision.quote||decision.confirmed_item||decision.accept_summary||decision.cancel_cart;
export async function commitCommerce(env,context,decision){
 return rpc(env,'whatsapp_commerce_turn',{p_conversation:context.conversation.id,p_message:context.latest.id,p_control:context.conversation.control_version,p_context:context.conversation.context_version,p_resource:context.resourceVersion,p_request:context.requestId||context.latest.id,p_decision:decision});
}
export async function queueProductImages(env,context,ids){
 for(const id of ids||[])await rpc(env,'whatsapp_queue_product_image',{p_conversation:context.conversation.id,p_message:context.latest.id,p_control:context.conversation.control_version,p_context:context.conversation.context_version,p_resource:context.resourceVersion,p_product:id.replace(/^product:/,'')});
}
export function approvedReply(context,generated){return naturalResolutionText(generated,context.packet.snapshot.human_resolution.answer);}
export async function botMediaObject(env,_conversation,media){
 if(!media||!['product-images','whatsapp-payment-qr'].includes(media.bucket)||typeof media.storage_path!=='string'||!media.storage_path||/\.\.|[?#]/.test(media.storage_path)||!['image/jpeg','image/png','image/webp'].includes(media.mime_type))fail(409,'Imagen no autorizada.');
 const response=await fetch(env.SUPABASE_URL+'/storage/v1/object/'+media.bucket+'/'+media.storage_path.split('/').map(encodeURIComponent).join('/'),{headers:{apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY},signal:AbortSignal.timeout(5000)});
 if(!response.ok||Number(response.headers.get('Content-Length'))>5*1024*1024)fail(503,'No pudimos recuperar la imagen.');
 const bytes=new Uint8Array(await response.arrayBuffer());const png=[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!(media.mime_type==='image/png'?png:media.mime_type==='image/jpeg'?jpg:false))fail(409,'El contenido de la imagen no es válido.');
 if(!bytes.length||bytes.length>5*1024*1024)fail(503,'Imagen fuera del tamaño permitido.');
 return {bytes,mime:media.mime_type,filename:media.type==='qr'?'QR-Importados.'+(media.mime_type==='image/png'?'png':'jpg'):'Producto-Importados.'+(media.mime_type==='image/png'?'png':media.mime_type==='image/webp'?'webp':'jpg')};
}
export async function prepareBotImage(env,claim){
 const {bytes,mime,filename}=await botMediaObject(env,claim.conversation_id,claim.bot_media);
 const form=new FormData();form.set('messaging_product','whatsapp');form.set('type',mime);form.set('file',new Blob([bytes],{type:mime}),filename);
 const response=await fetch('https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION+'/'+env.WHATSAPP_PHONE_NUMBER_ID+'/media',{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN},body:form,signal:AbortSignal.timeout(5000)});
 const data=await response.json();if(!response.ok||!/^\d{5,30}$/.test(data.id||''))fail(503,'No pudimos preparar la imagen.');
 return {id:data.id,caption:claim.body};
}
export async function viewBotImage(env,c,messageId){const [m]=await db(env,'whatsapp_outbox?conversation_id=eq.'+c.id+'&message_id=eq.'+messageId+'&select=bot_media');if(!m?.bot_media)fail(404,'Imagen no disponible.');const {bytes,mime}=await botMediaObject(env,c.id,m.bot_media);return new Response(bytes,{headers:{'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
