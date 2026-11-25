import {db,fail,readBytes,reply,uuid} from './whatsapp-core.js';
export async function paymentAssets(request,env,actor){
 if(actor.role!=='admin')fail(403,'Solo administración puede gestionar los medios de pago.');
 if(request.method==='GET')return reply({assets:await db(env,'whatsapp_payment_assets?select=id,branch_id,label,active,updated_at&order=branch_id')});
 if(request.method!=='POST')fail(405,'Método no permitido.');
 const bytes=await readBytes(request,5*1024*1024+16384);let form;
 try{form=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('Content-Type')||''},body:bytes}).formData();}catch{fail(400,'Selecciona el QR de la sede.');}
 const file=form.get('file'),id=form.get('request_id'),branch=form.get('branch_id'),label=String(form.get('label')||'QR de pago · Importados').trim();
 if(!uuid(id)||!['santa-lucia','niquia'].includes(branch)||!file?.size||file.size>5*1024*1024||!['image/jpeg','image/png'].includes(file.type)||!label||label.length>160)fail(400,'Revisa la sede y selecciona un QR JPG o PNG de hasta 5 MB.');
 const data=new Uint8Array(await file.arrayBuffer()),png=[137,80,78,71,13,10,26,10].every((b,i)=>data[i]===b),jpg=data[0]===255&&data[1]===216&&data[2]===255;
 if(!(file.type==='image/png'?png:jpg))fail(400,'El archivo no corresponde al formato indicado.');
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const path=branch+'/'+id+'-'+sha.slice(0,16)+(png?'.png':'.jpg');
 const res=await fetch(env.SUPABASE_URL+'/storage/v1/object/whatsapp-payment-qr/'+path,{method:'POST',headers:{apikey:env.SUPABASE_SERVICE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_KEY,'Content-Type':file.type,'x-upsert':'false'},body:data,signal:AbortSignal.timeout(15000)});
 if(!res.ok&&res.status!==409)fail(503,'No pudimos guardar el QR. Reintenta con el mismo archivo.');
 // One current QR per branch; previous stored objects remain private for audit.
 const result=await db(env,'whatsapp_payment_assets?on_conflict=branch_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({branch_id:branch,storage_path:path,label,mime_type:file.type,active:true,updated_at:new Date().toISOString()})});
 return reply({ok:true,asset:{id:result[0].id,branch_id:branch,label}},201);
}
