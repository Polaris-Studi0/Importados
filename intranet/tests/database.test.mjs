import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const ids={admin:'11111111-1111-4111-8111-111111111111',cashier:'22222222-2222-4222-8222-222222222222',other:'33333333-3333-4333-8333-333333333333',inactive:'44444444-4444-4444-8444-444444444444',stranger:'55555555-5555-4555-8555-555555555555'};
const resumeId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db,delivery,pickup,niquia,staffSanta,staffNiquia,product,caseId;
async function user(id,sql,params=[],role='authenticated'){
 await db.exec('begin');
 try{
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);
  const result=await db.query(sql,params);await db.exec('commit');return result;
 }catch(error){await db.exec('rollback');throw error;}
}
const admin=(sql,params=[])=>user(ids.admin,sql,params);
const cashier=(sql,params=[])=>user(ids.cashier,sql,params);
const other=(sql,params=[])=>user(ids.other,sql,params);
const anon=(sql,params=[])=>user('',sql,params,'anon');
const orderSql=`insert into public.orders(branch_id,fulfillment_type,customer_name,customer_phone,delivery_address,delivery_zone,items,total,payment_method,delivery_fee)
 values($1,$2,'Persona de prueba','3000000000','Dirección sintética','Zona de prueba',$3::jsonb,99999999,'transfer',3000) returning *`;

