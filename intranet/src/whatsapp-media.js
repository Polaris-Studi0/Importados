import {db,digest,fail,readBytes,reply,uuid,SUPABASE_ORIGIN} from './whatsapp-core.js';
const BUCKET='whatsapp-operator-media';
const MAX=5*1024*1024;
const storageHeaders=env=>({apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY});
const objectUrl=path=>SUPABASE_ORIGIN+'/storage/v1/object/'+BUCKET+'/'+path.split('/').map(encodeURIComponent).join('/');
export async function uploadOperatorPhoto(request,env,actor,conversation){
 if(!conversation.manual_paused||conversation.status==='closed')fail(409,'Toma el control de la conversación antes de adjuntar una foto.');
 if(env.PUBLIC_LIMITER&&!((await env.PUBLIC_LIMITER.limit({key:'wa-photo:'+await digest(actor.id)})).success))fail(429,'Espera un minuto antes de subir otra foto.');
 const bytes=await readBytes(request,MAX+16384);
 let form;try{form=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('Content-Type')||''},body:bytes}).formData();}catch{fail(400,'Adjunta una foto JPG o PNG.');}
 const file=form.get('file'),id=form.get('request_id');
 if(!uuid(id)||!file||typeof file.arrayBuffer!=='function'||!['image/jpeg','image/png'].includes(file.type)||file.size<1||file.size>MAX)fail(400,'Usa una foto JPG o PNG de hasta 5 MB.');
 const data=new Uint8Array(await file.arrayBuffer());
 const jpeg=data[0]===255&&data[1]===216&&data[2]===255;
 const png=[137,80,78,71,13,10,26,10].every((b,i)=>data[i]===b);
 if(!(file.type==='image/jpeg'?jpeg:png))fail(400,'El contenido del archivo no corresponde a una foto JPG o PNG.');
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const existing=await db(env,'whatsapp_operator_media?id=eq.'+id+'&select=*');
 const same=row=>row.conversation_id===conversation.id&&row.actor_id===actor.id&&row.sha256===sha;
 if(existing.length){if(!same(existing[0]))fail(409,'Este intento corresponde a otra foto. Vuelve a seleccionarla.');return reply({ok:true,media:{id,mime_type:file.type}},200);}
 const path=conversation.id+'/'+actor.id+'/'+id+'-'+sha.slice(0,16)+(jpeg?'.jpg':'.png');
 const upload=await fetch(objectUrl(path),{method:'POST',headers:{...storageHeaders(env),'Content-Type':file.type,'x-upsert':'false'},body:data,signal:AbortSignal.timeout(15000)});
 if(!upload.ok&&upload.status!==409)fail(503,'No pudimos guardar la foto. Puedes reintentar con el mismo archivo.');
 const row={id,conversation_id:conversation.id,actor_id:actor.id,storage_path:path,mime_type:file.type,size_bytes:data.byteLength,sha256:sha,filename:String(file.name||'foto').replace(/[\u0000-\u001f\\/]/g,'_').slice(0,120)};
 try{await db(env,'whatsapp_operator_media',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});}catch(error){const [saved]=await db(env,'whatsapp_operator_media?id=eq.'+id+'&select=*');if(!saved||!same(saved))throw error;}
 return reply({ok:true,media:{id,mime_type:file.type}},201);
}
export async function photoObject(env,id,conversationId){
 if(!uuid(id))fail(404,'Foto no encontrada.');
 const [photo]=await db(env,'whatsapp_operator_media?id=eq.'+id+'&conversation_id=eq.'+conversationId+'&select=*');
 if(!photo)fail(404,'Foto no encontrada en esta conversación.');
 const result=await fetch(objectUrl(photo.storage_path),{headers:storageHeaders(env),signal:AbortSignal.timeout(6000)});
 if(!result.ok||Number(result.headers.get('Content-Length'))>MAX)fail(503,'No pudimos recuperar la foto.');
 const bytes=new Uint8Array(await result.arrayBuffer());if(bytes.length>MAX||bytes.length!==photo.size_bytes)fail(503,'No pudimos verificar la foto.');
 return {photo,bytes};
}
export async function viewOperatorPhoto(env,id,conversationId){const {photo,bytes}=await photoObject(env,id,conversationId);return new Response(bytes,{headers:{'Content-Type':photo.mime_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
export async function prepareOperatorImage(env,claim){
 const {photo,bytes}=await photoObject(env,claim.media_asset_id,claim.conversation_id);
 const form=new FormData();form.set('messaging_product','whatsapp');form.set('type',photo.mime_type);form.set('file',new Blob([bytes],{type:photo.mime_type}),photo.filename);
 const response=await fetch('https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION+'/'+env.WHATSAPP_PHONE_NUMBER_ID+'/media',{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN},body:form,signal:AbortSignal.timeout(6000)});
 const data=await response.json();if(!response.ok||typeof data.id!=='string'||!/^\d{5,30}$/.test(data.id))fail(503,'Meta no pudo preparar la foto.');
 return {id:data.id,caption:claim.body};
}
