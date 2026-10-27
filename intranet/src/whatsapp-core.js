// All Importados database access stays on the server. No service credential reaches n8n.
export const SUPABASE_ORIGIN='https://opeytkcqblgjfyvfjkwe.supabase.co';
export const APP_ID='1378513457688529';
export const NUMBER='+573127062214';
export class WhatsAppError extends Error {constructor(status,message){super(message);this.status=status;}}
export const fail=(status,message)=>{throw new WhatsAppError(status,message);};
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const flag=value=>value===true||value==='true';
export const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');
export const reply=(data,status=200,origin)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{})}});
export async function db(env,path,options={}){
 if(env.SUPABASE_URL!==SUPABASE_ORIGIN||!env.SUPABASE_SERVICE_KEY)fail(503,'El servicio de Importados no está disponible.');
 const result=await fetch(SUPABASE_ORIGIN+'/rest/v1/'+path,{...options,headers:{apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000)});
 if(!result.ok){const error=await result.json().catch(()=>null);if(error?.code==='P0001')fail(409,/^(La conversación cambió|El envío requiere|Foto no disponible|Pendiente no disponible|Agrega una respuesta|Mensaje inválido|Identificador reutilizado)/.test(error.message||'')?error.message:'No se pudo completar esta acción. Actualiza la conversación.');fail(result.status===404?503:result.status===400?409:503,'No pudimos completar la operación de WhatsApp. Actualiza la conversación antes de intentar de nuevo.');}
 return result.status===204?null:result.json();
}
export const rpc=(env,name,body={})=>db(env,'rpc/'+name,{method:'POST',body:JSON.stringify(body)});
export async function configuration(env){
 const [config]=await db(env,'whatsapp_config?id=eq.true&select=*');
 if(!config)fail(503,'Falta preparar WhatsApp en Importados.');
 return config;
}
export function readiness(env,cfg){
 const identifiers=env.WHATSAPP_APP_ID===APP_ID&&cfg.app_id===APP_ID&&/^\d{5,30}$/.test(env.WHATSAPP_PHONE_NUMBER_ID||'')&&env.WHATSAPP_PHONE_NUMBER_ID===cfg.phone_number_id&&/^\d{5,30}$/.test(env.WHATSAPP_WABA_ID||'')&&env.WHATSAPP_WABA_ID===cfg.waba_id;
 const privacy=typeof cfg.privacy_url==='string'&&cfg.privacy_url.startsWith('https://tiendasimportados.com/')&&!!cfg.privacy_version;
 const credentials=!!env.WHATSAPP_APP_SECRET&&!!env.WHATSAPP_ACCESS_TOKEN&&!!env.WHATSAPP_VERIFY_TOKEN;
 const graph=/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION||'');
 const activation=typeof cfg.public_since==='string'&&Number.isFinite(Date.parse(cfg.public_since))&&Date.parse(cfg.public_since)<=Date.now();
 const ready=identifiers&&privacy&&credentials&&graph&&activation;
 const ingress=ready&&flag(env.WHATSAPP_INGRESS_ENABLED)&&cfg.ingress_enabled;
 const ai=ingress&&flag(env.BOT_AI_ENABLED)&&cfg.ai_enabled&&!!env.N8N_WEBHOOK_SECRET&&validWorkflowUrl(env.N8N_BOT_WEBHOOK_URL);
 const outbound=ready&&flag(env.WHATSAPP_OUTBOUND_ENABLED)&&cfg.outbound_enabled;
 return {ready,ingress,ai,outbound,identifiers,privacy,credentials,graph,activation};
}
export function validWorkflowUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='intranetelrey.app.n8n.cloud'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/webhook/importados-assistant-turn-v1';}catch{return false;}}
export async function readBytes(request,max=24576){
 const length=Number(request.headers.get('Content-Length'));if(length>max)fail(413,'La solicitud es demasiado extensa.');
 const reader=request.body?.getReader();if(!reader)fail(400,'Faltan datos.');
 let size=0;const parts=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail(413,'La solicitud es demasiado extensa.');}parts.push(value);}
 const all=new Uint8Array(size);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}return all;
}
export async function readJson(request,max=24576){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Envía datos JSON.');
 try{const data=JSON.parse(new TextDecoder().decode(await readBytes(request,max)));if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'Datos inválidos.');return data;}catch(error){if(error instanceof WhatsAppError)throw error;fail(400,'No pudimos leer la solicitud.');}
}
export async function staff(request,env,adminOnly=false){
 const token=request.headers.get('Authorization');if(!/^Bearer [\w.-]+$/.test(token||''))fail(401,'Inicia sesión para continuar.');
 if(env.SUPABASE_URL!==SUPABASE_ORIGIN||!env.SUPABASE_SERVICE_KEY)fail(503,'El servicio de Importados no está disponible.');
 const result=await fetch(SUPABASE_ORIGIN+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_KEY,Authorization:token},signal:AbortSignal.timeout(10000)});
 if(!result.ok)fail(401,'Tu sesión venció. Ingresa nuevamente.');
 const user=await result.json();if(!uuid(user.id))fail(401,'Tu sesión no es válida.');
 const [profile]=await db(env,'profiles?id=eq.'+encodeURIComponent(user.id)+'&select=id,role,branch_id,active');
 if(!profile?.active||!['admin','cashier'].includes(profile.role)||(adminOnly&&profile.role!=='admin'))fail(403,'No tienes permiso para este acceso.');
 return profile;
}
export const canAccess=(profile,conversation)=>profile.role==='admin'||(!!conversation.branch_id&&profile.branch_id===conversation.branch_id);
export async function scopedConversation(env,profile,id){
 if(!uuid(id))fail(404,'Conversación no encontrada.');
 const [conversation]=await db(env,'whatsapp_conversations?id=eq.'+id+'&select=*');
 if(!conversation||!canAccess(profile,conversation))fail(404,'Conversación no encontrada.');return conversation;
}
export function canSend(env,cfg,c){const state=readiness(env,cfg);return state.outbound&&c.manual_paused&&c.status==='open'&&c.consent_status==='granted'&&c.consent_version===cfg.privacy_version&&Date.parse(c.last_customer_at)>Date.now()-86400000;}
