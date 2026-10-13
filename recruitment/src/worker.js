const FILE_LIMIT=5*1024*1024;
const BODY_LIMIT=FILE_LIMIT+128*1024;
const CONSENT_VERSION='recruitment-2026-10-12';
const allowedOrigins=['https://tiendasimportados.com','https://www.tiendasimportados.com'];
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
function fail(status,message){throw new HttpError(status,message);}
function json(data,status=200,origin){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{}),...(status===429?{'Retry-After':'60'}:{})}});}
const timeout=()=>AbortSignal.timeout(15000);
async function hash(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function boundedBody(request){const size=Number(request.headers.get('Content-Length')||0);if(size>BODY_LIMIT)fail(413,'El archivo supera el límite de 5 MB.');const reader=request.body?.getReader();if(!reader)fail(400,'No recibimos tu formulario.');const chunks=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>BODY_LIMIT){await reader.cancel();fail(413,'El archivo supera el límite de 5 MB.');}chunks.push(value);}const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new Response(bytes,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();}
function field(form,key,max){const value=form.get(key);if(typeof value!=='string')fail(400,'Revisa los campos del formulario.');const cleaned=value.trim();if(!cleaned||cleaned.length>max||/[\x00-\x1f\x7f]/.test(cleaned))fail(400,'Revisa los campos del formulario.');return cleaned;}
function supabaseHeaders(env,extra={}){return {apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY,...extra};}
function baseUrl(env){const url=new URL(env.SUPABASE_URL);if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co'))throw new Error('invalid_service_configuration');return url.origin;}
async function rest(env,path,options={}){return fetch(baseUrl(env)+'/rest/v1/'+path,{...options,headers:supabaseHeaders(env,{'Content-Type':'application/json',...options.headers}),signal:timeout()});}
export function ready(env){return env.RECRUITMENT_ENABLED==='true'&&!!env.SUPABASE_URL&&!!env.SUPABASE_SERVICE_KEY&&!!env.TURNSTILE_SECRET_KEY&&!!env.TURNSTILE_SITE_KEY;}
export async function receiveApplication(request,env,origin){
  if(!ready(env))fail(503,'Estamos preparando la recepción. Puedes enviarnos tu hoja de vida por correo.');
  if(!request.headers.get('Content-Type')?.startsWith('multipart/form-data;'))fail(415,'Envía el formulario con tu archivo PDF.');
  const ip=request.headers.get('CF-Connecting-IP');
  if(ip&&env.INGRESS_LIMITER){const {success}=await env.INGRESS_LIMITER.limit({key:'cv:'+await hash(ip)});if(!success)fail(429,'Hemos recibido varios intentos. Espera un minuto y vuelve a intentar.');}
  const form=await boundedBody(request);
  const name=field(form,'name',120),email=field(form,'email',254).toLowerCase(),phone=field(form,'phone',20),branch=field(form,'branch',20),id=field(form,'request_id',36);
  if(name.length<2||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[+\d()\s-]{7,20}$/.test(phone)||phone.replace(/\D/g,'').length<7||!['santa-lucia','niquia','cualquiera'].includes(branch)||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))fail(400,'Revisa tu nombre, correo, celular y sede.');
  const vacancyId=form.get('vacancy_id')||null;
  if(vacancyId&&(typeof vacancyId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vacancyId)))fail(400,'Selecciona una vacante válida.');
  if(form.get('consent')!=='on')fail(400,'Necesitamos tu autorización para recibir la postulación.');
  const token=field(form,'cf-turnstile-response',2048);
  const cv=form.get('cv');if(!cv||typeof cv==='string'||!cv.size)fail(400,'Selecciona tu hoja de vida en PDF.');
  if(cv.size>FILE_LIMIT)fail(413,'Tu PDF debe pesar máximo 5 MB.');
  if(!/\.pdf$/i.test(cv.name)||(cv.type&&cv.type!=='application/pdf'))fail(415,'Solo recibimos archivos PDF.');
  const bytes=await cv.arrayBuffer();const start=new TextDecoder().decode(bytes.slice(0,8));const end=new TextDecoder().decode(bytes.slice(-1024));
  if(!start.startsWith('%PDF-')||!end.includes('%%EOF'))fail(415,'El archivo no parece un PDF válido. Exporta tu hoja de vida como PDF e intenta de nuevo.');
  const verification=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,...(ip?{remoteip:ip}:{})}),signal:timeout()});
  if(!verification.ok)fail(503,'No pudimos verificar el envío. Intenta de nuevo.');
  const validated=await verification.json();if(!validated.success||validated.action!=='recruitment'||validated.hostname!==new URL(origin).hostname)fail(400,'La verificación venció o no es válida. Completa la verificación de nuevo.');
  if(env.APPLICANT_LIMITER){const {success}=await env.APPLICANT_LIMITER.limit({key:await hash(email)});if(!success)fail(429,'Espera un minuto antes de enviar otra postulación.');}
  const payloadHash=await hash(JSON.stringify([name,email,phone,branch,await hash(bytes),CONSENT_VERSION,...(vacancyId?[vacancyId]:[])]));
  let existingApplication=null;
  if(vacancyId){
    // Reconfirm or complete the original attempt even if its vacancy has since
    // closed. No receipt or file is reused without the exact verified payload.
    const previous=await rest(env,'job_applications?id=eq.'+id+'&select=receipt,payload_hash,status');
    if(!previous.ok)fail(503,'No pudimos confirmar tu postulación. Vuelve a intentar con los mismos datos.');
    [existingApplication]=await previous.json();
    if(existingApplication){
      if(existingApplication.payload_hash!==payloadHash)fail(409,'Este intento no corresponde a los mismos datos. Recarga la página antes de enviar una nueva postulación.');
      if(existingApplication.status==='received')return json({ok:true,receipt:existingApplication.receipt},200,origin);
      if(existingApplication.status!=='uploading')fail(503,'No pudimos confirmar tu postulación. Escríbenos al correo de selección.');
    }else{
      const vacancy=await rest(env,'vacancies?id=eq.'+vacancyId+'&status=eq.published&select=id');
      if(!vacancy.ok)fail(503,'No pudimos consultar esta vacante. Intenta de nuevo más tarde.');
      if((await vacancy.json()).length!==1)fail(400,'Esta vacante ya no está disponible. Puedes realizar una postulación general.');
    }
  }
  const path=id+'.pdf',receipt=existingApplication?.receipt||'IMP-'+id.replaceAll('-','').slice(0,12).toUpperCase();
  const row={id,receipt,name,email,phone,branch,object_path:path,file_size:cv.size,payload_hash:payloadHash,consent_version:CONSENT_VERSION,...(vacancyId?{vacancy_id:vacancyId}:{})};
  if(!existingApplication){
    const insert=await rest(env,'job_applications',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
    if(insert.status===409){const previous=await rest(env,'job_applications?id=eq.'+id+'&select=receipt,payload_hash,status');if(!previous.ok)fail(503,'No pudimos confirmar tu postulación. Escríbenos al correo de selección.');const [existing]=await previous.json();if(existing?.payload_hash===payloadHash&&existing.status==='received')return json({ok:true,receipt:existing.receipt},200,origin);if(existing?.payload_hash!==payloadHash)fail(409,'Este intento no corresponde a los mismos datos. Recarga la página antes de enviar una nueva postulación.');}
    if(!insert.ok&&insert.status!==409)fail(503,'No pudimos registrar tu postulación. Intenta de nuevo más tarde.');
  }
  let uploaded=false;
  try{
    const upload=await fetch(baseUrl(env)+'/storage/v1/object/hojas-de-vida/'+path,{method:'POST',headers:supabaseHeaders(env,{'Content-Type':'application/pdf','x-upsert':'false'}),body:bytes,signal:timeout()});
    if(!upload.ok){const prior=await fetch(baseUrl(env)+'/storage/v1/object/authenticated/hojas-de-vida/'+path,{headers:supabaseHeaders(env),signal:timeout()});if(!prior.ok||await hash(await prior.arrayBuffer())!==await hash(bytes))throw new Error('storage_upload_failed');}uploaded=true;
    const complete=await rest(env,'job_applications?id=eq.'+id,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'received'})});
    if(!complete.ok)throw new Error('application_confirmation_failed');const [saved]=await complete.json();if(saved?.status!=='received')throw new Error('application_not_confirmed');
    return json({ok:true,receipt},201,origin);
  }catch(error){
    // No registrar campos, nombres de archivos, claves ni respuestas de proveedores.
    console.error('recruitment_submission_incomplete');
    // Conservar el registro para resolver fallos ambiguos: una actualización pudo confirmarse antes de perder la respuesta.
    // Los reintentos con el mismo request_id no duplican ni sobrescriben archivos.
    fail(503,uploaded?'No pudimos confirmar el envío. Conserva este intento y vuelve a intentar; si persiste, escríbenos al correo de selección.':'No pudimos confirmar la recepción. Intenta nuevamente; si persiste, escríbenos al correo de selección.');
  }
}
export default {async fetch(request,env){const origin=request.headers.get('Origin'),allowed=allowedOrigins.includes(origin);try{
  const {pathname}=new URL(request.url);
  if(request.method==='GET'&&pathname==='/health')return json({ok:true});
  if(origin&&!allowed)return json({ok:false,message:'Origen no permitido.'},403);
  if(request.method==='OPTIONS'){if(!allowed)return json({ok:false},403);return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}});}
  if(pathname==='/api/recruitment/config'&&request.method==='GET')return json({enabled:ready(env),siteKey:ready(env)?env.TURNSTILE_SITE_KEY:null,maxFileBytes:FILE_LIMIT,contactEmail:'Importados@polaris-studio.tech'},200,allowed?origin:undefined);
  if(pathname!=='/api/recruitment/applications')return json({ok:false,message:'Ruta no encontrada.'},404,allowed?origin:undefined);
  if(request.method!=='POST')return json({ok:false,message:'Método no permitido.'},405,allowed?origin:undefined);
  if(!allowed)return json({ok:false,message:'Origen no permitido.'},403);
  return await receiveApplication(request,env,origin);
}catch(error){return json({ok:false,message:error instanceof HttpError?error.message:'No pudimos confirmar el envío. Intenta más tarde o escríbenos al correo de selección.'},error instanceof HttpError?error.status:503,allowed?origin:undefined);}}};
