import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import worker from '../src/worker.js';
import {callAssistant,processInbox,quietAcknowledgement,runWhatsAppJobs,sendOne,syntheticTurn,validateDecision} from '../src/bot-turn.js';
import {validWorkflowUrl} from '../src/whatsapp-core.js';

const serviceOrigin='https://opeytkcqblgjfyvfjkwe.supabase.co';
const userId=randomUUID(),conversationId=randomUUID(),phoneId='123456789101112',wabaId='234567891011121';
const env={SUPABASE_URL:serviceOrigin,SUPABASE_SERVICE_KEY:'synthetic-service-key',N8N_WEBHOOK_SECRET:'synthetic-own-webhook-key',N8N_BOT_WEBHOOK_URL:'https://intranetelrey.app.n8n.cloud/webhook/importados-assistant-turn-v1'};
const liveEnv={...env,WHATSAPP_APP_ID:'1378513457688529',WHATSAPP_PHONE_NUMBER_ID:phoneId,WHATSAPP_WABA_ID:wabaId,WHATSAPP_GRAPH_VERSION:'v26.0',WHATSAPP_APP_SECRET:'synthetic-app-key',WHATSAPP_ACCESS_TOKEN:'synthetic-meta-key',WHATSAPP_VERIFY_TOKEN:'synthetic-verify-key',WHATSAPP_INGRESS_ENABLED:'true',WHATSAPP_OUTBOUND_ENABLED:'true',BOT_AI_ENABLED:'true'};
const cfg={app_id:'1378513457688529',phone_number_id:phoneId,waba_id:wabaId,privacy_url:'https://tiendasimportados.com/privacidad-prueba-sintetica',privacy_version:'synthetic-v1',public_since:new Date(Date.now()-86400000).toISOString(),ingress_enabled:true,ai_enabled:true,outbound_enabled:true};
const conversation={id:conversationId,branch_id:'santa-lucia',customer_phone:'573000000000',manual_paused:true,status:'open',consent_status:'granted',consent_version:'synthetic-v1',last_customer_at:new Date().toISOString(),control_version:1,context_version:1,session_started_at:new Date(Date.now()-60000).toISOString()};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const request=(path,{method='GET',body,headers={}}={})=>new Request('https://intranet.tiendasimportados.com'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const auth={Authorization:'Bearer synthetic.valid.session'};
async function mocked(handler,run){const previous=globalThis.fetch;const calls=[];globalThis.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url);calls.push({url,options});return handler(url,options);};try{return await run(calls);}finally{globalThis.fetch=previous;}}
function authHandler(url,role='admin',active=true){if(url.pathname==='/auth/v1/user')return response({id:userId});if(url.pathname==='/rest/v1/profiles')return response([{id:userId,role,active,branch_id:'santa-lucia'}]);return null;}
function webhook(events={}){return {object:'whatsapp_business_account',entry:[{id:wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:phoneId},...events}}]}]};}
function signed(payload,secret=liveEnv.WHATSAPP_APP_SECRET){const body=JSON.stringify(payload);return new Request('https://intranet.tiendasimportados.com/api/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256',secret).update(body).digest('hex')},body});}
function validResponse(packet,extra={}){return {contract:'importados.bot.decision.v1',status:'decision_ready',mode:packet.mode,source:packet.snapshot.source,turn_id:packet.turn_id,conversation_id:packet.conversation_id,expected_control_version:packet.control_version,expected_context_version:packet.context_version,expected_context_fingerprint:packet.context_fingerprint,expires_at:packet.snapshot.expires_at,send_allowed:false,requires_commit:true,mutations_executed:[],decision:{intent:'information',reply_text:'Respuesta sintética sin envío.',offered_product_ids:[],quote:null,actions:[],checkout:{},confirmed_item:null,accept_summary:false,cancel_cart:false,media_ids:[]},evidence:{tools_used:['consultar_informacion']},...extra};}
function resources(url){if(url.pathname==='/rest/v1/branches')return response([{id:'santa-lucia',name:'Santa Lucía · Medellín',address:'Dirección confirmada de prueba',hours:'Horario confirmado de prueba'},{id:'niquia',name:'Niquía · Bello',address:'Dirección confirmada de prueba',hours:null}]);if(url.pathname==='/rest/v1/branch_knowledge')return response([{id:randomUUID(),topic:'Fuente sintética',content:'Información sintética autorizada.'}]);if(['/rest/v1/products','/rest/v1/branch_inventory'].includes(url.pathname))return response([]);return null;}

