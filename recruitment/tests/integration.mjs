// Prueba con datos sintéticos y Supabase real; se sustituye solo Siteverify.
// No equivale a una prueba del desafío humano en el navegador.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
const dir=process.env.HOME+'/.config/importados';
const keys=JSON.parse(fs.readFileSync(dir+'/supabase-keys.json'));
const key=keys.find(x=>x.name==='service_role').api_key;
const anon=keys.find(x=>x.name==='anon').api_key;
const base='https://opeytkcqblgjfyvfjkwe.supabase.co';
const id=crypto.randomUUID(),path=id+'.pdf';
const env={RECRUITMENT_ENABLED:'true',SUPABASE_URL:base,SUPABASE_SERVICE_KEY:key,TURNSTILE_SECRET_KEY:'synthetic-verification-only',TURNSTILE_SITE_KEY:'synthetic'};
const original=globalThis.fetch;
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const pdf='%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\n%%EOF';
const form=()=>{const f=new FormData();for(const[k,v]of Object.entries({name:'TEST TECNICO - NO CANDIDATO',email:'integracion@example.invalid',phone:'3000000000',branch:'niquia',consent:'on','cf-turnstile-response':'synthetic',request_id:id}))f.append(k,v);f.append('cv',new Blob([pdf],{type:'application/pdf'}),'test-tecnico.pdf');return new Request('https://api.example/api/recruitment/applications',{method:'POST',headers:{Origin:'https://tiendasimportados.com'},body:f});};
try{
 globalThis.fetch=async(url,options)=>String(url).includes('challenges.cloudflare.com/turnstile/')?new Response(JSON.stringify({success:true,action:'recruitment',hostname:'tiendasimportados.com'})):original(url,options);
 const first=await worker.fetch(form(),env);const result=await first.json();assert.equal(first.status,201,JSON.stringify(result));assert.equal(result.ok,true);
 const stored=await original(base+'/rest/v1/job_applications?id=eq.'+id+'&select=id,status,object_path',{headers});assert.equal(stored.status,200);const rows=await stored.json();assert.equal(rows.length,1);assert.equal(rows[0].status,'received');assert.equal(rows[0].object_path,path);
 const file=await original(base+'/storage/v1/object/authenticated/hojas-de-vida/'+path,{headers});assert.equal(file.status,200);assert.equal(await file.text(),pdf);
 const anonymous=await original(base+'/storage/v1/object/public/hojas-de-vida/'+path,{headers:{apikey:anon}});assert.ok(!anonymous.ok,'Un CV privado no debe descargarse públicamente');
 const publicTable=await original(base+'/rest/v1/job_applications?select=id',{headers:{apikey:anon,Authorization:'Bearer '+anon}});assert.ok(!publicTable.ok,'La tabla no debe ser pública');
 const repeat=await worker.fetch(form(),env);assert.equal(repeat.status,200);assert.equal((await repeat.json()).receipt,result.receipt);
 console.log('Integración real: archivo privado y registro recibido verificados; reintento idempotente; acceso anónimo bloqueado.');
}finally{
 globalThis.fetch=original;
 const removeFile=await original(base+'/storage/v1/object/hojas-de-vida',{method:'DELETE',headers,body:JSON.stringify({prefixes:[path]})});assert.ok(removeFile.ok,'No se pudo retirar el archivo sintético');
 const removeRow=await original(base+'/rest/v1/job_applications?id=eq.'+id,{method:'DELETE',headers});assert.ok(removeRow.ok,'No se pudo retirar el registro sintético');
 console.log('Datos sintéticos retirados; ninguna postulación de cliente fue modificada.');
}
