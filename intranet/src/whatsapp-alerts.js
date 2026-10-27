import {db,rpc,readiness,configuration} from './whatsapp-core.js';
const TEMPLATE='importados_consulta_pendiente_v1';
export async function sendOperatorAlert(env){
 if(!/^[1-9]\d{7,14}$/.test(env.WHATSAPP_OPERATOR_PHONE||'')||!readiness(env,await configuration(env)).outbound)return {sent:false,reason:'disabled'};
 const queued=await db(env,'whatsapp_operator_alerts?status=eq.queued&select=id&limit=1');if(!queued.length)return {sent:false,reason:'empty'};
 const recent=await db(env,'whatsapp_conversations?customer_phone=eq.'+env.WHATSAPP_OPERATOR_PHONE+'&select=last_customer_at&order=last_customer_at.desc&limit=1');
 const windowOpen=Date.parse(recent[0]?.last_customer_at)>Date.now()-(24*60-5)*60000;
 let templateReady=false;
 if(!windowOpen){
  const r=await fetch('https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION+'/'+env.WHATSAPP_WABA_ID+'/message_templates?name='+TEMPLATE+'&fields=name,status,language&limit=10',{headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN},signal:AbortSignal.timeout(6000)});
  if(r.ok){const templates=await r.json();templateReady=templates.data?.some(t=>t.name===TEMPLATE&&t.status==='APPROVED'&&t.language==='es')===true;}
 }
 const claim=await rpc(env,'whatsapp_claim_operator_alert',{p_window:windowOpen,p_template:templateReady});if(!claim)return {sent:false,reason:'no_ready_alert'};
 const finish=(status,id=null,error=null)=>rpc(env,'whatsapp_finish_operator_alert',{p_id:claim.id,p_lease:claim.lease_token,p_status:status,p_meta_id:id,p_error:error});
 const branch=claim.branch_id==='santa-lucia'?'Santa Lucía':claim.branch_id==='niquia'?'Niquía':'sin sede asignada';
 const body={messaging_product:'whatsapp',to:env.WHATSAPP_OPERATOR_PHONE,...(claim.use_template?{type:'template',template:{name:TEMPLATE,language:{code:'es'},components:[{type:'body',parameters:[{type:'text',text:branch}]}]}}:{type:'text',text:{preview_url:false,body:'Importados · Consulta pendiente en '+branch+'.\nEntra a la intranet para revisar y responder:\nhttps://intranet.tiendasimportados.com/?whatsapp='+claim.conversation_id}})};
 let response,result;
 try{response=await fetch('https://graph.facebook.com/'+env.WHATSAPP_GRAPH_VERSION+'/'+env.WHATSAPP_PHONE_NUMBER_ID+'/messages',{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});result=await response.json();}catch{await finish('uncertain',null,'network_outcome_unknown');return {sent:false,reason:'uncertain'};}
 if(!response.ok){const definite=response.status>=400&&response.status<500&&typeof result.error?.code==='number';await finish(definite?'failed':'uncertain',null,'meta_'+(result.error?.code||response.status));return {sent:false,reason:'provider_error'};}
 const id=result.messages?.[0]?.id;if(typeof id!=='string'||!id){await finish('uncertain',null,'missing_provider_receipt');return {sent:false,reason:'uncertain'};}
 await finish('sent',id);return {sent:true};
}