test('staff endpoints require a verified active profile and deny untrusted origins before private reads',async()=>{
 await mocked(()=>assert.fail('Private request without authentication'),async()=>{assert.equal((await worker.fetch(request('/api/whatsapp/conversations'),env)).status,401);assert.equal((await worker.fetch(request('/api/whatsapp/status',{headers:{Origin:'https://unrelated.invalid',...auth}}),env)).status,403);});
 await mocked(url=>authHandler(url,'admin',false)||assert.fail(url.href),async()=>{assert.equal((await worker.fetch(request('/api/whatsapp/conversations',{headers:auth}),env)).status,403);});
 await mocked(url=>authHandler(url,'cashier')||assert.fail(url.href),async()=>{assert.equal((await worker.fetch(request('/api/whatsapp/status',{headers:auth}),env)).status,403);});
});
test('cashier lists are branch scoped and a foreign detail leaks no messages, tasks or config',async()=>{
 await mocked(url=>authHandler(url,'cashier')||(url.pathname==='/rest/v1/whatsapp_conversations'?(assert.equal(url.searchParams.get('branch_id'),'eq.santa-lucia'),response([])):assert.fail(url.href)),async()=>{assert.equal((await worker.fetch(request('/api/whatsapp/conversations',{headers:auth}),env)).status,200);});
 await mocked(url=>authHandler(url,'cashier')||(url.pathname==='/rest/v1/whatsapp_conversations'?response([{...conversation,branch_id:'niquia'}]):assert.fail('Foreign scope leaked '+url.pathname)),async()=>{assert.equal((await worker.fetch(request('/api/whatsapp/conversations/'+conversationId,{headers:auth}),env)).status,404);});
});
test('status describes disabled live paths and private workflow configuration without exposing credentials',async()=>{
 await mocked(url=>authHandler(url)||(url.pathname==='/rest/v1/whatsapp_config'?response([{...cfg,ingress_enabled:false,ai_enabled:false,outbound_enabled:false,phone_number_id:null,waba_id:null,privacy_url:null,public_since:null}]):url.pathname==='/rest/v1/whatsapp_tasks'?response([]):assert.fail(url.href)),async()=>{const result=await worker.fetch(request('/api/whatsapp/status',{headers:auth}),env);assert.equal(result.status,200);const data=await result.json();assert.equal(data.channel.enabled,false);assert.equal(data.automation.enabled,false);assert.equal(data.automation.configured,true);assert.equal(data.capabilities.manual_send,false);assert.ok(data.blockers.length);assert.equal(JSON.stringify(data).includes(env.N8N_WEBHOOK_SECRET),false);assert.equal(JSON.stringify(data).includes(env.SUPABASE_SERVICE_KEY),false);});
});
test('manual send cannot reach the outbox or Meta while runtime flags are disabled',async()=>{
 await mocked(url=>authHandler(url)||(url.pathname==='/rest/v1/whatsapp_config'?response([cfg]):url.pathname==='/rest/v1/whatsapp_conversations'?response([conversation]):assert.fail('Send escaped the runtime gate: '+url.href)),async()=>{const result=await worker.fetch(request('/api/whatsapp/conversations/'+conversationId+'/actions',{method:'POST',headers:auth,body:{action:'send',request_id:randomUUID(),expected_control_version:1,text:'Mensaje sintético'}}),env);assert.equal(result.status,409);});
});
test('webhook challenge checks the configured secret and live ingress defaults to disabled',async()=>{
 await mocked(()=>assert.fail('Disabled webhook reached a provider'),async()=>{
  const valid=await worker.fetch(request('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify-key&hub.challenge=123456'),liveEnv);assert.equal(valid.status,200);assert.equal(await valid.text(),'123456');
  assert.equal((await worker.fetch(request('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123456'),liveEnv)).status,403);
  assert.equal((await worker.fetch(signed(webhook()),env)).status,503);
 });
});
test('unsigned and wrong-scope webhook batches are refused before durable writes',async()=>{
 await mocked(()=>assert.fail('Invalid signature reached private storage'),async()=>{assert.equal((await worker.fetch(signed(webhook(),'wrong-key'),liveEnv)).status,401);});
 const payload=webhook({messages:[{id:'wamid.synthetic.scope',from:'573000000000',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Prueba sintética'}}]});payload.entry[0].changes[0].value.metadata.phone_number_id='999999999999';
 await mocked(url=>url.pathname==='/rest/v1/whatsapp_config'?response([cfg]):assert.fail('Wrong-scope event was stored'),async()=>{assert.equal((await worker.fetch(signed(payload),liveEnv)).status,403);});
});
test('a successful webhook acknowledges only after its message is durable, including private BSUID identity',async()=>{
 const payload=webhook({messages:[{id:'wamid.synthetic.private',from_user_id:'CO.synthetic_identity_001',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Consulta sintética'}}]});let saved=false;
 await mocked((url,options)=>{if(url.pathname==='/rest/v1/whatsapp_config')return response([cfg]);assert.equal(url.pathname,'/rest/v1/rpc/whatsapp_receive_event');const body=JSON.parse(options.body);assert.equal(body.p_event.customer_phone,null);assert.equal(body.p_event.identity_key,'CO.synthetic_identity_001');saved=true;return response({accepted:true});},async()=>{const result=await worker.fetch(signed(payload),{...liveEnv,WHATSAPP_OUTBOUND_ENABLED:'false'});assert.equal(result.status,200);assert.equal(saved,true);});
 await mocked(url=>url.pathname==='/rest/v1/whatsapp_config'?response([cfg]):response({error:'storage unavailable'},500),async()=>{assert.equal((await worker.fetch(signed(payload),liveEnv)).status,503);});
});
test('status callbacks persist delivery updates without starting n8n or background jobs',async()=>{
 const jobs=[];await mocked((url,options)=>{if(url.pathname==='/rest/v1/whatsapp_config')return response([cfg]);assert.equal(url.pathname,'/rest/v1/rpc/whatsapp_receive_event');assert.equal(JSON.parse(options.body).p_event.event_type,'status');return response({accepted:true,kind:'status'});},async()=>{const result=await worker.fetch(signed(webhook({statuses:[{id:'wamid.synthetic.sent',status:'read',timestamp:String(Math.floor(Date.now()/1000))}]})),liveEnv,{waitUntil:promise=>jobs.push(promise)});assert.equal(result.status,200);assert.equal(jobs.length,0);});
});
test('synthetic preview uses the actual n8n input validator and never reads customer history or mutates data',async()=>{
 const code=await readFile(new URL('../../n8n/source/validate-turn.js',import.meta.url),'utf8');const normalize=new Function('$input',code);
 await mocked(url=>resources(url)||assert.fail('Synthetic preview read customer data '+url.href),async()=>{const packet=await syntheticTurn(env,{text:'¿Cuál es el horario?',branch_id:'santa-lucia'});assert.equal(packet.mode,'test');assert.equal(packet.snapshot.source,'synthetic');assert.equal(packet.snapshot.control.consent,'granted');const [{json}]=normalize({all:()=>[{json:{body:packet}}]});assert.equal(json.allow_ai,true);assert.equal(json.context.history.length,0);assert.equal(json.context.products.length,0);assert.equal(json.context.payment.ready_for_qr,false);});
});
test('a branch with unconfirmed store hours cannot inherit another branch hours guard',async()=>{
 await mocked(url=>resources(url)||assert.fail(url.href),async()=>{
  const santa=await syntheticTurn(env,{text:'¿A qué hora abre esta sede?',branch_id:'santa-lucia'});
  const niquia=await syntheticTurn(env,{text:'¿A qué hora abre esta sede?',branch_id:'niquia'});
  assert.ok(santa.snapshot.information.some(item=>item.topic.startsWith('Horario físico Santa')));
  assert.equal(niquia.snapshot.information.some(item=>/^(?:schedule:|horario físico)/i.test(item.topic)),false);
  assert.ok(niquia.snapshot.information.find(item=>item.id==='importados-branches').text.includes('Horario físico pendiente de confirmar.'));
 });
});
test('preview authentication, bounded rate limit and private proposal never enqueue a delivery',async()=>{
 let packet;
 await mocked((url,options)=>{const authResult=authHandler(url);if(authResult)return authResult;const resource=resources(url);if(resource)return resource;assert.equal(url.href,env.N8N_BOT_WEBHOOK_URL);assert.equal(options.headers['x-importados-webhook-secret'],env.N8N_WEBHOOK_SECRET);packet=JSON.parse(options.body);assert.equal(packet.mode,'test');return response(validResponse(packet));},async()=>{const result=await worker.fetch(request('/api/whatsapp/preview',{method:'POST',headers:auth,body:{text:'Consulta sintética'}}),env);assert.equal(result.status,200);assert.equal((await result.json()).send_allowed,false);});
 await mocked(url=>authHandler(url)||assert.fail('Rate limit allowed model/storage access'),async()=>{const result=await worker.fetch(request('/api/whatsapp/preview',{method:'POST',headers:auth,body:{text:'Consulta sintética'}}),{...env,PUBLIC_LIMITER:{async limit({key}){assert.match(key,/^whatsapp-preview:[a-f0-9]{64}$/);return {success:false};}}});assert.equal(result.status,429);});
});
test('Worker independently rejects stale/foreign decisions and product/media/QR references',async()=>{
 await mocked(url=>resources(url)||assert.fail(url.href),async()=>{const packet=await syntheticTurn(env,{text:'Prueba'});const base=validResponse(packet);assert.equal(validateDecision(base,packet),base);for(const change of [{turn_id:randomUUID()},{send_allowed:true},{mutations_executed:['write']},{expected_context_fingerprint:'x'.repeat(64)}])assert.throws(()=>validateDecision({...base,...change},packet));for(const decision of [{...base.decision,offered_product_ids:['foreign-product']},{...base.decision,media_ids:[randomUUID()]},{...base.decision,actions:[{type:'propose_qr',asset_id:'foreign-qr',branch_id:'santa-lucia',quote_id:'fake'}]},{...base.decision,actions:[{type:'delete_customer_data'}]}])assert.throws(()=>validateDecision({...base,decision},packet));});
 assert.equal(validWorkflowUrl('https://another.n8n.cloud/webhook/importados-assistant-turn-v1'),false);
 assert.equal(validWorkflowUrl('https://intranetelrey.app.n8n.cloud/webhook/el-rey-assistant-turn-v1'),false);
});
test('BSUID delivery uses recipient addressing and an uncertain network outcome is finalized once',async()=>{
 const claim={id:randomUUID(),lease_token:randomUUID(),recipient:'CO.synthetic_recipient_001',body:'Respuesta sintética',conversation_id:conversationId,source:'operator'};let metaCalls=0;
 await mocked((url,options)=>{if(url.pathname==='/rest/v1/whatsapp_config')return response([cfg]);if(url.pathname==='/rest/v1/rpc/whatsapp_claim_outbox')return response(claim);if(url.hostname==='graph.facebook.com'){metaCalls++;const payload=JSON.parse(options.body);assert.equal(payload.recipient,claim.recipient);assert.equal('to' in payload,false);throw new Error('Synthetic timeout');}assert.equal(url.pathname,'/rest/v1/rpc/whatsapp_finish_outbox');assert.equal(JSON.parse(options.body).p_status,'uncertain');return response(true);},async()=>{const result=await sendOne(liveEnv);assert.equal(result.reason,'uncertain');assert.equal(metaCalls,1);});
});
test('workflow configuration cannot forward the private secret to a different host',async()=>{
 await mocked(()=>assert.fail('Private secret was forwarded'),async()=>{await assert.rejects(callAssistant({...env,N8N_BOT_WEBHOOK_URL:'https://attacker.n8n.cloud/webhook/importados-assistant-turn-v1'},{}),/Falta conectar/);});
});
test('quiet courtesies create no model call, task or outbound message and preserve meaningful replies',async()=>{
 const state={message:{kind:'text',text:'Gracias, estaré atenta.'},history:[],cart:[],checkout:{}};
 assert.equal(quietAcknowledgement(state),true);
 for(const text of ['Gracias, ¿cuánto vale?','Listo, quiero dos','Ok, el precio es $9.000','Gracias, envíamelo'])assert.equal(quietAcknowledgement({...state,message:{kind:'text',text}}),false);
 assert.equal(quietAcknowledgement({...state,human_resolution:{answer:'Precio confirmado $9.000'}}),false);
 assert.equal(quietAcknowledgement({...state,history:[{role:'assistant',text:'¿Confirmas este pedido?'}]}),false);
 const messageId=randomUUID(),inboxId=randomUUID();
 await mocked((url,options)=>{
  if(url.pathname==='/rest/v1/whatsapp_config')return response([cfg]);
  if(url.pathname==='/rest/v1/rpc/whatsapp_claim_inbox')return response({id:inboxId,conversation_id:conversationId,kind:'message',lease_token:randomUUID()});
  if(url.pathname==='/rest/v1/whatsapp_conversations')return response([{...conversation,manual_paused:false}]);
  if(url.pathname==='/rest/v1/whatsapp_messages')return response(url.searchParams.has('inbox_id')?[{id:messageId}]:[{id:messageId,direction:'inbound',source:'customer',kind:'text',body:state.message.text,created_at:new Date().toISOString()}]);
  if(url.pathname==='/rest/v1/whatsapp_tasks')return response([]);
  const resource=resources(url);if(resource)return resource;
  assert.equal(url.pathname,'/rest/v1/rpc/whatsapp_complete_inbox','A courtesy attempted an external or mutating action');assert.equal(JSON.parse(options.body).p_outcome,'quiet_acknowledgement');return response(true);
 },async()=>assert.equal((await processInbox(liveEnv)).reason,'quiet_acknowledgement'));
});
test('pilot generation allows 25 seconds and slow generation leaves delivery queued for a later invocation',async()=>{
 const messageId=randomUUID(),inboxId=randomUUID();let elapsed=0,metaClaims=0,commits=0,timeout;
 const previousNow=Date.now,previousTimeout=AbortSignal.timeout;
 Date.now=()=>previousNow()+elapsed;AbortSignal.timeout=milliseconds=>{if(milliseconds===25000)timeout=milliseconds;return previousTimeout(milliseconds);};
 try{await mocked((url,options)=>{
  if(url.pathname==='/rest/v1/whatsapp_config')return response([cfg]);
  if(url.pathname==='/rest/v1/rpc/whatsapp_claim_outbox'){metaClaims++;return response(null);}
  if(url.pathname==='/rest/v1/rpc/whatsapp_claim_inbox')return response({id:inboxId,conversation_id:conversationId,kind:'message',lease_token:randomUUID()});
  if(url.pathname==='/rest/v1/whatsapp_conversations')return response([{...conversation,manual_paused:false}]);
  if(url.pathname==='/rest/v1/whatsapp_messages')return response(url.searchParams.has('inbox_id')?[{id:messageId}]:[{id:messageId,direction:'inbound',source:'customer',kind:'text',body:'¿Dónde queda la sede?',created_at:'2026-10-21T00:00:00Z'}]);
  if(url.pathname==='/rest/v1/whatsapp_tasks'||url.pathname==='/rest/v1/branch_knowledge')return response([]);
  const resource=resources(url);if(resource)return resource;
  if(url.href===env.N8N_BOT_WEBHOOK_URL){elapsed=24000;return response(validResponse(JSON.parse(options.body)));}
  if(url.pathname==='/rest/v1/rpc/whatsapp_commit_reply'){commits++;return response({outbox_id:randomUUID()});}
  assert.equal(url.pathname,'/rest/v1/rpc/whatsapp_complete_inbox');return response(true);
 },async()=>{await runWhatsAppJobs(liveEnv);assert.equal(timeout,25000);assert.equal(commits,1);assert.equal(metaClaims,1,'Slow generation must not claim a new Meta delivery near the background cutoff');});}
 finally{Date.now=previousNow;AbortSignal.timeout=previousTimeout;}
});
