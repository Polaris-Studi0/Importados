import {canSend,configuration,db,digest,fail,readiness,readJson,reply,scopedConversation,staff,uuid,validWorkflowUrl,WhatsAppError,NUMBER,rpc} from './whatsapp-core.js';
import {ingress} from './whatsapp-ingress.js';
import {callAssistant,runWhatsAppJobs,sendOne,syntheticTurn} from './bot-turn.js';

export {runWhatsAppJobs};
const CONVERSATION_FIELDS='id,branch_id,customer_name,customer_phone,customer_bsuid,status,manual_paused,consent_status,last_customer_at,last_message_at,last_message_preview,updated_at,control_version,context_version';
const MESSAGE_FIELDS='id,direction,source,kind,body,attachment,status,created_at,meta_message_id';
const TASK_FIELDS='id,conversation_id,branch_id,kind,question,status,answer,source_message_id,created_at,updated_at,resolved_at';
const background=(ctx,work)=>{if(ctx?.waitUntil)ctx.waitUntil(work().catch(()=>{}));};

async function status(env){
 const cfg=await configuration(env),state=readiness(env,cfg);
 const tasks=await db(env,'whatsapp_tasks?status=eq.pending&select=id&limit=1001');
 const blockers=[];
 if(!state.identifiers)blockers.push('El número real aún debe quedar registrado y vinculado a la app de Importados en Meta.');
 if(!state.credentials)blockers.push('Faltan credenciales propias y verificación del canal de Meta.');
 if(!state.privacy)blockers.push('Falta la política pública de privacidad de WhatsApp y su versión.');
 if(!state.activation)blockers.push('La apertura de atención pública no está configurada.');
 if(!state.graph)blockers.push('Falta confirmar la versión de la API de Meta.');
 if(!state.ingress)blockers.push('La recepción pública permanece desactivada.');
 if(!state.ai)blockers.push('La atención automática permanece desactivada.');
 if(!state.outbound)blockers.push('Los envíos de WhatsApp permanecen desactivados.');
 const workflowConfigured=!!env.N8N_WEBHOOK_SECRET&&validWorkflowUrl(env.N8N_BOT_WEBHOOK_URL);
 return {ok:true,channel:{enabled:state.ingress,ready:state.ready,number:NUMBER,reason:state.ready?'Configuración preparada; comprobar recepción y entrega real en Meta.':blockers[0]},
  automation:{enabled:state.ai,ready:state.ai,configured:workflowConfigured,send_enabled:state.outbound},capabilities:{manual_send:state.outbound,preview:workflowConfigured},pending_count:Math.min(tasks.length,1000),pending_count_truncated:tasks.length>1000,
  configuration:{identifiers:state.identifiers,credentials:state.credentials,privacy:state.privacy,activation:state.activation,graph:state.graph},blockers,
  limitations:['Compras, disponibilidad, reservas, domicilio y pagos requieren confirmación humana.','La simulación no prueba entrega por WhatsApp.','Los envíos con resultado incierto no se reintentan automáticamente.']};
}
async function handle(request,env,origin,ctx){
 const path=new URL(request.url).pathname;
 if(path==='/api/whatsapp/webhook')return ingress(request,env,()=>background(ctx,()=>runWhatsAppJobs(env)));
 const actor=await staff(request,env,path==='/api/whatsapp/status'||path==='/api/whatsapp/preview');
 if(path==='/api/whatsapp/status'&&request.method==='GET')return reply(await status(env),200,origin);
 if(path==='/api/whatsapp/preview'&&request.method==='POST'){
  if(env.PUBLIC_LIMITER){const limited=await env.PUBLIC_LIMITER.limit({key:'whatsapp-preview:'+await digest(actor.id)});if(!limited.success)fail(429,'Espera un minuto antes de volver a simular una respuesta.');}
  const body=await readJson(request);const packet=await syntheticTurn(env,{text:body.text,branch_id:body.branch_id});
  const preview=await callAssistant(env,packet);
  return reply({ok:true,preview,send_allowed:false,limitations:['Simulación con consulta sintética; no guarda conversaciones ni envía WhatsApp.','Existencias, pedidos, QR y pagos requieren validación del equipo.']},200,origin);
 }
 if(path==='/api/whatsapp/conversations'&&request.method==='GET'){
  const rows=await db(env,'whatsapp_conversations?'+(actor.role==='admin'?'':'branch_id=eq.'+encodeURIComponent(actor.branch_id)+'&')+'select='+CONVERSATION_FIELDS+'&order=updated_at.desc,id&limit=101');
  return reply({conversations:rows.slice(0,100),limits:{conversations:100,truncated:rows.length>100}},200,origin);
 }
 if(path==='/api/whatsapp/tasks'&&request.method==='GET'){
  // Scope through the current parent conversation, not a stale task branch snapshot.
  const tasks=await db(env,'whatsapp_tasks?select='+TASK_FIELDS+',whatsapp_conversations!inner(branch_id)&'+(actor.role==='admin'?'':'whatsapp_conversations.branch_id=eq.'+encodeURIComponent(actor.branch_id)+'&')+'status=eq.pending&order=created_at.desc,id&limit=101');
  return reply({tasks:tasks.slice(0,100).map(({whatsapp_conversations:_parent,...task})=>task),limits:{tasks:100,truncated:tasks.length>100}},200,origin);
 }
 const match=path.match(/^\/api\/whatsapp\/conversations\/([^/]+)(\/actions)?$/);
 if(!match)fail(404,'Ruta de WhatsApp no encontrada.');
 const conversation=await scopedConversation(env,actor,match[1]);
 if(!match[2]&&request.method==='GET'){
  const [messages,tasks,cfg,outbox]=await Promise.all([
   db(env,'whatsapp_messages?conversation_id=eq.'+conversation.id+'&select='+MESSAGE_FIELDS+'&order=created_at.desc,id.desc&limit=101'),
   db(env,'whatsapp_tasks?conversation_id=eq.'+conversation.id+'&select='+TASK_FIELDS+'&order=created_at.desc,id&limit=101'),
   configuration(env),
   db(env,'whatsapp_outbox?conversation_id=eq.'+conversation.id+'&message_id=is.null&select=id,source,body,status,created_at,meta_message_id,last_error&order=created_at.desc&limit=100')
  ]);
  const history=[...messages,...outbox.map(item=>({...item,direction:'outbound',kind:'text',delivery_pending:true}))].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  return reply({conversation,messages:history.slice(0,100).reverse(),outbox,tasks:tasks.slice(0,100),can_send:canSend(env,cfg,conversation),limits:{messages:100,tasks:100,messages_truncated:history.length>100,tasks_truncated:tasks.length>100}},200,origin);
 }
 if(match[2]&&request.method==='POST'){
  const body=await readJson(request);
  if(!['pause','resume','close','assign_branch','resolve_task','send'].includes(body.action)||!uuid(body.request_id)||!Number.isSafeInteger(body.expected_control_version)||body.expected_control_version<0)fail(400,'Revisa la acción y actualiza la conversación.');
  if(body.action==='assign_branch'&&actor.role!=='admin')fail(403,'Solo administración puede cambiar la sede.');
  if(body.action==='send'&&!canSend(env,await configuration(env),conversation))fail(409,'El envío requiere canal activo, control manual, autorización y ventana de 24 horas vigente.');
  const payload=body.action==='assign_branch'?{branch_id:body.branch_id}:body.action==='resolve_task'?{task_id:body.task_id,answer:body.answer}:body.action==='send'?{text:body.text}:{};
  const result=await rpc(env,'whatsapp_staff_action',{p_actor:actor.id,p_conversation:conversation.id,p_action:body.action,p_request:body.request_id,p_expected:body.expected_control_version,p_payload:payload});
  if(body.action==='send')background(ctx,()=>sendOne(env));
  if(['resume','resolve_task'].includes(body.action))background(ctx,()=>runWhatsAppJobs(env));
  return reply(result,200,origin);
 }
 fail(405,'Método no permitido.');
}
export async function handleWhatsApp(request,env,origin,ctx){
 try{return await handle(request,env,origin,ctx);}
 catch(error){return reply({ok:false,message:error instanceof WhatsAppError?error.message:'No pudimos completar la operación de WhatsApp. Intenta nuevamente.'},error instanceof WhatsAppError?error.status:503,origin);}
}
