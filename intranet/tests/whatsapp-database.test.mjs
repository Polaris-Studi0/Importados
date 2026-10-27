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
async function authorize(initial,phone){
 const c=await conversation(initial.conversation_id);const meta='wamid.synthetic.auth.'+randomUUID();
 const queued=await rpc('whatsapp_commit_reply',[c.id,initial.message_id,c.control_version,c.context_version,randomUUID(),'Aviso sintético https://tiendasimportados.com/privacidad-prueba-sintetica','privacy_notice',null]);
 const claim=await rpc('whatsapp_claim_outbox');assert.equal(claim.id,queued.outbox_id);
 await rpc('whatsapp_finish_outbox',[claim.id,claim.lease_token,'sent',meta,null]);
 await rpc('whatsapp_receive_event',[JSON.stringify(event(null,'',{event_type:'status',meta_message_id:meta,status:'delivered'}))]);
 return incoming(phone,'YO ACEPTO');
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
 for(const id of Object.values(ids))await db.query('insert into auth.users(id) values($1)',[id]);
 await db.query(`insert into public.profiles(id,full_name,role,branch_id,active) values
 ($1,'Admin sintético','admin',null,true),($2,'Caja Santa sintética','cashier','santa-lucia',true),
 ($3,'Caja Niquía sintética','cashier','niquia',true),($4,'Inactivo sintético','cashier','santa-lucia',false)`,Object.values(ids).slice(0,4));
});
after(async()=>db?.close());

