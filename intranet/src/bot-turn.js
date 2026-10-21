import {configuration,db,digest,fail,readiness,rpc,uuid,validWorkflowUrl} from './whatsapp-core.js';

const BRANCH_IDS=['santa-lucia','niquia'];
const clean=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function selectedBranch(text){const value=clean(text);if(/^(?:sede\s+)?(?:1|santa lucia|santa-lucia|medellin)$/.test(value))return 'santa-lucia';if(/^(?:sede\s+)?(?:2|niquia|bello)$/.test(value))return 'niquia';return null;}
const controlText=text=>/^(?:yo\s+)?(?:si\s+)?acepto$/.test(clean(text))||!!selectedBranch(text)||/^(hola|buenas|buenos dias|buenas tardes|buenas noches)[!. ]*$/.test(clean(text));
export function quietAcknowledgement(snapshot){
 if(snapshot.message?.kind!=='text'||snapshot.human_resolution||snapshot.cart?.length||snapshot.checkout?.cart?.length||snapshot.checkout?.pending_selection)return false;
 const body=String(snapshot.message.text||'');if(/[?¿]/.test(body))return false;
 const lastReply=[...(snapshot.history||[])].reverse().find(item=>['assistant','operator'].includes(item.role))?.text||'';
 if(/[?¿]/.test(lastReply)&&/comprar|compra|pedido|resumen|confirmas|aceptas/i.test(lastReply))return false;
 const value=clean(body).replace(/[^a-z0-9]+/g,' ').trim();
 const term='(?:ok(?:ay|ey)?|dale+|vale|listo+|perfecto|esta bien|de acuerdo|entendido|bueno|gracias+|muchas gracias+|muchisimas gracias|mil gracias|(?:quedo|estare) (?:atento|atenta|pendiente)|(?:yo )?(?:espero|esperare)|por (?:su|tu) (?:atencion|ayuda)|muy amable)';
 return new RegExp('^'+term+'(?: (?:y |entonces )?'+term+')*$').test(value)||/^(?:\s|👍|🙏|👌|🙌|😊|🙂|❤\uFE0F?)+$/u.test(body)&&!!body.trim();
}
function snapshotPacket(state,{conversationId,controlVersion=0,contextVersion=0,mode='preview',source='synthetic',now=Date.now()}){
 return {contract:'importados.bot.turn.v1',mode,turn_id:crypto.randomUUID(),conversation_id:conversationId||crypto.randomUUID(),control_version:controlVersion,context_version:contextVersion,snapshot:{source,issued_at:new Date(now).toISOString(),expires_at:new Date(now+240000).toISOString(),...state}};
}
async function resources(env,branchId){
 if(branchId&&!BRANCH_IDS.includes(branchId))fail(400,'Sede no disponible.');
 const [branches,knowledge,products,inventory]=await Promise.all([
  db(env,'branches?active=eq.true&select=id,name,address,hours&order=id&limit=10'),
  db(env,'branch_knowledge?active=eq.true&'+(branchId?'or=(branch_id.is.null,branch_id.eq.'+branchId+')':'branch_id=is.null')+'&select=id,topic,content,branch_id,updated_at&order=id&limit=40'),
  branchId?db(env,'products?active=eq.true&select=id,name,description,price,category,updated_at&order=id&limit=100'):[],
  branchId?db(env,'branch_inventory?branch_id=eq.'+branchId+'&select=product_id,quantity,updated_at&order=product_id&limit=100'):[]
 ]);
 const branch=branches.find(item=>item.id===branchId)||null;
 if(branchId&&!branch)fail(400,'Sede no disponible.');
 return {branches,branch,knowledge,products,inventory};
}
function informationFor(data){
 // Never cut a policy, price or number in the middle and present it as a complete fact.
 const records=data.knowledge.filter(item=>item.content.length<=2000).map(item=>({id:item.id,topic:item.topic,text:item.content}));
 if(records.length<40)records.push({id:'importados-branches',topic:'Sedes confirmadas',text:data.branches.map(branch=>[branch.name,branch.address,branch.hours?'Horario físico confirmado: '+branch.hours:'Horario físico pendiente de confirmar.'].join('. ')).join('\n')});
 if(records.length<40)records.push({id:'importados-commerce-limits',topic:'Confirmación humana de compras',text:'La existencia, reserva, costo de domicilio, cotización final y aprobación de pagos requieren confirmación del equipo. No hay reserva automática ni pedido creado desde este asistente. No afirmar que un producto está disponible sin confirmación vigente.'});
 for(const branch of data.branches.filter(item=>item.hours&&item.id===data.branch?.id))if(records.length<40)records.push({id:'hours-'+branch.id,topic:'Horario físico '+branch.name,text:branch.hours});
 return records.slice(0,40);
}
export async function syntheticTurn(env,{text,branch_id}){
 if(typeof text!=='string'||text.trim().length<1||text.length>4000)fail(400,'Escribe una consulta de hasta 4.000 caracteres.');
 const data=await resources(env,branch_id||'santa-lucia');
 // No customer history, phone, profile or persisted message is read for a simulation.
 const state={control:{manual_paused:false,closed:false,consent:'granted',allow_ai:true},branch:data.branch?{id:data.branch.id,name:data.branch.name}:null,
  message:{id:crypto.randomUUID(),text:text.trim(),kind:'text'},history:[],products:[],information:informationFor(data),qr_assets:[],last_options:[],cart:[],operator_instructions:[],payment:{ready_for_qr:false,quote_id:''},checkout:{},order:null,pending_tasks:[],confirmed_answers:[]};
 const packet=snapshotPacket(state,{mode:'test'});packet.context_fingerprint=await digest(state);return packet;
}
export async function conversationTurn(env,conversationId){
 const [conversation]=await db(env,'whatsapp_conversations?id=eq.'+conversationId+'&select=*');
 if(!conversation)fail(404,'Conversación no encontrada.');
 const [messages,tasks,data]=await Promise.all([
  db(env,'whatsapp_messages?conversation_id=eq.'+conversationId+'&created_at=gte.'+encodeURIComponent(conversation.session_started_at)+'&select=id,direction,source,kind,body,attachment,created_at&order=created_at.desc,id.desc&limit=60'),
  db(env,'whatsapp_tasks?conversation_id=eq.'+conversationId+'&created_at=gte.'+encodeURIComponent(conversation.session_started_at)+'&select=id,branch_id,kind,question,status,answer,source_message_id,created_at,updated_at&order=updated_at.desc,id&limit=100'),
  resources(env,conversation.branch_id)
 ]);
 const latest=messages.find(item=>item.direction==='inbound');
 if(!latest)fail(409,'La conversación no tiene un mensaje entrante.');
 const state={control:{manual_paused:conversation.manual_paused,closed:conversation.status==='closed',consent:conversation.consent_status,allow_ai:true},
  branch:data.branch?{id:data.branch.id,name:data.branch.name}:null,message:{id:latest.id,text:latest.body,kind:latest.kind,...(latest.attachment?{attachment:{...latest.attachment,message_id:latest.id,persisted:true}}:{})},
  history:messages.slice().reverse().map(message=>({role:message.source==='customer'?'customer':message.source==='operator'?'operator':'assistant',text:message.body.length<=2000?message.body:'[Mensaje extenso conservado completo en la intranet; requiere revisión del equipo.]'})),
  // Existing manual inventory has no count-valid-until or reservation semantics. Catalog
  // metadata is deliberately withheld from commercial tools until that state exists.
  products:[],information:informationFor(data),qr_assets:[],last_options:[],cart:[],operator_instructions:[],payment:{ready_for_qr:false,quote_id:''},checkout:{},order:null,
  confirmed_answers:tasks.filter(task=>task.status==='resolved'&&task.branch_id===conversation.branch_id&&task.question.length<=800&&task.answer.length<=1800).slice(0,10).map(task=>({id:task.id,question:task.question,answer:task.answer})),
  pending_tasks:tasks.filter(task=>task.status==='pending'&&task.branch_id===conversation.branch_id&&task.question.length<=800).slice(0,10).map(task=>({id:task.id,status:'pending',question:task.question}))};
 const initial=messages.slice().reverse().find(message=>message.direction==='inbound'&&message.kind==='text'&&message.body.trim()&&!controlText(message.body));
 if(controlText(latest.body)&&initial&&initial.body.length<=2000)state.onboarding_request=initial.body;
 const packet=snapshotPacket(state,{conversationId,controlVersion:conversation.control_version,contextVersion:conversation.context_version,mode:'pilot',source:'intranet'});
 // Material resource versions participate in the fingerprint, including data withheld
 // from AI. An operator catalog edit therefore invalidates an in-flight proposal.
 packet.context_fingerprint=await digest({state,products:data.products,inventory:data.inventory,knowledge:data.knowledge,control:conversation.control_version,context:conversation.context_version});
 return {conversation,packet,latest,tasks};
}
export function validateDecision(data,packet){
 if(!data||data.contract!=='importados.bot.decision.v1'||data.status!=='decision_ready'||data.mode!==packet.mode||data.source!==packet.snapshot.source
 ||data.turn_id!==packet.turn_id||data.conversation_id!==packet.conversation_id||data.expected_control_version!==packet.control_version
 ||data.expected_context_version!==packet.context_version||data.expected_context_fingerprint!==packet.context_fingerprint
 ||data.send_allowed!==false||data.requires_commit!==true||!Array.isArray(data.mutations_executed)||data.mutations_executed.length
 ||!Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=Date.now()||Date.parse(data.expires_at)>Date.parse(packet.snapshot.expires_at))fail(502,'El motor no devolvió una propuesta válida.');
 const decision=data.decision;
 if(!decision||!['information','discovery','quote','qr','handoff','order_status','clarification','close','checkout'].includes(decision.intent)
 ||typeof decision.reply_text!=='string'||decision.reply_text.length>4000||!Array.isArray(decision.actions)||decision.actions.length>5
 ||!Array.isArray(decision.offered_product_ids)||decision.offered_product_ids.length>10||!Array.isArray(decision.media_ids)||decision.media_ids.length>2)fail(502,'El motor devolvió una decisión inválida.');
 for(const action of decision.actions){
  if(action.type==='propose_human_task'){
   if(!['human_request','missing_information','stock_check','payment_review','pqrs'].includes(action.reason)||typeof action.question!=='string'||!action.question.trim()||action.question.length>4000||action.related_message_id!==packet.snapshot.message.id)fail(502,'El motor devolvió un pendiente inválido.');
  }else if(!['propose_quote','propose_qr'].includes(action.type))fail(502,'El motor propuso una acción no disponible.');
 }
 const products=new Map(packet.snapshot.products.map(product=>[product.id,product]));
 const validProduct=id=>products.has(id)&&products.get(id).branch_id===packet.snapshot.branch?.id;
 if(decision.offered_product_ids.some(id=>!validProduct(id))||new Set(decision.offered_product_ids).size!==decision.offered_product_ids.length)fail(502,'El motor propuso productos fuera del contexto autorizado.');
 const media=new Set((packet.snapshot.product_images||[]).map(asset=>asset.id));
 if(decision.media_ids.some(id=>!media.has(id)))fail(502,'El motor propuso imágenes fuera del contexto autorizado.');
 if(decision.quote!==null){
  const quote=decision.quote;
  if(!quote||!Array.isArray(quote.items)||quote.items.length<1||quote.items.length>10||quote.delivery_included!==false||quote.reserved!==false||quote.order_created!==false)fail(502,'Cotización no autorizada.');
  let total=0;
  for(const item of quote.items){const product=products.get(item.product_id);if(!validProduct(item.product_id)||!product.stock_verified||Date.parse(product.stock_valid_until)<=Date.now()||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>product.available_quantity||item.unit_price_cop!==product.price_cop||item.line_total_cop!==item.quantity*product.price_cop)fail(502,'Cotización no verificada.');total+=item.line_total_cop;}
  if(quote.subtotal_cop!==total)fail(502,'Total de cotización inválido.');
 }
 for(const action of decision.actions){
  if(action.type==='propose_quote'&&(!Array.isArray(action.items)||!action.items.length||action.items.some(item=>!validProduct(item.product_id)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>99)))fail(502,'Referencias de cotización inválidas.');
  if(action.type==='propose_qr'&&(!packet.snapshot.payment.ready_for_qr||action.quote_id!==packet.snapshot.payment.quote_id||action.branch_id!==packet.snapshot.branch?.id||!packet.snapshot.qr_assets.some(asset=>asset.id===action.asset_id&&asset.active&&asset.branch_id===action.branch_id)))fail(502,'QR fuera de la cotización autorizada.');
 }
 if(decision.confirmed_item&&!packet.snapshot.confirmed_answers?.some(answer=>answer.id===decision.confirmed_item.source_task_id&&answer.answer.includes(decision.confirmed_item.source_excerpt)))fail(502,'Selección sin una fuente humana válida.');
 if(decision.accept_summary||decision.cancel_cart)fail(502,'La compra requiere gestión del equipo.');
 return data;
}
export async function callAssistant(env,packet){
 if(!env.N8N_WEBHOOK_SECRET||!validWorkflowUrl(env.N8N_BOT_WEBHOOK_URL))fail(503,'Falta conectar el motor privado de Importados.');
 let result;try{result=await fetch(env.N8N_BOT_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json','x-importados-webhook-secret':env.N8N_WEBHOOK_SECRET},body:JSON.stringify(packet),signal:AbortSignal.timeout(packet.mode==='pilot'?25000:100000)});}catch{fail(503,'El motor no respondió a tiempo. No se envió ningún mensaje.');}
 if(!result.ok)fail(503,'El motor privado no está disponible. No se envió ningún mensaje.');
 const raw=await result.text();if(raw.length>65536)fail(502,'La propuesta del motor es demasiado extensa.');
 let decision;try{decision=JSON.parse(raw);}catch{fail(502,'No pudimos leer la propuesta del motor.');}
 return validateDecision(decision,packet);
}
async function commitReply(env,context,text,purpose,task=null){
 return rpc(env,'whatsapp_commit_reply',{p_conversation:context.conversation.id,p_message:context.latest.id,p_control:context.conversation.control_version,p_context:context.conversation.context_version,p_request:context.requestId||context.latest.id,p_body:text,p_purpose:purpose,p_task:task});
}
async function applyResolution(context,claim){
 const task=context.tasks.find(item=>item.id===claim.event?.task_id&&item.status==='resolved'&&item.branch_id===context.conversation.branch_id);
 if(!task||!task.answer?.trim()||!task.source_message_id||task.question.length>800||task.answer.length>1800)fail(409,'Esta respuesta necesita revisión y envío manual para conservar todos los datos.');
 const resolution={task_id:task.id,inbound_message_id:task.source_message_id,question:task.question,answer:task.answer};
 context.packet.context_fingerprint=await digest([context.packet.context_fingerprint,resolution]);
 context.packet.snapshot.human_resolution=resolution;
 return context;
}
export async function processInbox(env){
 const cfg=await configuration(env),state=readiness(env,cfg);
 if(!state.ai||!state.outbound)return {processed:false,reason:'disabled'};
 const claim=await rpc(env,'whatsapp_claim_inbox');if(!claim)return {processed:false,reason:'empty'};
 const finish=outcome=>rpc(env,'whatsapp_complete_inbox',{p_id:claim.id,p_lease:claim.lease_token,p_outcome:outcome});
 let context;
 try{
  context=await conversationTurn(env,claim.conversation_id);const c=context.conversation;context.requestId=claim.id;
  if(claim.kind==='human_resolution')await applyResolution(context,claim);
  else{const [message]=await db(env,'whatsapp_messages?inbox_id=eq.'+claim.id+'&select=id&limit=1');
   if(message?.id!==context.latest.id){await finish('superseded');return {processed:true};}}
  if(c.manual_paused||c.status==='closed'||c.consent_status==='revoked'||Date.parse(c.last_customer_at)<=Date.now()-86400000){await finish('human_or_privacy_guard');return {processed:true};}
  if(context.latest.body.length>4000)fail(409,'La consulta requiere revisión del equipo para conservar todo su contenido.');
  if(c.consent_status!=='granted'||c.consent_version!==cfg.privacy_version){
   const notices=await db(env,'whatsapp_outbox?conversation_id=eq.'+c.id+'&purpose=eq.privacy_notice&status=in.(queued,sending,sent,delivered,read,uncertain)&select=id&limit=1');
   if(!notices.length||c.consent_version!==cfg.privacy_version)await commitReply(env,context,'Hola, somos Tiendas Importados. GRUPO EMPRESARIAL ORIENTE SAS tratará los datos que compartas para atender consultas, compras y solicitudes por WhatsApp. Consulta las finalidades, tus derechos y cómo contactarnos en '+cfg.privacy_url+'. Si estás de acuerdo, responde YO ACEPTO. Puedes retirar la autorización escribiendo NO AUTORIZO.','privacy_notice');
   await finish('awaiting_consent');return {processed:true};
  }
  const selection=selectedBranch(context.latest.body);
  if(claim.kind!=='human_resolution'&&selection&&selection!==c.branch_id){await rpc(env,'whatsapp_select_branch',{p_conversation:c.id,p_message:context.latest.id,p_context:c.context_version,p_branch:selection});context=await conversationTurn(env,c.id);context.requestId=claim.id;}
  if(!context.conversation.branch_id){
   await commitReply(env,context,'¿En qué sede quieres consultar?\n1. Santa Lucía · Medellín\n2. Niquía · Bello','branch_selection');await finish('awaiting_branch');return {processed:true};
  }
  if(claim.kind!=='human_resolution'&&context.latest.kind!=='text'&&!context.latest.body){
   await commitReply(env,context,'Tu mensaje incluye un archivo. Cuéntanos por escrito qué necesitas para que el equipo pueda revisar la consulta.','reply',{kind:'missing_information',question:'El mensaje incluye un archivo de WhatsApp; solo se conserva su referencia de Meta. Confirmar por escrito la consulta del cliente.'});await finish('attachment_for_human');return {processed:true};
  }
  if(quietAcknowledgement(context.packet.snapshot)){await finish('quiet_acknowledgement');return {processed:true,reason:'quiet_acknowledgement'};}
  const proposal=await callAssistant(env,context.packet);
  const fresh=await conversationTurn(env,c.id);if(claim.kind==='human_resolution')await applyResolution(fresh,claim);
  if(fresh.packet.context_fingerprint!==context.packet.context_fingerprint){await finish('context_changed');return {processed:true};}
  const decision=proposal.decision;
  const commercial=['quote','qr','checkout','order_status'].includes(decision.intent)||decision.quote||decision.offered_product_ids.length||decision.media_ids.length||decision.actions.some(action=>action.type!=='propose_human_task')||decision.confirmed_item||decision.accept_summary||decision.cancel_cart;
  const taskAction=decision.actions.find(action=>action.type==='propose_human_task');
  if(commercial){
   await commitReply(env,context,'El equipo de la sede debe confirmar la disponibilidad y las condiciones de esta consulta. Dejamos tu solicitud pendiente de revisión.','reply',{kind:decision.intent==='qr'||decision.intent==='checkout'?'payment_review':'stock_check',question:context.packet.snapshot.onboarding_request||context.latest.body||'Revisar solicitud comercial del cliente.'});
  }else if(decision.reply_text.trim()){
   await commitReply(env,context,decision.reply_text,'reply',taskAction?{kind:taskAction.reason,question:taskAction.question}:null);
  }
  await finish('proposal_committed');return {processed:true};
 }catch{
  // No replay after an uncertain generation/commit. The durable inbound remains visible.
  if(context?.latest?.id)await rpc(env,'whatsapp_record_issue',{p_conversation:claim.conversation_id,p_message:context.latest.id,p_inbox:claim.id});
  await finish('needs_operator_review');return {processed:true,reason:'needs_operator_review'};
 }
}

export async function sendOne(env){
 const cfg=await configuration(env);if(!readiness(env,cfg).outbound)return {sent:false,reason:'disabled'};
 const claim=await rpc(env,'whatsapp_claim_outbox');if(!claim)return {sent:false,reason:'empty'};
 if(!uuid(claim.id)||!uuid(claim.lease_token)||typeof claim.recipient!=='string')fail(503,'Cola de envío inválida.');
 const isPhone=/^[1-9]\d{7,14}$/.test(claim.recipient),isBsuid=/^[A-Z]{2}\.[A-Za-z0-9._:-]{6,253}$/.test(claim.recipient);
 if(!isPhone&&!isBsuid)fail(503,'Identidad de envío inválida.');
 const finish=(status,metaId=null,error=null)=>rpc(env,'whatsapp_finish_outbox',{p_id:claim.id,p_lease:claim.lease_token,p_status:status,p_meta_id:metaId,p_error:error});
 // The claim revalidates the latest manual/privacy/window guards in one transaction.
 // An HTTP error with a structured Meta rejection is definite; network/timeouts and
 // malformed successes are uncertain and must never be automatically retried.
 let response;
 try{
  response=await fetch('https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION+'/'+env.WHATSAPP_PHONE_NUMBER_ID+'/messages',{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',...(isPhone?{to:claim.recipient}:{recipient:claim.recipient}),type:'text',text:{preview_url:false,body:claim.body}}),signal:AbortSignal.timeout(15000)});
 }catch{await finish('uncertain',null,'network_outcome_unknown');return {sent:false,reason:'uncertain'};}
 let result;try{result=await response.json();}catch{await finish('uncertain',null,'provider_outcome_unknown');return {sent:false,reason:'uncertain'};}
 if(!response.ok){const definite=typeof result?.error?.code==='number'&&response.status>=400&&response.status<500;await finish(definite?'failed':'uncertain',null,definite?'provider_rejected':'provider_outcome_unknown');return {sent:false,reason:definite?'failed':'uncertain'};}
 const metaId=result?.messages?.[0]?.id;
 if(typeof metaId!=='string'||!metaId||metaId.length>256){await finish('uncertain',null,'missing_provider_receipt');return {sent:false,reason:'uncertain'};}
 await finish('sent',metaId);return {sent:true};
}
export async function runWhatsAppJobs(env){
 if(env.WHATSAPP_OUTBOUND_ENABLED!=='true')return;
 const started=Date.now();
 // Existing durable deliveries take priority. Slow generation can leave its new
 // reply queued for the next invocation instead of starting Meta near the 30s cutoff.
 const pending=await sendOne(env);if(pending.sent||pending.reason!=='empty')return;
 await processInbox(env);
 if(Date.now()-started<11000)await sendOne(env);
}
