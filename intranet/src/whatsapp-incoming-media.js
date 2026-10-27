import {db,fail,readBytes,rpc,uuid,SUPABASE_ORIGIN} from './whatsapp-core.js';

const BUCKET='whatsapp-incoming-media';
const MiB=1024*1024;
const TYPES={
 'image/jpeg':[5,'.jpg'],'image/png':[5,'.png'],'image/webp':[5,'.webp'],
 'application/pdf':[10,'.pdf'],'text/plain':[10,'.txt'],
 'application/msword':[10,'.doc'],'application/vnd.ms-excel':[10,'.xls'],'application/vnd.ms-powerpoint':[10,'.ppt'],
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':[10,'.docx'],
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':[10,'.xlsx'],
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':[10,'.pptx'],
 'audio/ogg':[16,'.ogg'],'audio/mpeg':[16,'.mp3'],'audio/mp4':[16,'.m4a'],'audio/aac':[16,'.aac'],'audio/amr':[16,'.amr'],
 'video/mp4':[16,'.mp4'],'video/3gpp':[16,'.3gp']
};
const headers=env=>({apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY});
const objectUrl=path=>SUPABASE_ORIGIN+'/storage/v1/object/'+BUCKET+'/'+path.split('/').map(encodeURIComponent).join('/');
const mime=value=>String(value||'').split(';')[0].trim().toLowerCase();
const error=(code)=>Object.assign(new Error(code),{mediaCode:code});
export function trustedMediaUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&
  (u.hostname==='lookaside.fbsbx.com'||u.hostname==='mmg.whatsapp.net'||u.hostname.endsWith('.whatsapp.net')||u.hostname==='scontent.whatsapp.net'||u.hostname.endsWith('.fbcdn.net'));
 }catch{return false;}
}
export function matchesFile(bytes,type){
 const starts=(...v)=>v.every((b,i)=>bytes[i]===b);const ascii=(a,b)=>new TextDecoder().decode(bytes.slice(a,b));
 if(type==='image/jpeg')return starts(255,216,255);
 if(type==='image/png')return starts(137,80,78,71,13,10,26,10);
 if(type==='image/webp')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
 if(type==='application/pdf')return ascii(0,5)==='%PDF-';
 if(type.includes('openxmlformats'))return starts(80,75,3,4);
 if(['application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint'].includes(type))return starts(208,207,17,224,161,177,26,225);
 if(type==='text/plain'){try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return !bytes.includes(0);}catch{return false;}}
 if(type==='audio/ogg')return ascii(0,4)==='OggS';
 if(type==='audio/amr')return ascii(0,5)==='#!AMR';
 if(['audio/mp4','video/mp4','video/3gpp'].includes(type))return ascii(4,8)==='ftyp';
 if(type==='audio/mpeg')return ascii(0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
 if(type==='audio/aac')return bytes[0]===255&&(bytes[1]&246)===240;
 return false;
}
export async function providerFile(env,claim){
 if(!/^\d{5,30}$/.test(claim.meta_media_id)||!/^\d{5,30}$/.test(claim.phone_number_id)||!/^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION||''))throw error('invalid_reference');
 const auth={Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN};
 const info=await fetch('https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION+'/'+claim.meta_media_id+'?phone_number_id='+claim.phone_number_id,{headers:auth,redirect:'manual',signal:AbortSignal.timeout(6000)});
 if(!info.ok)throw error(info.status===400||info.status===404?'provider_unavailable':'provider_retry');
 const data=await info.json(),type=mime(data.mime_type),limit=TYPES[type]?.[0]*MiB;
 if(data.id!==claim.meta_media_id||!trustedMediaUrl(data.url))throw error('invalid_provider_reference');
 if(!limit)throw error('unsupported_type');
 if(!Number.isSafeInteger(Number(data.file_size))||Number(data.file_size)<1||Number(data.file_size)>limit)throw error('size_limit');
 const expectedKind=type.startsWith('image/')?'image':type.startsWith('audio/')?'audio':type.startsWith('video/')?'video':'document';
 if((claim.kind==='sticker'?'image':claim.kind)!==expectedKind)throw error('invalid_file_type');
 let target=data.url,response;
 for(let hops=0;hops<3;hops++){
  if(!trustedMediaUrl(target))throw error('invalid_provider_reference');
  response=await fetch(target,{headers:auth,redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(![301,302,303,307,308].includes(response.status))break;
  const location=response.headers.get('Location');await response.body?.cancel();
  if(!location)throw error('invalid_provider_reference');target=new URL(location,target).href;
 }
 if(!response?.ok)throw error('provider_download_http_'+(response?.status||0));
 const bytes=await readBytes(response,limit);
 if(bytes.length!==Number(data.file_size)||!matchesFile(bytes,type))throw error('invalid_file_type');
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const base64=btoa(String.fromCharCode(...sha.match(/../g).map(n=>parseInt(n,16))));
 if(data.sha256!==sha&&data.sha256!==base64)throw error('integrity_failed');
 return {bytes,type,sha};
}
export async function receiveIncomingMedia(env,messageId=null){
 if(!env.WHATSAPP_ACCESS_TOKEN)return {stored:false};
 const claim=await rpc(env,'whatsapp_claim_incoming_media',{p_message:messageId});if(!claim)return {stored:false};
 try{
  const {bytes,type,sha}=await providerFile(env,claim),path=claim.conversation_id+'/'+claim.message_id;
  const upload=await fetch(objectUrl(path),{method:'POST',headers:{...headers(env),'Content-Type':type,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(8000)});
  if(!upload.ok&&upload.status!==409)throw error('storage_retry');
  const saved=await rpc(env,'whatsapp_finish_incoming_media',{p_message:claim.message_id,p_lease:claim.lease_token,p_status:'stored',p_data:{storage_path:path,mime_type:type,sha256:sha,size_bytes:bytes.length}});
  return {stored:saved,message_id:claim.message_id};
 }catch(e){
  const code=e.mediaCode||'download_retry';
  const state=['unsupported_type','size_limit','invalid_file_type','integrity_failed','invalid_reference','invalid_provider_reference'].includes(code)?'unsupported':code==='provider_unavailable'?'unavailable':'failed';
  await rpc(env,'whatsapp_finish_incoming_media',{p_message:claim.message_id,p_lease:claim.lease_token,p_status:state,p_data:{error:code}});
  return {stored:false,reason:code};
 }
}
export async function viewIncomingMedia(env,conversation,messageId){
 if(!uuid(messageId))fail(404,'Archivo no encontrado.');
 const [message]=await db(env,'whatsapp_messages?id=eq.'+messageId+'&conversation_id=eq.'+conversation.id+'&direction=eq.inbound&select=id,attachment');
 if(!message?.attachment?.id)fail(404,'Archivo no encontrado en esta conversación.');
 const [cfg]=await db(env,'whatsapp_config?id=eq.true&select=privacy_version');
 if(conversation.consent_status!=='granted'||conversation.consent_version!==cfg?.privacy_version)fail(409,'El cliente debe autorizar el tratamiento de sus datos para abrir el archivo.');
 let [file]=await db(env,'whatsapp_incoming_media?message_id=eq.'+messageId+'&conversation_id=eq.'+conversation.id+'&select=*');
 if(!file)fail(404,'No hay una referencia recuperable para este archivo.');
 if(['pending','failed'].includes(file.status)){
  await receiveIncomingMedia(env,messageId);
  [file]=await db(env,'whatsapp_incoming_media?message_id=eq.'+messageId+'&conversation_id=eq.'+conversation.id+'&select=*');
 }
 if(file.status!=='stored'){
  if(file.status==='unsupported')fail(415,file.last_error==='size_limit'?'El archivo supera el límite: imágenes 5 MB, documentos 10 MB, audio y video 16 MB.':'El formato del archivo no se puede abrir de forma segura. Solicita una imagen JPG/PNG o un PDF.');
  if(file.status==='unavailable')fail(410,'Meta ya no permite recuperar este archivo. Pídele al cliente que lo vuelva a enviar.');
  fail(503,file.status==='fetching'?'El archivo se está preparando. Intenta abrirlo nuevamente en unos segundos.':'No pudimos descargar el archivo. Intenta de nuevo; si persiste, pide al cliente que lo reenvíe.');
 }
 // Recheck scope and revocation after the potentially slow provider call.
 const [current]=await db(env,'whatsapp_conversations?id=eq.'+conversation.id+'&select=branch_id,consent_status,consent_version');
 if(!current||current.branch_id!==conversation.branch_id||current.consent_status!=='granted'||current.consent_version!==cfg.privacy_version)fail(409,'El acceso a la conversación cambió. Actualiza antes de abrir el archivo.');
 const type=mime(file.mime_type),limit=TYPES[type]?.[0]*MiB;
 if(!limit||file.storage_path!==conversation.id+'/'+messageId)fail(404,'Archivo no disponible.');
 const response=await fetch(objectUrl(file.storage_path),{headers:headers(env),signal:AbortSignal.timeout(8000)});
 if(!response.ok)fail(503,'No pudimos abrir el archivo guardado. Intenta nuevamente.');
 const bytes=await readBytes(response,limit);
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(bytes.length!==file.size_bytes||sha!==file.sha256)fail(503,'No pudimos verificar el archivo.');
 const filename=String(file.filename||'archivo'+TYPES[type][1]).replace(/[\u0000-\u001f\u007f"\\/<>]/g,'_').slice(0,120);
 return new Response(bytes,{headers:{'Content-Type':type,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(filename),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
}
