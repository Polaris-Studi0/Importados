import {configuration,digest,fail,readBytes,readiness,reply,rpc} from './whatsapp-core.js';
const PHONE=/^[1-9]\d{7,14}$/;
const BSUID=/^[A-Z]{2}\.[A-Za-z0-9._:-]{6,253}$/;
export function whatsappIdentity(message){const phone=PHONE.test(message.from||'')?message.from:null;const bsuid=[message.from_user_id,message.from_parent_user_id].find(value=>typeof value==='string'&&BSUID.test(value))||null;return {phone,bsuid,id:bsuid||phone};}
function contactMatches(contact,message,identity){return !!(identity.phone&&contact.wa_id===identity.phone||message.from_user_id&&contact.user_id===message.from_user_id||message.from_parent_user_id&&contact.parent_user_id===message.from_parent_user_id);}
export async function verifySignature(bytes,header,secret){
 if(typeof secret!=='string'||!/^sha256=[0-9a-f]{64}$/.test(header||''))return false;
 const signature=Uint8Array.from(header.slice(7).match(/../g),pair=>parseInt(pair,16));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,signature,bytes);
}
export async function normalizeWebhook(payload,cfg){
 if(payload?.object!=='whatsapp_business_account'||!Array.isArray(payload.entry)||payload.entry.length>10)fail(400,'Evento de WhatsApp inválido.');
 const events=[];
 for(const entry of payload.entry){
  if(entry.id!==cfg.waba_id||!Array.isArray(entry.changes)||entry.changes.length>50)fail(403,'Activo de WhatsApp no autorizado.');
  for(const change of entry.changes){
   if(change.field!=='messages')continue;
   const value=change.value;
   if(value?.metadata?.phone_number_id!==cfg.phone_number_id)fail(403,'Número de WhatsApp no autorizado.');
   if(value.messages!==undefined&&!Array.isArray(value.messages)||value.statuses!==undefined&&!Array.isArray(value.statuses))fail(400,'Evento inválido.');
   for(const message of value.messages||[]){
    const identity=whatsappIdentity(message);
    if(!identity.id||typeof message.id!=='string'||message.id.length>256||!/^\d{9,13}$/.test(message.timestamp||''))fail(400,'Identidad o mensaje inválido.');
    const time=Number(message.timestamp)*1000;if(!Number.isFinite(time)||time>8640000000000000)fail(400,'Fecha inválida.');
    const kind=typeof message.type==='string'?message.type:'unknown';
    const text=kind==='text'?message.text?.body:kind==='button'?message.button?.text:kind==='interactive'?(message.interactive?.button_reply?.title||message.interactive?.list_reply?.title):message[kind]?.caption;
    if(text!==undefined&&(typeof text!=='string'||text.length>6000))fail(400,'Mensaje demasiado extenso.');
    const attachment=['image','audio','document','video','sticker'].includes(kind)&&typeof message[kind]?.id==='string'?{id:message[kind].id,kind,mime_type:message[kind].mime_type||null,filename:message[kind].filename?.slice(0,180)||null,persisted:true}:null;
    const contact=(value.contacts||[]).find(item=>contactMatches(item,message,identity));
    events.push({event_key:await digest(['message',entry.id,cfg.phone_number_id,message.id]),event_type:'message',waba_id:entry.id,phone_number_id:cfg.phone_number_id,identity_key:identity.id,customer_phone:identity.phone,customer_bsuid:identity.bsuid,customer_name:contact?.profile?.name?.slice(0,120)||null,meta_message_id:message.id,body:text||'',kind,attachment,occurred_at:new Date(time).toISOString()});
   }
   for(const status of value.statuses||[]){
    if(!['sent','delivered','read','failed'].includes(status.status))continue;
    if(typeof status.id!=='string'||status.id.length>256||!/^\d{9,13}$/.test(status.timestamp||''))fail(400,'Estado inválido.');
    events.push({event_key:await digest(['status',entry.id,cfg.phone_number_id,status.id,status.status,status.timestamp]),event_type:'status',waba_id:entry.id,phone_number_id:cfg.phone_number_id,meta_message_id:status.id,status:status.status,occurred_at:new Date(Number(status.timestamp)*1000).toISOString()});
   }
   if(events.length>100)fail(413,'Demasiados eventos.');
  }
 }
 return events;
}
export async function ingress(request,env,onMessages){
 const url=new URL(request.url);
 if(request.method==='GET'){
  const token=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge');
  if(!env.WHATSAPP_VERIFY_TOKEN||token!==env.WHATSAPP_VERIFY_TOKEN||url.searchParams.get('hub.mode')!=='subscribe'||!/^\d{1,128}$/.test(challenge||''))fail(403,'Verificación no autorizada.');
  return new Response(challenge,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
 }
 if(request.method!=='POST')fail(405,'Método no permitido.');
 if(env.WHATSAPP_INGRESS_ENABLED!=='true')fail(503,'WhatsApp permanece desactivado mientras se completa Meta.');
 const bytes=await readBytes(request,262144);
 if(!await verifySignature(bytes,request.headers.get('X-Hub-Signature-256'),env.WHATSAPP_APP_SECRET))fail(401,'Firma de WhatsApp inválida.');
 const cfg=await configuration(env);
 if(!readiness(env,cfg).ingress)fail(503,'Falta completar la configuración segura de WhatsApp.');
 let payload;try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Evento JSON inválido.');}
 // Validate the complete batch before any write. A partial DB failure returns non-2xx;
 // Meta's repeated delivery is harmless because each event has its own durable key.
 const events=await normalizeWebhook(payload,cfg);
 for(const event of events)await rpc(env,'whatsapp_receive_event',{p_event:event});
 if(events.some(event=>event.event_type==='message'))onMessages?.();
 return reply({ok:true,accepted:events.length});
}