test('repeatable migration starts every live path disabled and creates no customer/catalog data',async()=>{
 const c=(await db.query('select * from public.whatsapp_config')).rows[0];
 assert.equal(c.ingress_enabled,false);assert.equal(c.ai_enabled,false);assert.equal(c.outbound_enabled,false);assert.equal(c.public_since,null);assert.equal(c.privacy_url,null);
 for(const table of ['whatsapp_conversations','whatsapp_messages','whatsapp_tasks','whatsapp_outbox','products'])assert.equal((await db.query('select count(*)::int as n from public.'+table)).rows[0].n,0);
 await assert.rejects(incoming('573000000001'),/no está habilitado/);
 await db.query(`update public.whatsapp_config set ingress_enabled=true,ai_enabled=true,outbound_enabled=true,phone_number_id=$1,waba_id=$2,privacy_url='https://tiendasimportados.com/privacidad-prueba-sintetica',privacy_version='synthetic-v1',public_since=now()-interval '1 day'`,[phoneId,wabaId]);
});
test('browser roles cannot ingest, impersonate staff, change config, or directly mutate conversations',async()=>{
 for(const [name,args] of [['whatsapp_receive_event',[JSON.stringify(event('573000000002'))]],['whatsapp_claim_outbox',[]],['whatsapp_claim_inbox',[]],['whatsapp_record_issue',[randomUUID(),randomUUID(),randomUUID()]]]){
  await assert.rejects(user(ids.admin,'select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')',args),/permission denied/);
 }
 await assert.rejects(user(ids.admin,'update public.whatsapp_config set outbound_enabled=true'),/permission denied/);
 await assert.rejects(asRole('anon','select * from public.whatsapp_conversations'),/permission denied/);
});
test('signed-event ingestion is durable and idempotent for both event keys and Meta message IDs',async()=>{
 const e=event('573000000003');const first=await rpc('whatsapp_receive_event',[JSON.stringify(e)]);
 assert.equal((await rpc('whatsapp_receive_event',[JSON.stringify(e)])).duplicate,true);
 const alternate={...e,event_key:createHash('sha256').update('same-message-other-envelope').digest('hex')};
 assert.equal((await rpc('whatsapp_receive_event',[JSON.stringify(alternate)])).duplicate,true);
 assert.equal((await db.query('select count(*)::int as n from public.whatsapp_messages where conversation_id=$1',[first.conversation_id])).rows[0].n,1);
 assert.equal((await conversation(first.conversation_id)).context_version,1);
 await assert.rejects(rpc('whatsapp_receive_event',[JSON.stringify(event('573000000004','x',{phone_number_id:'9999999999999'}))]),/no autorizado/);
 const old=await incoming('573000000005','Histórico sintético',{occurred_at:new Date(Date.now()-172800000).toISOString()});assert.equal(old.blocked,true);
});
test('BSUID works without a phone and explicit dual identifiers can link a phone-only contact',async()=>{
 const bsuid='CO.synthetic_contact_001';
 const first=await incoming(null,'Consulta privada',{identity_key:bsuid,customer_phone:null,customer_bsuid:bsuid});
 const row=await conversation(first.conversation_id);assert.equal(row.customer_phone,null);assert.equal(row.identity_key,bsuid);
 const phone=await incoming('573000000006');
 const linked=await incoming('573000000006','Identidad dual',{identity_key:'CO.synthetic_linked_006',customer_bsuid:'CO.synthetic_linked_006'});
 assert.equal(linked.conversation_id,phone.conversation_id);assert.equal((await conversation(phone.conversation_id)).identity_key,'CO.synthetic_linked_006');
});
test('RLS follows active staff and the current conversation branch, including orphan-free history/tasks',async()=>{
 const santa=await incoming('573000000007'),niquia=await incoming('573000000008');
 await db.query("update public.whatsapp_conversations set branch_id='santa-lucia' where id=$1",[santa.conversation_id]);
 await db.query("update public.whatsapp_conversations set branch_id='niquia' where id=$1",[niquia.conversation_id]);
 assert.equal((await user(ids.santa,'select * from public.whatsapp_conversations where id=$1',[santa.conversation_id])).rows.length,1);
 assert.equal((await user(ids.santa,'select * from public.whatsapp_messages where conversation_id=$1',[niquia.conversation_id])).rows.length,0);
 for(const id of [ids.inactive,ids.stranger])assert.equal((await user(id,'select * from public.whatsapp_conversations')).rows.length,0);
 await assert.rejects(rpc('whatsapp_staff_action',[ids.niquia,santa.conversation_id,'pause',randomUUID(),0,'{}']),/no disponible/);
 await assert.rejects(user(ids.santa,"update public.whatsapp_conversations set manual_paused=false where id=$1",[santa.conversation_id]),/permission denied/);
});
test('staff actions use versions and request idempotency and cancel queued work on takeover',async()=>{
 const c=await incoming('573000000009');const request=randomUUID();
 const first=await action(c.conversation_id,'pause',{},request,0);assert.equal(first.conversation.manual_paused,true);
 assert.deepEqual(await action(c.conversation_id,'pause',{},request,0),first);
 await assert.rejects(action(c.conversation_id,'resume',{},request,1),/reutilizado/);
 await assert.rejects(action(c.conversation_id,'resume',{},randomUUID(),0),/cambió/);
 await action(c.conversation_id,'resume');
 const accepted=await authorize(c,'573000000009');
 const row=await conversation(c.conversation_id);
 await rpc('whatsapp_commit_reply',[row.id,accepted.message_id,row.control_version,row.context_version,randomUUID(),'Respuesta sintética','reply',null]);
 await action(row.id,'pause');
 assert.equal((await db.query("select status from public.whatsapp_outbox where conversation_id=$1 and purpose='reply'",[row.id])).rows[0].status,'cancelled');
});
test('consent requires the current full notice to have a delivered/read receipt',async()=>{
 const initial=await incoming('573000000010','YO ACEPTO');let c=await conversation(initial.conversation_id);assert.equal(c.consent_status,'unknown');
 const queued=await rpc('whatsapp_commit_reply',[c.id,initial.message_id,c.control_version,c.context_version,randomUUID(),'Aviso sintético https://tiendasimportados.com/privacidad-prueba-sintetica','privacy_notice',null]);
 const claim=await rpc('whatsapp_claim_outbox');assert.equal(claim.id,queued.outbox_id);
 await rpc('whatsapp_finish_outbox',[claim.id,claim.lease_token,'sent','wamid.synthetic.privacy',null]);
 await incoming('573000000010','YO ACEPTO');assert.equal((await conversation(c.id)).consent_status,'unknown');
 const status=event(null,'',{event_type:'status',meta_message_id:'wamid.synthetic.privacy',status:'delivered'});await rpc('whatsapp_receive_event',[JSON.stringify(status)]);
 await incoming('573000000010','YO ACEPTO');assert.equal((await conversation(c.id)).consent_status,'granted');
 await incoming('573000000010','NO AUTORIZO');c=await conversation(c.id);assert.equal(c.consent_status,'revoked');assert.equal(c.privacy_notice_delivered_at,null);
});
test('outbound has one attempt and an uncertain delivery can never be claimed again',async()=>{
 const initial=await incoming('573000000011');await authorize(initial,'573000000011');
 await action(initial.conversation_id,'pause');const queued=await action(initial.conversation_id,'send',{text:'Respuesta humana sintética'});
 const claim=await rpc('whatsapp_claim_outbox');assert.equal(claim.id,queued.outbox.id);
 await rpc('whatsapp_finish_outbox',[claim.id,claim.lease_token,'uncertain',null,'test_network_unknown']);
 assert.equal(await rpc('whatsapp_claim_outbox'),null);
 const row=(await db.query('select status,attempts from public.whatsapp_outbox where id=$1',[claim.id])).rows[0];assert.equal(row.status,'uncertain');assert.equal(row.attempts,1);
 const c=await conversation(initial.conversation_id);await db.query("update public.whatsapp_conversations set last_customer_at=now()-interval '25 hours' where id=$1",[c.id]);
 await assert.rejects(action(c.id,'send',{text:'Fuera de ventana'}),/ventana vigente/);
});
test('resolved tasks create one durable follow-up, held during takeover and available after resume',async()=>{
 await db.exec("update public.whatsapp_inbox set state='processed' where kind='message'");
 const initial=await incoming('573000000012');await db.query("update public.whatsapp_conversations set branch_id='santa-lucia',consent_status='granted',consent_version='synthetic-v1' where id=$1",[initial.conversation_id]);
 await db.query("update public.whatsapp_inbox set state='processed' where id=$1",[initial.inbox_id]);
 const task=(await db.query("insert into public.whatsapp_tasks(conversation_id,branch_id,kind,question,source_message_id,dedupe_key) values($1,'santa-lucia','stock_check','¿Precio sintético?',$2,'test') returning id",[initial.conversation_id,initial.message_id])).rows[0];
 await action(initial.conversation_id,'pause');const request=randomUUID();const c=await conversation(initial.conversation_id);
 await action(c.id,'resolve_task',{task_id:task.id,answer:'Precio confirmado sintético: $9.000.'},request,c.control_version);
 await action(c.id,'resolve_task',{task_id:task.id,answer:'Precio confirmado sintético: $9.000.'},request,c.control_version);
 assert.equal(await rpc('whatsapp_claim_inbox'),null);
 await action(c.id,'resume');const followup=await rpc('whatsapp_claim_inbox');assert.equal(followup.kind,'human_resolution');assert.equal(followup.event.task_id,task.id);
 assert.equal((await db.query("select count(*)::int as n from public.whatsapp_inbox where kind='human_resolution' and conversation_id=$1",[c.id])).rows[0].n,1);
});
test('generation failures create a visible idempotent human task without fabricating delivery',async()=>{
 const c=await incoming('573000000013');await rpc('whatsapp_record_issue',[c.conversation_id,c.message_id,c.inbox_id]);await rpc('whatsapp_record_issue',[c.conversation_id,c.message_id,c.inbox_id]);
 const tasks=(await db.query('select * from public.whatsapp_tasks where conversation_id=$1',[c.conversation_id])).rows;assert.equal(tasks.length,1);assert.equal(tasks[0].status,'pending');
 assert.equal((await db.query('select count(*)::int as n from public.whatsapp_outbox where conversation_id=$1',[c.conversation_id])).rows[0].n,0);
});
test('late privacy receipts cannot authorize a replacement version or restore a revoked notice',async()=>{
 const initial=await incoming('573000000014','Consulta sintética');let c=await conversation(initial.conversation_id);
 const old=await rpc('whatsapp_commit_reply',[c.id,initial.message_id,c.control_version,c.context_version,randomUUID(),'Aviso v1 https://tiendasimportados.com/privacidad-prueba-sintetica','privacy_notice',null]);
 let claim=await rpc('whatsapp_claim_outbox');assert.equal(claim.id,old.outbox_id);await rpc('whatsapp_finish_outbox',[claim.id,claim.lease_token,'sent','wamid.synthetic.old-notice',null]);
 await db.exec("update public.whatsapp_config set privacy_version='synthetic-v2'");c=await conversation(c.id);
 const next=await rpc('whatsapp_commit_reply',[c.id,initial.message_id,c.control_version,c.context_version,randomUUID(),'Aviso v2 https://tiendasimportados.com/privacidad-prueba-sintetica','privacy_notice',null]);
 claim=await rpc('whatsapp_claim_outbox');assert.equal(claim.id,next.outbox_id);await rpc('whatsapp_finish_outbox',[claim.id,claim.lease_token,'sent','wamid.synthetic.new-notice',null]);
 await rpc('whatsapp_receive_event',[JSON.stringify(event(null,'',{event_type:'status',meta_message_id:'wamid.synthetic.old-notice',status:'read'}))]);
 c=await conversation(c.id);assert.equal(c.privacy_notice_id,next.outbox_id);assert.equal(c.privacy_notice_delivered_at,null);
 await incoming('573000000014','YO ACEPTO');assert.equal((await conversation(c.id)).consent_status,'unknown');
 await rpc('whatsapp_receive_event',[JSON.stringify(event(null,'',{event_type:'status',meta_message_id:'wamid.synthetic.new-notice',status:'delivered'}))]);
 await incoming('573000000014','YO ACEPTO');assert.equal((await conversation(c.id)).consent_status,'granted');
 await incoming('573000000014','NO AUTORIZO');
 await rpc('whatsapp_receive_event',[JSON.stringify(event(null,'',{event_type:'status',meta_message_id:'wamid.synthetic.new-notice',status:'read'}))]);
 await incoming('573000000014','YO ACEPTO');c=await conversation(c.id);assert.equal(c.consent_status,'revoked');assert.equal(c.privacy_notice_id,null);assert.equal(c.privacy_notice_delivered_at,null);
});

test('operator photo is scoped, requires takeover and authorization, and commits one durable image',async()=>{
 await db.exec("update public.whatsapp_config set privacy_version='synthetic-v1'");
 const initial=await incoming('573000000015');await authorize(initial,'573000000015');
 const media=randomUUID();await db.query("insert into public.whatsapp_operator_media values($1,$2,$3,'synthetic/private.jpg','image/jpeg',64,repeat('a',64),'producto.jpg',now())",[media,initial.conversation_id,ids.admin]);
 await assert.rejects(action(initial.conversation_id,'send_image',{media_id:media}),/control manual/);
 await action(initial.conversation_id,'pause');
 const request=randomUUID();const c=await conversation(initial.conversation_id);
 const sent=await action(c.id,'send_image',{media_id:media,text:'Foto confirmada'},request,c.control_version);
 assert.deepEqual(await action(c.id,'send_image',{media_id:media,text:'Foto confirmada'},request,c.control_version),sent);
 const claim=await rpc('whatsapp_claim_outbox');assert.equal(claim.id,sent.outbox.id);assert.equal(claim.kind,'image');assert.equal(claim.media_asset_id,media);
 await rpc('whatsapp_finish_outbox',[claim.id,claim.lease_token,'sent','wamid.synthetic.photo',null]);
 const message=(await db.query('select kind,attachment from public.whatsapp_messages where meta_message_id=$1',['wamid.synthetic.photo'])).rows[0];assert.equal(message.kind,'image');assert.equal(message.attachment.asset_id,media);
 await assert.rejects(user(ids.santa,'select * from public.whatsapp_operator_media'),/permission denied/);
});
test('new human requests queue one alert and wait for a session or approved template without sending twice',async()=>{
 await db.exec("update public.whatsapp_operator_alerts set status='cancelled' where status='queued'");
 const c=await incoming('573000000016');await rpc('whatsapp_record_issue',[c.conversation_id,c.message_id,c.inbox_id]);await rpc('whatsapp_record_issue',[c.conversation_id,c.message_id,c.inbox_id]);
 assert.equal((await db.query("select count(*)::int as n from public.whatsapp_operator_alerts where status='queued'")).rows[0].n,1);
 assert.equal(await rpc('whatsapp_claim_operator_alert',[false,false]),null);
 const claim=await rpc('whatsapp_claim_operator_alert',[false,true]);assert.equal(claim.use_template,true);
 await rpc('whatsapp_finish_operator_alert',[claim.id,claim.lease_token,'uncertain',null,'synthetic_network_unknown']);assert.equal(await rpc('whatsapp_claim_operator_alert',[true,true]),null);
 await assert.rejects(user(ids.admin,'select * from public.whatsapp_operator_alerts'),/permission denied/);
});
