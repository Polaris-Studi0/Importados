import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import vm from 'node:vm';
import fs from 'node:fs';
const origin='https://tiendasimportados.com',url='https://api.example/api/recruitment/applications';
const id='a60c9f2f-f1b8-4b0b-88c8-41bdf437af4e',pdf='%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\n%%EOF';
const env={RECRUITMENT_ENABLED:'true',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_KEY:'server-only-test-key',TURNSTILE_SITE_KEY:'public',TURNSTILE_SECRET_KEY:'private',INGRESS_LIMITER:{limit:async()=>({success:true})},APPLICANT_LIMITER:{limit:async()=>({success:true})}};
function request(overrides={},headers={}){const f=new FormData();for(const [k,v] of Object.entries({name:'Persona de prueba',email:'prueba@example.invalid',phone:'3001234567',branch:'niquia',consent:'on','cf-turnstile-response':'synthetic-token',request_id:id,...overrides}))if(v!==null)f.append(k,v);if(!f.has('cv'))f.append('cv',new Blob([pdf],{type:'application/pdf'}),'prueba.pdf');return new Request(url,{method:'POST',headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.10',...headers},body:f});}
async function mocked(fn,responses){const original=globalThis.fetch;const calls=[];globalThis.fetch=async(u,o={})=>{calls.push({u:String(u),...o});const response=responses.shift();assert.ok(response,'Unexpected upstream call: '+u);return typeof response==='function'?response(u,o):response;};try{await fn(calls);}finally{globalThis.fetch=original;}}
const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
const verified=()=>json({success:true,action:'recruitment',hostname:'tiendasimportados.com'});
test('rejects foreign origins and direct posts without Origin',async()=>{for(const Origin of ['https://evil.example','null','']){const r=await worker.fetch(request({}, {Origin}),env);assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);}});
test('unconfigured service refuses submission and advertises disabled',async()=>{const r=await worker.fetch(request(),{});assert.equal(r.status,503);const config=await worker.fetch(new Request('https://api.example/api/recruitment/config'),{});assert.equal((await config.json()).enabled,false);});
test('requires consent and valid contact fields before contacting providers',async()=>{await mocked(async calls=>{for(const data of [{consent:null},{email:'bad'},{phone:'x'},{request_id:'no'},{branch:'inventada'}])assert.equal((await worker.fetch(request(data),env)).status,400);assert.equal(calls.length,0);},[]);});
test('validates PDF signature, extension and size independently',async()=>{await mocked(async calls=>{for(const file of [new File(['html'],'cv.pdf',{type:'application/pdf'}),new File([pdf],'cv.html',{type:'application/pdf'}),new File([new Uint8Array(5242881)],'cv.pdf',{type:'application/pdf'})])assert.ok([413,415].includes((await worker.fetch(request({cv:file}),env)).status));assert.equal(calls.length,0);},[]);});
test('enforces streaming body limit even when Content-Length is missing',async()=>{const r=new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'multipart/form-data; boundary=foo'},body:new Uint8Array(5*1024*1024+128*1024+1)});assert.equal((await worker.fetch(r,env)).status,413);});
test('rejects missing, invalid and mismatched human verification',async()=>{for(const result of [{success:false},{success:true,action:'login',hostname:'tiendasimportados.com'},{success:true,action:'recruitment',hostname:'evil.example'}])await mocked(async calls=>{assert.equal((await worker.fetch(request(),env)).status,400);assert.equal(calls.length,1);},[json(result)]);});
test('saves privately and only confirms after the database acknowledges receipt',async()=>{await mocked(async calls=>{const r=await worker.fetch(request(),env);assert.equal(r.status,201);const result=await r.json();assert.equal(result.ok,true);assert.match(result.receipt,/^IMP-[A-F0-9]{12}$/);assert.equal(calls.length,4);const row=JSON.parse(calls[1].body);assert.equal(row.status,undefined);assert.equal(row.object_path,id+'.pdf');assert.ok(!row.object_path.includes('Persona'));assert.equal(calls[2].headers['x-upsert'],'false');assert.equal(calls[2].headers['Content-Type'],'application/pdf');assert.equal(JSON.parse(calls[3].body).status,'received');assert.ok(!JSON.stringify(result).includes('server-only-test-key'));},[verified(),new Response(null,{status:201}),new Response(null,{status:200}),json([{status:'received'}])]);});
test('storage failure cannot return a successful receipt',async()=>{await mocked(async()=>{const r=await worker.fetch(request(),env);assert.equal(r.status,503);assert.equal((await r.json()).ok,false);},[verified(),new Response(null,{status:201}),json({},503),json({},404)]);});
test('database confirmation failure cannot return a successful receipt',async()=>{await mocked(async()=>{assert.equal((await worker.fetch(request(),env)).status,503);},[verified(),new Response(null,{status:201}),json({}),json({},503)]);});
test('failed initial insert prevents file upload',async()=>{await mocked(async calls=>{assert.equal((await worker.fetch(request(),env)).status,503);assert.equal(calls.length,2);},[verified(),json({},503)]);});
test('retry confirms an existing receipt only for the identical payload',async()=>{let payload;await mocked(async()=>{await worker.fetch(request(),env);},[verified(),(u,o)=>{payload=JSON.parse(o.body);return new Response(null,{status:201});},json({}),json([{status:'received'}])]);await mocked(async calls=>{const r=await worker.fetch(request(),env);assert.equal(r.status,200);assert.equal((await r.json()).receipt,payload.receipt);assert.equal(calls.length,3);},[verified(),json({},409),json([{receipt:payload.receipt,payload_hash:payload.payload_hash,status:'received'}])]);await mocked(async()=>{assert.equal((await worker.fetch(request({name:'Otra persona'}),env)).status,409);},[verified(),json({},409),json([{receipt:payload.receipt,payload_hash:payload.payload_hash,status:'received'}])]);});
test('pending retry recovers an existing exact file without overwriting',async()=>{let payload;await mocked(async()=>{await worker.fetch(request(),env);},[verified(),(u,o)=>{payload=JSON.parse(o.body);return new Response(null,{status:201});},json({}),json({},503)]);await mocked(async()=>{assert.equal((await worker.fetch(request(),env)).status,201);},[verified(),json({},409),json([{payload_hash:payload.payload_hash,status:'uploading'}]),json({},400),new Response(pdf),json([{status:'received'}])]);});
test('throttles abusive requests and never exposes a private listing',async()=>{assert.equal((await worker.fetch(request(),{...env,INGRESS_LIMITER:{limit:async()=>({success:false})}})).status,429);assert.equal((await worker.fetch(new Request(url,{headers:{Origin:origin}}),env)).status,405);assert.equal((await worker.fetch(new Request('https://api.example/api/recruitment/files',{headers:{Origin:origin}}),env)).status,404);});
test('CORS preflight is restricted and success headers disable cache',async()=>{const r=await worker.fetch(new Request(url,{method:'OPTIONS',headers:{Origin:origin}}),env);assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);const c=await worker.fetch(new Request('https://api.example/api/recruitment/config',{headers:{Origin:origin}}),env);assert.equal(c.headers.get('Cache-Control'),'no-store');assert.equal((await c.json()).siteKey,'public');});
test('a published vacancy is associated with the confirmed private application',async()=>{
 const vacancyId='6e601cb4-bd8c-4452-ad52-3ec57c28cf4a';
 await mocked(async calls=>{
  const result=await worker.fetch(request({vacancy_id:vacancyId}),env);
  assert.equal(result.status,201);
  assert.equal((await result.json()).ok,true);
  const lookup=new URL(calls.find(call=>new URL(call.u).pathname==='/rest/v1/vacancies').u);
  assert.equal(lookup.pathname,'/rest/v1/vacancies');
  assert.equal(lookup.searchParams.get('id'),'eq.'+vacancyId);
  assert.equal(lookup.searchParams.get('status'),'eq.published');
  const saved=JSON.parse(calls.find(call=>call.method==='POST'&&new URL(call.u).pathname==='/rest/v1/job_applications').body);
  assert.equal(saved.vacancy_id,vacancyId);
  assert.equal(calls.filter(call=>new URL(call.u).pathname.includes('/storage/v1/object/hojas-de-vida/')).length,1);
 },[verified(),json([]),json([{id:vacancyId}]),new Response(null,{status:201}),json({}),json([{status:'received'}])]);
});
test('a closed or unavailable vacancy never creates an application or uploads its PDF',async()=>{
 const vacancyId='6e601cb4-bd8c-4452-ad52-3ec57c28cf4a';
 await mocked(async calls=>{
  const result=await worker.fetch(request({vacancy_id:vacancyId}),env);
  assert.equal(result.status,400);
  assert.match((await result.json()).message,/postulación general/);
  assert.equal(calls.length,3);
  assert.equal(calls.some(call=>new URL(call.u).pathname.includes('/storage/')),false);
  assert.equal(calls.some(call=>call.method==='POST'&&new URL(call.u).hostname.endsWith('.supabase.co')),false);
 },[verified(),json([]),json([])]);
});
test('a malformed vacancy identifier is refused before contacting providers',async()=>{
 await mocked(async calls=>{
  for(const vacancyId of ['not-a-uuid','6e601cb4-bd8c-4452-ad52-3ec57c28cf4a&status=eq.draft','6e601cb4-bd8c-1452-ad52-3ec57c28cf4a']){
   const result=await worker.fetch(request({vacancy_id:vacancyId}),env);
   assert.equal(result.status,400);
  }
  assert.equal(calls.length,0);
 },[]);
});
test('an identical received vacancy application can be reconfirmed after its vacancy closes',async()=>{
 const vacancyId='6e601cb4-bd8c-4452-ad52-3ec57c28cf4a';let payload;
 await mocked(async()=>{assert.equal((await worker.fetch(request({vacancy_id:vacancyId}),env)).status,201);},[
  verified(),json([]),json([{id:vacancyId}]),(_u,o)=>{payload=JSON.parse(o.body);return new Response(null,{status:201});},json({}),json([{status:'received'}])
 ]);
 await mocked(async calls=>{
  const result=await worker.fetch(request({vacancy_id:vacancyId}),env);
  assert.equal(result.status,200);assert.equal((await result.json()).receipt,payload.receipt);
  assert.equal(calls.length,2);assert.equal(calls.some(call=>new URL(call.u).pathname==='/rest/v1/vacancies'),false);
 },[verified(),json([{receipt:payload.receipt,payload_hash:payload.payload_hash,status:'received'}])]);
});
test('an identical pending vacancy attempt can finish after closure without overwriting its stored PDF',async()=>{
 const vacancyId='6e601cb4-bd8c-4452-ad52-3ec57c28cf4a';let payload;
 await mocked(async()=>{assert.equal((await worker.fetch(request({vacancy_id:vacancyId}),env)).status,503);},[
  verified(),json([]),json([{id:vacancyId}]),(_u,o)=>{payload=JSON.parse(o.body);return new Response(null,{status:201});},json({}),json({},503)
 ]);
 await mocked(async calls=>{
  const result=await worker.fetch(request({vacancy_id:vacancyId}),env);
  assert.equal(result.status,201);assert.equal((await result.json()).receipt,payload.receipt);
  assert.equal(calls.some(call=>new URL(call.u).pathname==='/rest/v1/vacancies'),false);
  assert.equal(calls.some(call=>call.method==='POST'&&new URL(call.u).pathname==='/rest/v1/job_applications'),false);
  const upload=calls.find(call=>call.method==='POST'&&new URL(call.u).pathname.includes('/storage/'));
  assert.equal(upload.headers['x-upsert'],'false');
 },[verified(),json([{receipt:payload.receipt,payload_hash:payload.payload_hash,status:'uploading'}]),json({},400),new Response(pdf),json([{status:'received'}])]);
});
test('a vacancy retry with changed data is rejected before vacancy lookup or file modification',async()=>{
 const vacancyId='6e601cb4-bd8c-4452-ad52-3ec57c28cf4a';
 await mocked(async calls=>{
  const result=await worker.fetch(request({vacancy_id:vacancyId}),env);
  assert.equal(result.status,409);assert.equal((await result.json()).ok,false);
  assert.equal(calls.length,2);assert.equal(calls.some(call=>new URL(call.u).pathname==='/rest/v1/vacancies'),false);
 },[verified(),json([{receipt:'IMP-ORIGINAL',payload_hash:'different-original-payload',status:'received'}])]);
});
function businessDates(){const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../../landing/dist/business-dates.js',import.meta.url),'utf8'),context);return context.ImportadosDates;}
test('an unconfirmed opening never becomes open automatically on October 15 or inauguration dates',()=>{
 const dates=businessDates();
 for(const instant of ['2026-10-14T23:59:59-05:00','2026-10-15T00:00:00-05:00','2026-11-14T00:00:00-05:00','2026-11-16T00:00:00-05:00','2027-01-01T00:00:00-05:00']){
  const phase=dates.phase(Date.parse(instant));
  assert.equal(phase.open,false);
  assert.equal(phase.status,'NIQUÍA · APERTURA MUY PRONTO');
  assert.equal(phase.copy,'Apertura muy pronto.');
  assert.equal(phase.bello,'En Bello, Niquía abrirá muy pronto. Mientras tanto, te esperamos en Santa Lucía.');
 }
});
test('the grand inauguration remains November 14 and 15 in Colombia independently of opening',()=>{
 const dates=businessDates();
 assert.equal(dates.phase(Date.parse('2026-11-13T23:59:59-05:00')).celebrating,false);
 assert.equal(dates.phase(Date.parse('2026-11-14T00:00:00-05:00')).celebrating,true);
 const finalNight=dates.phase(Date.parse('2026-11-15T23:59:59-05:00'));
 assert.equal(finalNight.celebrating,true);assert.equal(finalNight.celebrated,false);
 const after=dates.phase(Date.parse('2026-11-16T00:00:00-05:00'));
 assert.equal(after.celebrating,false);assert.equal(after.celebrated,true);assert.equal(after.open,false);
});