before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant execute on function auth.uid() to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant all on storage.objects,storage.buckets to anon,authenticated,service_role;
 create publication supabase_realtime;
 insert into storage.buckets values('hojas-de-vida','hojas-de-vida',false,5242880,array['application/pdf']);`);
 await db.exec(await readFile(new URL('../../recruitment/supabase/202610120001_recruitment.sql',import.meta.url),'utf8'));
 await db.query(`insert into public.job_applications(id,receipt,name,email,phone,branch,object_path,file_size,payload_hash,status)
 values($1,'IMP-TEST','Prueba sintética','prueba@example.invalid','3000000000','santa-lucia','cv-prueba.pdf',128,'test','received')`,[resumeId]);
 const migration=await readFile(new URL('../supabase/202610120002_intranet.sql',import.meta.url),'utf8');
 await db.exec(migration);await db.exec(migration);
 for(const id of Object.values(ids))await db.query('insert into auth.users(id) values($1)',[id]);
 await db.query(`insert into public.profiles(id,full_name,role,branch_id,active) values
 ($1,'Admin de prueba','admin',null,true),($2,'Caja Santa de prueba','cashier','santa-lucia',true),
 ($3,'Caja Niquía de prueba','cashier','niquia',true),($4,'Inactivo de prueba','cashier','santa-lucia',false)`,Object.values(ids).slice(0,4));
 staffSanta=(await admin("insert into public.staff_members(full_name,branch_id) values('Responsable Santa','santa-lucia') returning id")).rows[0].id;
 staffNiquia=(await admin("insert into public.staff_members(full_name,branch_id) values('Responsable Niquía','niquia') returning id")).rows[0].id;
 const items=JSON.stringify([{qty:2,name:'Producto sintético',unit_price:1500}]);
 delivery=(await admin(orderSql,['santa-lucia','delivery',items])).rows[0];
 pickup=(await admin(orderSql,['santa-lucia','pickup',items])).rows[0];
 niquia=(await admin(orderSql,['niquia','delivery',items])).rows[0];
});
after(async()=>{await db?.close();});

test('migration is repeatable, seeds only real branches, and preserves received résumés',async()=>{
 assert.equal((await db.query('select count(*)::int as n from public.branches')).rows[0].n,2);
 const cv=(await db.query('select * from public.job_applications where id=$1',[resumeId])).rows[0];
 assert.equal(cv.status,'received');assert.equal(cv.review_status,'new');assert.equal(cv.object_path,'cv-prueba.pdf');
 assert.equal((await db.query('select count(*)::int as n from public.products')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int as n from public.vacancies')).rows[0].n,0);
 assert.ok((await db.query('select public from storage.buckets')).rows.every(b=>!b.public));
 const published=(await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows.map(r=>r.tablename);
 assert.ok(['orders','staff_members','couriers','internal_chat_messages','job_applications','pqrs_cases'].every(t=>published.includes(t)));
});
test('a signed up account has no operational access until a profile is provisioned',async()=>{
 assert.equal((await user(ids.stranger,'select * from public.orders')).rows.length,0);
 assert.equal((await user(ids.stranger,'select * from public.profiles')).rows.length,0);
 await assert.rejects(user(ids.stranger,"insert into public.profiles(id,full_name,role) values($1,'Escalado','admin')",[ids.stranger]),/permission denied/);
 await assert.rejects(user(ids.stranger,"select public.send_internal_chat('santa-lucia','Hola',$1)",['66666666-6666-4666-8666-666666666666']),/no disponible/);
});
test('even an administrator cannot grant themselves or other users privileges via client writes',async()=>{
 await assert.rejects(admin("update public.profiles set role='admin' where id=$1",[ids.cashier]),/permission denied/);
 await assert.rejects(cashier("update public.profiles set branch_id='niquia' where id=$1",[ids.cashier]),/permission denied/);
});
test('cashier sees only own branch and inactive profiles lose all branch access',async()=>{
 assert.deepEqual((await cashier('select distinct branch_id from public.orders')).rows.map(r=>r.branch_id),['santa-lucia']);
 assert.equal((await other('select * from public.orders where id=$1',[delivery.id])).rows.length,0);
 assert.equal((await user(ids.inactive,'select * from public.orders')).rows.length,0);
 await assert.rejects(user(ids.inactive,"select public.transition_order($1,'ready')",[delivery.id]),/sin acceso activo/);
});
test('server derives subtotal and clears delivery data for pickup',async()=>{
 assert.equal(delivery.total,3000);assert.equal(delivery.delivery_fee,3000);
 assert.equal(pickup.total,3000);assert.equal(pickup.delivery_fee,0);assert.equal(pickup.delivery_address,null);
 assert.equal(delivery.version,1);
});
test('malformed, fractional and negative products cannot be persisted',async()=>{
 for(const items of [[],[{qty:0,name:'x',unit_price:200}],[{qty:1.5,name:'x',unit_price:200}],[{qty:1,name:'x',unit_price:-1}],[{qty:1,name:'',unit_price:200}],[{name:'x',unit_price:200}]]){
  await assert.rejects(admin(orderSql,['santa-lucia','delivery',JSON.stringify(items)]));
 }
});
test('cashiers cannot create orders or rewrite amounts, status, receipt metadata and handoff actors',async()=>{
 await assert.rejects(cashier(orderSql,['santa-lucia','pickup',JSON.stringify([{qty:1,name:'x',unit_price:200}])]),/row-level security/);
 assert.equal((await cashier('update public.orders set total=1 where id=$1 returning id',[delivery.id])).rows.length,0);
 for(const field of ["status='delivered'","handoff_staff_name='Falso'","payment_receipt_path='ajeno.pdf'","version=500","created_at='2000-01-01'"]){
  await assert.rejects(cashier(`update public.orders set ${field} where id=$1`,[delivery.id]),/permission denied/);
 }
 await assert.rejects(admin("update public.orders set status='delivered' where id=$1",[delivery.id]),/permission denied/);
});
test('state changes use branch authorization, valid transitions, and physical staff evidence',async()=>{
 await assert.rejects(other("select public.transition_order($1,'ready')",[delivery.id]),/no disponible/);
 await assert.rejects(cashier("select public.transition_order($1,'dispatch',$2)",[delivery.id,staffSanta]),/no permitida/);
 const ready=(await cashier("select * from public.transition_order($1,'ready')",[delivery.id])).rows[0];
 assert.equal(ready.status,'ready');assert.ok(ready.ready_at);assert.equal(ready.version,2);
 await assert.rejects(cashier("select public.transition_order($1,'dispatch',$2)",[delivery.id,staffSanta]),/Asigna/);
 await admin("update public.orders set courier_name='Transportador de prueba',courier_plate='TEST00',courier_provider='Independiente' where id=$1",[delivery.id]);
 await assert.rejects(cashier("select public.transition_order($1,'dispatch',$2)",[delivery.id,staffNiquia]),/persona activa/);
 const dispatched=(await cashier("select * from public.transition_order($1,'dispatch',$2)",[delivery.id,staffSanta])).rows[0];
 assert.equal(dispatched.status,'dispatched');assert.equal(dispatched.handoff_staff_id,staffSanta);assert.equal(dispatched.handoff_staff_name,'Responsable Santa');assert.ok(dispatched.dispatched_at);
 await assert.rejects(cashier("select public.transition_order($1,'delivered')",[delivery.id]),/no permitida/);
 const delivered=(await admin("select * from public.transition_order($1,'delivered')",[delivery.id])).rows[0];
 assert.equal(delivered.status,'delivered');assert.ok(delivered.delivered_at);
 await assert.rejects(admin("select public.transition_order($1,'cancel')",[delivery.id]),/no permitida/);
 await assert.rejects(admin('update public.orders set customer_name=\'Otro\' where id=$1',[delivery.id]),/ya finalizó/);
});
test('pickup closes with responsible staff and administrators alone may cancel',async()=>{
 await cashier("select public.transition_order($1,'ready')",[pickup.id]);
 await assert.rejects(cashier("select public.transition_order($1,'pickup')",[pickup.id]),/persona activa/);
 const delivered=(await cashier("select * from public.transition_order($1,'pickup',$2)",[pickup.id,staffSanta])).rows[0];
 assert.equal(delivered.status,'delivered');assert.equal(delivered.dispatched_at,null);assert.ok(delivered.delivered_at);
 await assert.rejects(other("select public.transition_order($1,'cancel')",[niquia.id]),/no permitida/);
 const cancelled=(await admin("select * from public.transition_order($1,'cancel')",[niquia.id])).rows[0];
 assert.equal(cancelled.status,'cancelled');assert.ok(cancelled.cancelled_at);
});
test('order audit records before/after actor snapshots and is immutable for all clients',async()=>{
 const events=(await admin('select * from public.order_events where order_id=$1 order by created_at',[delivery.id])).rows;
 assert.ok(events.some(e=>e.action==='created'&&e.after_data.total===3000));
 assert.ok(events.some(e=>e.action==='dispatch'&&e.actor_name==='Caja Santa de prueba'&&e.staff_name==='Responsable Santa'&&e.before_data.status==='ready'&&e.after_data.status==='dispatched'));
 await assert.rejects(admin("update public.order_events set actor_name='Falso'"),/permission denied/);
 await assert.rejects(db.exec("update public.order_events set actor_name='Falso'"),/inmutable/);
 await assert.rejects(admin('delete from public.orders'),/permission denied/);
});
test('receipts require a real upload belonging to caller, matching bytes and MIME, not just a guessed path',async()=>{
 const o=(await admin(orderSql,['santa-lucia','delivery',JSON.stringify([{qty:1,name:'x',unit_price:200}])])).rows[0];
 const path=`santa-lucia/${o.id}/77777777-7777-4777-8777-777777777777.pdf`;
 await assert.rejects(cashier('select public.attach_payment_receipt($1,$2,$3,$4,$5)',[o.id,path,'Recibo.pdf','application/pdf',128]),/Sube primero/);
 await cashier('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4::jsonb)',['payment-receipts',path,ids.cashier,JSON.stringify({size:128,mimetype:'application/pdf'})]);
 assert.equal((await cashier('select * from storage.objects where name=$1',[path])).rows.length,0,'unattached object is not listed');
 await assert.rejects(admin('select public.attach_payment_receipt($1,$2,$3,$4,$5)',[o.id,path,'Recibo.pdf','application/pdf',128]),/archivo propio/);
 await assert.rejects(cashier('select public.attach_payment_receipt($1,$2,$3,$4,$5)',[o.id,path,'Recibo.pdf','application/pdf',127]),/metadatos/);
 const attached=(await cashier('select * from public.attach_payment_receipt($1,$2,$3,$4,$5)',[o.id,path,'Recibo.pdf','application/pdf',128])).rows[0];
 assert.equal(attached.payment_receipt_path,path);
 assert.equal((await cashier('select * from storage.objects where name=$1',[path])).rows.length,1);
 assert.equal((await other('select * from storage.objects where name=$1',[path])).rows.length,0);
 assert.equal((await anon('select * from storage.objects where name=$1',[path])).rows.length,0);
 await assert.rejects(other('insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4::jsonb)',['payment-receipts',path.replace('77777777','88888888'),ids.other,'{}']),/row-level security/);
 assert.equal((await cashier('update storage.objects set metadata=\'{}\' where name=$1 returning id',[path])).rows.length,0);
});
test('only admins review received CVs; résumés stay private and uploading records stay unavailable',async()=>{
 await db.exec(`insert into public.job_applications(id,receipt,name,email,phone,branch,object_path,file_size,payload_hash,status)
 values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','IMP-UPLOADING','Prueba incompleta','prueba@example.invalid','3000000000','niquia','cv-pendiente.pdf',128,'test','uploading');
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('hojas-de-vida','cv-prueba.pdf',null,'{"size":128,"mimetype":"application/pdf"}'),('hojas-de-vida','archivo-huerfano.pdf',null,'{}'),('hojas-de-vida','cv-pendiente.pdf',null,'{}')`);
 assert.equal((await cashier('select * from public.job_applications')).rows.length,0);
 assert.equal((await cashier("select * from storage.objects where bucket_id='hojas-de-vida'")).rows.length,0);
 assert.deepEqual((await admin("select name from storage.objects where bucket_id='hojas-de-vida'")).rows.map(r=>r.name),['cv-prueba.pdf']);
 assert.equal((await admin('select * from public.job_applications')).rows.length,1);
 await assert.rejects(admin("select public.review_application('dddddddd-dddd-4ddd-8ddd-dddddddddddd','reviewing','')"),/no recibida/);
 await assert.rejects(anon('select * from public.job_applications'),/permission denied/);
 await assert.rejects(cashier("select public.review_application($1,'contacted','nota')",[resumeId]),/Solo administración/);
 const reviewed=(await admin("select * from public.review_application($1,'reviewing','Revisión humana')",[resumeId])).rows[0];
 assert.equal(reviewed.status,'received');assert.equal(reviewed.review_status,'reviewing');assert.equal(reviewed.internal_notes,'Revisión humana');
 await assert.rejects(admin("update public.job_applications set review_status='archived'"),/permission denied/);
 assert.equal((await admin('select * from public.application_events')).rows.length,1);
});
test('inventory changes are admin-only, serialize counts, and keep before/after audit',async()=>{
 product=(await admin("insert into public.products(name,sku,price) values('Producto prueba','TEST-01',2000) returning id")).rows[0].id;
 await assert.rejects(cashier("select public.set_branch_inventory('santa-lucia',$1,5)",[product]),/Solo administración/);
 await assert.rejects(admin("select public.set_branch_inventory('santa-lucia',$1,-1)",[product]),/Cantidad inválida/);
 await admin("select public.set_branch_inventory('santa-lucia',$1,8)",[product]);
 const count=(await admin("select * from public.set_branch_inventory('santa-lucia',$1,6)",[product])).rows[0];assert.equal(count.quantity,6);
 assert.equal((await admin('select * from public.inventory_events')).rows.length,2);
 assert.equal((await cashier('select * from public.products where id=$1',[product])).rows.length,1);
 assert.equal((await other('select * from public.products where id=$1',[product])).rows.length,0);
 await assert.rejects(admin('update public.branch_inventory set quantity=999'),/permission denied/);
 await assert.rejects(cashier("insert into public.products(name,price) values('No autorizado',1)"),/row-level security/);
});
test('knowledge is scoped to own branch and shared items; inactive and cross-branch content stays hidden',async()=>{
 await admin("insert into public.branch_knowledge(branch_id,topic,content,active) values(null,'Compartido','Instrucciones',true),('santa-lucia','Santa','Instrucciones',true),('niquia','Niquía','Instrucciones',true),('santa-lucia','Borrador','Instrucciones',false)");
 assert.deepEqual((await cashier('select topic from public.branch_knowledge order by topic')).rows.map(r=>r.topic),['Compartido','Santa']);
 assert.equal((await user(ids.inactive,'select * from public.branch_knowledge')).rows.length,0);
});
test('only published vacancies expose safe columns and changes are audited',async()=>{
 await admin("insert into public.vacancies(title,description,status) values('Vacante borrador de prueba','Descripción sintética suficientemente larga','draft'),('Vacante publicada de prueba','Descripción sintética suficientemente larga','published')");
 const publicList=(await anon('select id,title,branch_id,description,requirements,status from public.vacancies')).rows;
 assert.equal(publicList.length,1);assert.equal(publicList[0].status,'published');
 await assert.rejects(anon('select * from public.vacancies'),/permission denied/);
 assert.equal((await cashier('select * from public.vacancies')).rows.length,0);
 assert.equal((await admin('select * from public.vacancy_events')).rows.length,2);
});
test('PQRS are private, updated through admin RPC, and responses record an immutable event without pretending to send mail',async()=>{
 caseId=(await db.query(`insert into public.pqrs_cases(case_number,type,customer_name,customer_email,subject,description,lookup_hash,request_id,payload_hash)
 values('IMP-PQRS-TEST','peticion','Prueba sintética','prueba@example.invalid','Asunto de prueba','Descripción de prueba suficiente','hash','99999999-9999-4999-8999-999999999999','payload') returning id`)).rows[0].id;
 assert.equal((await cashier('select * from public.pqrs_cases')).rows.length,0);
 await assert.rejects(anon('select * from public.pqrs_cases'),/permission denied/);
 await assert.rejects(cashier("select public.update_pqrs_case($1,'completed','','Respuesta')",[caseId]),/Solo administración/);
 const updated=(await admin("select * from public.update_pqrs_case($1,'completed','Solo interno','Respuesta registrada')",[caseId])).rows[0];
 assert.equal(updated.response_message,'Respuesta registrada');assert.equal(updated.internal_notes,'Solo interno');
 const events=(await admin('select * from public.pqrs_case_events where case_id=$1',[caseId])).rows;
 assert.equal(events.length,2);const response=events.find(e=>e.response_message);assert.equal(response.response_message,'Respuesta registrada');assert.equal(response.status_before,'received');assert.ok(events.some(e=>e.message==='Solicitud recibida'));
 await assert.rejects(admin("update public.pqrs_cases set response_message='Sin historial'"),/permission denied/);
});
test('branch chat is authorized, sender comes from profile, and duplicate retries cannot forge a different payload',async()=>{
 const request='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const first=(await cashier("select * from public.send_internal_chat('santa-lucia','Mensaje de prueba',$1)",[request])).rows[0];
 const second=(await cashier("select * from public.send_internal_chat('santa-lucia','Mensaje de prueba',$1)",[request])).rows[0];
 assert.equal(first.id,second.id);assert.equal(first.sender_id,ids.cashier);assert.equal(first.sender_role,'cashier');
 await assert.rejects(cashier("select public.send_internal_chat('niquia','Mensaje de prueba',$1)",[request]),/no disponible/);
 await assert.rejects(cashier("select public.send_internal_chat('santa-lucia','Otro mensaje',$1)",[request]),/otro mensaje/);
 assert.equal((await other('select * from public.internal_chat_messages')).rows.length,0);
 await assert.rejects(cashier("insert into public.internal_chat_messages(branch_id,sender_id,sender_name,sender_role,body,request_id) values('santa-lucia',$1,'Admin','admin','Falso',$2)",[ids.cashier,'cccccccc-cccc-4ccc-8ccc-cccccccccccc']),/permission denied/);
});
test('chat read markers are monotonic, user-specific and cannot hide future messages',async()=>{
 const overview=(await admin('select * from public.internal_chat_overview()')).rows;
 assert.equal(overview.find(b=>b.branch_id==='santa-lucia').unread,1);
 const id=overview.find(b=>b.branch_id==='santa-lucia').last_message.id;
 await admin("select public.mark_internal_chat_read('santa-lucia',$1)",[id]);
 await admin("select public.mark_internal_chat_read('santa-lucia',0)");
 assert.equal((await admin('select * from public.internal_chat_overview()')).rows.find(b=>b.branch_id==='santa-lucia').unread,0);
 await assert.rejects(admin("select public.mark_internal_chat_read('santa-lucia',999999)"),/Marcador inválido/);
 assert.equal((await cashier('select * from public.internal_chat_reads')).rows.length,0);
 assert.equal((await cashier('select * from public.internal_chat_overview()')).rows.length,1);
});
test('public access has no privileged RPCs and internal functions cannot be called directly',async()=>{
 await assert.rejects(anon("select public.transition_order($1,'ready')",[delivery.id]),/permission denied/);
 await assert.rejects(anon('select public.internal_chat_overview()'),/permission denied/);
 await assert.rejects(cashier('select importados_private.immutable_event()'),/permission denied/);
 const rls=(await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).rows;
 assert.ok(rls.every(t=>t.relrowsecurity));
 const security=(await db.query("select proname,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where prosecdef and n.nspname='public'")).rows;
 assert.ok(security.every(f=>f.proconfig.includes('search_path=""')));
});
