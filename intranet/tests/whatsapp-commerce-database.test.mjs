import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

let db,counter=0;
const ids={admin:randomUUID(),santa:randomUUID(),niquia:randomUUID(),inactive:randomUUID(),stranger:randomUUID()};
const phoneId='123456789101112',wabaId='234567891011121';
async function asRole(role,sql,params=[],id=''){
 await db.exec('begin');try{await db.exec('set local role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);const result=await db.query(sql,params);await db.exec('commit');return result;}catch(error){await db.exec('rollback');throw error;}
}
const service=(sql,params=[])=>asRole('service_role',sql,params);
const user=(id,sql,params=[])=>asRole('authenticated',sql,params,id);
const rpc=async(name,args=[])=>{const result=await service('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args);return result.rows[0].value;};
function event(phone,text='Consulta sintética',extra={}){const n=++counter;return {event_key:createHash('sha256').update('synthetic-'+n).digest('hex'),event_type:'message',phone_number_id:phoneId,waba_id:wabaId,identity_key:phone,customer_phone:phone,customer_bsuid:null,meta_message_id:'wamid.synthetic.'+n,kind:'text',body:text,occurred_at:new Date().toISOString(),...extra};}
async function incoming(phone,text,extra={}){return rpc('whatsapp_receive_event',[JSON.stringify(event(phone,text,extra))]);}
async function conversation(id){return (await db.query('select * from public.whatsapp_conversations where id=$1',[id])).rows[0];}
async function action(id,name,payload={},request=randomUUID(),expected){const c=await conversation(id);return rpc('whatsapp_staff_action',[ids.admin,id,name,request,expected??c.control_version,JSON.stringify(payload)]);}
async function authorize(initial,phone,acceptance='YO ACEPTO'){
 await db.exec("update public.whatsapp_outbox set status='cancelled' where status='queued'");
 const c=await conversation(initial.conversation_id);const meta='wamid.synthetic.auth.'+randomUUID();
 const queued=await rpc('whatsapp_commit_reply',[c.id,initial.message_id,c.control_version,c.context_version,randomUUID(),'Aviso sintético https://tiendasimportados.com/privacidad-prueba-sintetica','privacy_notice',null]);
 const claim=await rpc('whatsapp_claim_outbox');assert.equal(claim.id,queued.outbox_id);
 await rpc('whatsapp_finish_outbox',[claim.id,claim.lease_token,'sent',meta,null]);
 await rpc('whatsapp_receive_event',[JSON.stringify(event(null,'',{event_type:'status',meta_message_id:meta,status:'delivered'}))]);
 return incoming(phone,acceptance);
}

before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create schema storage;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant all on storage.objects,storage.buckets to anon,authenticated,service_role;
 create publication supabase_realtime;`);
 await db.exec(await readFile(new URL('../../recruitment/supabase/202610120001_recruitment.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/202610120002_intranet.sql',import.meta.url),'utf8'));
 const migration=await readFile(new URL('../supabase/202610200001_whatsapp.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
 const receiptCorrection=await readFile(new URL('../supabase/202610210001_whatsapp_privacy_receipts.sql',import.meta.url),'utf8');await db.exec(receiptCorrection);await db.exec(receiptCorrection);
 const operator=await readFile(new URL('../supabase/202610210002_whatsapp_operator_media_alerts.sql',import.meta.url),'utf8');await db.exec(operator);await db.exec(operator);
 const attention=await readFile(new URL('../supabase/202610270001_whatsapp_attention_attachments.sql',import.meta.url),'utf8');await db.exec(attention);await db.exec(attention);
 for(const name of ['202610290001_whatsapp_commerce.sql','202610290002_whatsapp_reviews_hours.sql','202610290003_whatsapp_intake_guards.sql','202610290004_whatsapp_media.sql','202610290005_whatsapp_options.sql','202610290006_whatsapp_consent_resume.sql','202610290007_whatsapp_order_reference.sql','202610290008_whatsapp_payment_continuity.sql']){const sql=await readFile(new URL('../supabase/'+name,import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);}
 for(const id of Object.values(ids))await db.query('insert into auth.users(id) values($1)',[id]);
 await db.query(`insert into public.profiles(id,full_name,role,branch_id,active) values
 ($1,'Admin sintético','admin',null,true),($2,'Caja Santa sintética','cashier','santa-lucia',true),
 ($3,'Caja Niquía sintética','cashier','niquia',true),($4,'Inactivo sintético','cashier','santa-lucia',false)`,Object.values(ids).slice(0,4));
 await db.exec("create or replace function importados_private.whatsapp_day_close() returns timestamptz language sql stable as $$select now()+interval '8 hours'$$");
 await db.query(`update public.whatsapp_config set ingress_enabled=true,ai_enabled=true,outbound_enabled=true,phone_number_id=$1,waba_id=$2,privacy_url='https://tiendasimportados.com/privacidad-prueba-sintetica',privacy_version='synthetic-v1',public_since=now()-interval '1 day'`,[phoneId,wabaId]);

});
after(async()=>db?.close());


async function setup(){
 await db.exec("update public.whatsapp_outbox set status='cancelled' where status='queued'");
 const phone='57300'+String(++counter).padStart(7,'0'),first=await incoming(phone,'Busco un producto');await authorize(first,phone);await action(first.conversation_id,'assign_branch',{branch_id:'santa-lucia'});
 const product=randomUUID();await db.query("insert into public.products(id,name,price,category,description,active,storage_path) values($1,'Producto sintético',10000,'Pruebas','Solo en PGlite',true,$2)",[product,product+'.jpg']);
 await db.query("insert into public.branch_inventory(branch_id,product_id,quantity,valid_until) values('santa-lucia',$1,2,now()+interval '8 hours')",[product]);
 return {phone,cid:first.conversation_id,product};
}
const defaults={intent:'checkout',quote:null,confirmed_item:null,checkout:{},accept_summary:false,cancel_cart:false};
const full={customer_name:'Cliente Sintético',recipient_phone:'3000000000',fulfillment_type:'pickup'};
async function turn(f,decision,text='Quiero comprar el producto',request=randomUUID()){
 const msg=await incoming(f.phone,text);const c=await conversation(f.cid),rv=(await db.query('select resource_version from whatsapp_config')).rows[0].resource_version;
 const payload={...defaults,...decision};const args=[f.cid,msg.message_id,c.control_version,c.context_version,Number(rv),request,JSON.stringify(payload)];
 return {result:await rpc('whatsapp_commerce_turn',args),args,msg};
}
const quote=f=>({items:[{product_id:f.product,quantity:1,unit_price_cop:10000}]});
async function delivered(oid){await db.query("update whatsapp_outbox set status='delivered' where id=$1",[oid]);}
async function review(f,task,result,request=randomUUID(),actor=ids.admin){const c=await conversation(f.cid);return rpc('whatsapp_review_checkout',[actor,f.cid,task,c.control_version,request,JSON.stringify(result)]);}
const state=async f=>(await db.query('select state from whatsapp_checkouts where conversation_id=$1',[f.cid])).rows[0].state;
const taskFor=async(f,type)=>(await db.query("select * from whatsapp_tasks where conversation_id=$1 and review_type=$2 and status='pending' order by created_at desc",[f.cid,type])).rows[0];
async function receivedReceipt(f){const m=await incoming(f.phone,'Comprobante',{kind:'image',attachment:{id:'123456789123456',kind:'image',persisted:false}});await db.query("update whatsapp_messages set attachment=jsonb_set(attachment,'{persisted}','true') where id=$1",[m.message_id]);return m;}
async function applyMessage(f,m,decision={}){const c=await conversation(f.cid),rv=Number((await db.query('select resource_version from whatsapp_config')).rows[0].resource_version);return rpc('whatsapp_commerce_turn',[f.cid,m.message_id,c.control_version,c.context_version,rv,randomUUID(),JSON.stringify({...defaults,...decision})]);}

test('comma/accent/punctuation acceptance works only after a delivered notice',async()=>{
 const phone='573000009999',f=await incoming(phone,'Sí, acepto');assert.equal((await conversation(f.conversation_id)).consent_status,'unknown');
 await authorize(f,phone,'Sí, acepto.');assert.equal((await conversation(f.conversation_id)).consent_status,'granted');
 await incoming(phone,'No, acepto?');assert.equal((await conversation(f.conversation_id)).consent_status,'revoked');
});
test('private grouped snapshot is scoped and browser cannot call commerce or reviews',async()=>{
 const f=await setup();const data=await rpc('whatsapp_turn_snapshot',[f.cid]);assert.equal(data.conversation.id,f.cid);assert.equal(data.products.length,1);
 await assert.rejects(user(ids.admin,'select whatsapp_turn_snapshot($1)',[f.cid]),/permission denied/);
 await assert.rejects(user(ids.admin,'select * from whatsapp_checkouts'),/permission denied/);
 await assert.rejects(user(ids.admin,'select whatsapp_review_checkout($1,$2,$3,$4,$5,$6)',[ids.admin,f.cid,randomUUID(),0,randomUUID(),'{}']),/permission denied/);
});
test('one batched message stores all fields and creates an exact summary without reserving yet',async()=>{
 const f=await setup(),t=await turn(f,{quote:quote(f),checkout:full});const s=await state(f);assert.equal(s.customer_name,full.customer_name);assert.equal(s.stage,'summary');assert.equal(s.subtotal_cop,10000);
 const body=(await db.query('select body from whatsapp_outbox where id=$1',[t.result.outbox_id])).rows[0].body;assert.match(body,/Producto sintético/);assert.match(body,/10.000/);assert.match(body,/Confirmas/);assert.equal((await db.query('select * from whatsapp_stock_holds')).rows.length,0);
 assert.deepEqual(await rpc('whatsapp_commerce_turn',t.args),t.result);
});
test('a queued summary, foreign product, changed resource or takeover cannot authorize a purchase',async()=>{
 const f=await setup();await turn(f,{quote:quote(f),checkout:full});await assert.rejects(turn(f,{accept_summary:true},'Sí'),/Resumen sin entregar/);
 await assert.rejects(turn(f,{quote:{items:[{product_id:randomUUID(),quantity:1,unit_price_cop:1}]}},'Quiero ese'),/Stock o precio/);
 const c=await conversation(f.cid);await action(f.cid,'pause');const msg=await incoming(f.phone,'Comprar');const rv=(await db.query('select resource_version from whatsapp_config')).rows[0].resource_version;
 await assert.rejects(rpc('whatsapp_commerce_turn',[f.cid,msg.message_id,c.control_version,c.context_version,Number(rv),randomUUID(),JSON.stringify(defaults)]),/fuera del contexto/);
});
test('partial delivery data only asks the missing fields and waits for a human fee',async()=>{
 const f=await setup();await turn(f,{quote:quote(f),checkout:{...full,fulfillment_type:'delivery',delivery_address:'Carrera 1 # 2-3, apto 405'}});
 let r=await turn(f,{checkout:{recipient_name:'Persona Recibe',delivery_zone:'Barrio Prueba, Bello'}});let t=await taskFor(f,'delivery');assert.ok(t);assert.equal(t.review_payload.address,'Carrera 1 # 2-3, apto 405');
 await assert.rejects(review(f,t.id,{approved:true,delivery_fee_cop:-10}),/tarifa/);await assert.rejects(review(f,t.id,{approved:true,delivery_fee_cop:5000},randomUUID(),ids.niquia),/no disponible/);
 await review(f,t.id,{approved:true,delivery_fee_cop:5000,eta_minutes:45});r=await turn(f,{});const s=await state(f);assert.equal(s.delivery_fee_cop,5000);assert.equal(s.stage,'summary');
 const body=(await db.query('select body from whatsapp_outbox where id=$1',[r.result.outbox_id])).rows[0].body;assert.match(body,/15.000/);assert.match(body,/apto 405/);
});
test('accepted delivered summary reserves stock and explicit cash pickup approval creates exactly one order',async()=>{
 const f=await setup(),q=await turn(f,{quote:quote(f),checkout:full});await delivered(q.result.outbox_id);
 await turn(f,{accept_summary:true,checkout:{payment_method:'cash_prepaid'}},'Sí, pago en efectivo');const t=await taskFor(f,'payment');assert.ok(t);assert.equal((await state(f)).stage,'payment_review');
 await assert.rejects(review(f,t.id,{approved:true},randomUUID(),ids.santa),/Solo administración/);
 const req=randomUUID();const result=await review(f,t.id,{approved:true},req);assert.deepEqual(await review(f,t.id,{approved:true},req),result);
 const orders=(await db.query('select * from orders where whatsapp_conversation_id=$1',[f.cid])).rows;assert.equal(orders.length,1);assert.equal(orders[0].total,10000);assert.equal(orders[0].payment_method,'cash_prepaid');assert.equal((await state(f)).stage,'ordered');
 await incoming(f.phone,'¿Cómo va mi pedido '+orders[0].order_number.replace('-','')+'?');assert.equal((await rpc('whatsapp_turn_snapshot',[f.cid])).order.id,orders[0].id);
 await incoming(f.phone,'¿Cómo va IMP9999999?');assert.equal((await rpc('whatsapp_turn_snapshot',[f.cid])).order,null);
 assert.equal((await db.query('select quantity from branch_inventory where product_id=$1',[f.product])).rows[0].quantity,1);
});
test('transfer cannot be approved without a received receipt, and generic text resolution cannot bypass review',async()=>{
 const f=await setup(),q=await turn(f,{quote:quote(f),checkout:full});await delivered(q.result.outbox_id);
 await turn(f,{accept_summary:true,checkout:{payment_method:'addi'}},'Sí, Addi');let t=await taskFor(f,'payment');assert.ok(t);
 await assert.rejects(action(f.cid,'resolve_task',{task_id:t.id,answer:'Pago aprobado'}),/Pendiente no disponible/);
 await db.query("update whatsapp_checkouts set state=jsonb_set(state,'{payment_method}',to_jsonb('transfer'::text)) where conversation_id=$1",[f.cid]);
 await assert.rejects(review(f,t.id,{approved:true}),/Revalida|Falta comprobante/);
});
test('two buyers cannot reserve the same last unit; expired counts are never offered as verified',async()=>{
 const f=await setup();await db.query('update branch_inventory set quantity=1 where product_id=$1',[f.product]);
 const q=await turn(f,{quote:quote(f),checkout:full});await delivered(q.result.outbox_id);await turn(f,{accept_summary:true},'Sí');
 const g=await setup();g.product=f.product;await assert.rejects(turn(g,{quote:quote(g),checkout:full}),/Stock o precio/);
 await db.query("update branch_inventory set valid_until=now()-interval '1 minute' where product_id=$1",[f.product]);const snap=await rpc('whatsapp_turn_snapshot',[f.cid]);assert.ok(snap.inventory.some(i=>Date.parse(i.valid_until)<Date.now()));
});
test('a human price remains a selection and requires stock review without inventing a catalog ID',async()=>{
 const f=await setup(),m=await incoming(f.phone,'Quiero un árbol');const tid=randomUUID();await db.query("insert into whatsapp_tasks(id,conversation_id,branch_id,kind,question,source_message_id,dedupe_key,status,answer) values($1,$2,'santa-lucia','missing_information','¿Tienen árbol y a qué precio?',$3,'synthetic-price','resolved','El árbol cuesta $100.000.')",[tid,f.cid,m.message_id]);
 const item={source_task_id:tid,source_excerpt:'El árbol cuesta $100.000.',name:'árbol',variant:'',unit_price_cop:100000,quantity:1};await turn(f,{confirmed_item:item,checkout:full});let t=await taskFor(f,'stock');assert.ok(t);assert.equal((await state(f)).pending_selection.name,'árbol');
 await turn(f,{checkout:{recipient_phone:'3000000011'}});assert.equal((await taskFor(f,'stock')).id,t.id);
 await review(f,t.id,{approved:true});await turn(f,{});assert.equal((await state(f)).stage,'summary');
});
test('product photo queue is private, idempotent and rejects stale revisions',async()=>{
 const f=await setup(),m=await incoming(f.phone,'Muéstrame la foto');const c=await conversation(f.cid),rv=Number((await db.query('select resource_version from whatsapp_config')).rows[0].resource_version);
 const args=[f.cid,m.message_id,c.control_version,c.context_version,rv,f.product];assert.ok(await rpc('whatsapp_queue_product_image',args));assert.equal(await rpc('whatsapp_queue_product_image',args),null);
 await db.query('update products set price=price+1 where id=$1',[f.product]);await assert.rejects(rpc('whatsapp_queue_product_image',args),/fuera del contexto/);
});
test('a receipt arriving after the explicit acceptance resumes only the matching delivered notice once',async()=>{
 await db.exec("update whatsapp_outbox set status='cancelled' where status='queued'");
 const phone='573000009998',first=await incoming(phone,'Quiero comprar');const c=await conversation(first.conversation_id);
 const q=await rpc('whatsapp_commit_reply',[c.id,first.message_id,c.control_version,c.context_version,randomUUID(),'Aviso https://tiendasimportados.com/privacidad-prueba-sintetica','privacy_notice',null]);
 const claim=await rpc('whatsapp_claim_outbox');assert.equal(claim.id,q.outbox_id);await rpc('whatsapp_finish_outbox',[claim.id,claim.lease_token,'sent','wamid.synthetic.late-receipt',null]);
 const accepted=await incoming(phone,'Sí, acepto.');assert.equal((await conversation(c.id)).consent_status,'unknown');
 await rpc('whatsapp_receive_event',[JSON.stringify(event(null,'',{event_type:'status',meta_message_id:'wamid.synthetic.late-receipt',status:'delivered'}))]);
 assert.equal((await conversation(c.id)).consent_status,'granted');
 const rows=(await db.query("select event from whatsapp_inbox where conversation_id=$1 and kind='service_reopen'",[c.id])).rows;assert.equal(rows.length,1);assert.equal(rows[0].event.message_id,accepted.message_id);
});
test('closing notices coalesce safely before send and reopening is durable without releasing manual control',async()=>{
 const f=await setup();await db.exec("create or replace function importados_private.whatsapp_attention_open() returns boolean language sql stable as $$select false$$");
 let m=await incoming(f.phone,'Quiero consultar mañana'),c=await conversation(f.cid);
 const first=await rpc('whatsapp_defer_service',[c.id,m.message_id,c.control_version,c.context_version]);assert.ok(first.outbox_id);
 m=await incoming(f.phone,'Y el precio, por favor');c=await conversation(f.cid);const second=await rpc('whatsapp_defer_service',[c.id,m.message_id,c.control_version,c.context_version]);assert.equal(second.outbox_id,first.outbox_id);
 await db.exec("create or replace function importados_private.whatsapp_attention_open() returns boolean language sql stable as $$select true$$");await db.query("update whatsapp_service_waits set due_at=now()-interval '1 minute' where conversation_id=$1",[f.cid]);
 assert.equal(await rpc('whatsapp_prepare_reopening'),true);assert.equal(await rpc('whatsapp_prepare_reopening'),false);
 const rows=(await db.query("select event from whatsapp_inbox where conversation_id=$1 and kind='service_reopen' and event->>'reason' is null",[f.cid])).rows;assert.equal(rows.length,1);assert.equal(rows[0].event.message_id,m.message_id);
 const g=await setup();await db.exec("create or replace function importados_private.whatsapp_attention_open() returns boolean language sql stable as $$select false$$");m=await incoming(g.phone,'Consulta');c=await conversation(g.cid);await rpc('whatsapp_defer_service',[c.id,m.message_id,c.control_version,c.context_version]);await action(g.cid,'pause');await db.exec("create or replace function importados_private.whatsapp_attention_open() returns boolean language sql stable as $$select true$$");await db.query("update whatsapp_service_waits set due_at=now()-interval '1 minute' where conversation_id=$1",[g.cid]);await rpc('whatsapp_prepare_reopening');assert.equal((await db.query('select status from whatsapp_service_waits where conversation_id=$1',[g.cid])).rows[0].status,'cancelled');assert.equal((await conversation(g.cid)).manual_paused,true);
});

test('a previous general case resumes only after a current explicit follow-up and branch confirmation',async()=>{
 const f=await setup(),m=await incoming(f.phone,'Disponibilidad del árbol');const tid=randomUUID();await db.query("insert into whatsapp_tasks(id,conversation_id,branch_id,kind,question,source_message_id,dedupe_key,created_at) values($1,$2,'santa-lucia','missing_information','Confirmar disponibilidad del árbol',$3,'synthetic-previous-case',now()-interval '2 days')",[tid,f.cid,m.message_id]);
 let nowMessage=await incoming(f.phone,'Quiero comprar otro producto'),c=await conversation(f.cid);let snap=await rpc('whatsapp_turn_snapshot',[f.cid]);assert.equal(snap.tasks.some(t=>t.id===tid),false);
 await assert.rejects(rpc('whatsapp_commit_reply',[f.cid,nowMessage.message_id,c.control_version,c.context_version,randomUUID(),'No debe guardarse.','reply',JSON.stringify({kind:'missing_information',task_id:tid,question:'Otra consulta'})]),/fuera del contexto/);
 nowMessage=await incoming(f.phone,'Sigo esperando la respuesta de mi consulta'),c=await conversation(f.cid);snap=await rpc('whatsapp_turn_snapshot',[f.cid]);assert.equal(snap.tasks.filter(t=>t.id===tid).length,1);
 await rpc('whatsapp_commit_reply',[f.cid,nowMessage.message_id,c.control_version,c.context_version,randomUUID(),'Lamento la espera.','reply',JSON.stringify({kind:'missing_information',task_id:tid,priority:'high',question:'Sigue esperando la disponibilidad del árbol.'})]);
 assert.equal((await db.query('select count(*)::int n from whatsapp_tasks where conversation_id=$1',[f.cid])).rows[0].n,1);
});
test('a received transfer proof stays on one review after expiry and never asks for another payment',async()=>{
 const f=await setup(),q=await turn(f,{quote:quote(f),checkout:full});await delivered(q.result.outbox_id);await turn(f,{accept_summary:true,checkout:{payment_method:'transfer'}},'Sí, transferencia');
 let m=await receivedReceipt(f);await applyMessage(f,m);const original=await taskFor(f,'payment');assert.ok(original);assert.equal(original.review_payload.receipt_id,m.message_id);
 await db.query("update whatsapp_checkouts set state=jsonb_set(state,'{reservation_until}',to_jsonb((now()-interval '1 minute')::text)) where conversation_id=$1",[f.cid]);await db.query("update whatsapp_stock_holds set expires_at=now()-interval '1 minute' where checkout_id=(select id from whatsapp_checkouts where conversation_id=$1)",[f.cid]);
 m=await incoming(f.phone,'¿Ya lo revisaron?');const r=await applyMessage(f,m);const t=await taskFor(f,'payment');assert.equal(t.id,original.id);assert.equal(t.review_payload.needs_revalidation,true);
 const body=(await db.query('select body from whatsapp_outbox where id=$1',[r.outbox_id])).rows[0].body;assert.match(body,/No necesitas pagar de nuevo/);assert.equal((await db.query('select count(*)::int n from orders where whatsapp_conversation_id=$1',[f.cid])).rows[0].n,0);
 await assert.rejects(review(f,t.id,{approved:true}),/Revalida/);await review(f,t.id,{approved:true,revalidate_expired:true});assert.equal((await state(f)).stage,'ordered');
});
test('revalidating a paid but expired quote cannot silently accept a changed price',async()=>{
 const f=await setup(),q=await turn(f,{quote:quote(f),checkout:full});await delivered(q.result.outbox_id);await turn(f,{accept_summary:true,checkout:{payment_method:'transfer'}},'Sí, transferencia');const m=await receivedReceipt(f);
 await db.query("update whatsapp_checkouts set state=jsonb_set(state,'{reservation_until}',to_jsonb((now()-interval '1 minute')::text)) where conversation_id=$1",[f.cid]);await applyMessage(f,m);const t=await taskFor(f,'payment');await db.query('update products set price=12000 where id=$1',[f.product]);
 await assert.rejects(review(f,t.id,{approved:true,revalidate_expired:true}),/Existencias o precio cambiaron/);assert.equal((await db.query('select count(*)::int n from orders where whatsapp_conversation_id=$1',[f.cid])).rows[0].n,0);
});
test('delivery cutoff blocks a new shipment but allows proof review for an already accepted shipment',async()=>{
 const f=await setup();await turn(f,{quote:quote(f),checkout:{...full,fulfillment_type:'delivery',recipient_name:'Persona Recibe',delivery_address:'Carrera 1 # 2-3',delivery_zone:'Centro, Bello'}});const fee=await taskFor(f,'delivery');await review(f,fee.id,{approved:true,delivery_fee_cop:5000,eta_minutes:45});const q=await turn(f,{});await delivered(q.result.outbox_id);await turn(f,{accept_summary:true,checkout:{payment_method:'transfer'}},'Sí, transferencia');
 await db.exec("update whatsapp_config set service_hours_enabled=true;create or replace function importados_private.whatsapp_delivery_open() returns boolean language sql stable as $$select false$$;");const m=await receivedReceipt(f);const r=await applyMessage(f,m);assert.ok(await taskFor(f,'payment'));const body=(await db.query('select body from whatsapp_outbox where id=$1',[r.outbox_id])).rows[0].body;assert.doesNotMatch(body,/recibimos domicilios hasta/);
 const g=await setup();const n=await turn(g,{quote:quote(g),checkout:{...full,fulfillment_type:'delivery',recipient_name:'Persona Recibe',delivery_address:'Carrera 1 # 2-3',delivery_zone:'Centro'}});const blocked=(await db.query('select body from whatsapp_outbox where id=$1',[n.result.outbox_id])).rows[0].body;assert.match(blocked,/hasta las 7:00/);await db.exec('update whatsapp_config set service_hours_enabled=false');
});
