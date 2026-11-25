import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {serviceOpen,branchFromText,asksBranches,directConversationReply,commerceSnapshot} from '../src/bot-commerce.js';
import {checkoutReply} from '../src/bot-checkout.js';
import {quietAcknowledgement} from '../src/bot-turn.js';
import {naturalResolutionText} from '../src/bot-conversation.js';
import {intakeRequest} from '../src/bot-intake.js';
const guardCode=await readFile(new URL('../n8n/decision-guard.js',import.meta.url),'utf8');
const guard=new Function('$','$input',guardCode);
const context=()=>({expires_at:new Date(Date.now()+60000).toISOString(),mode:'test',source:'synthetic',conversation_id:randomUUID(),turn_id:randomUUID(),control_version:1,context_version:1,branch:{id:'niquia',name:'Niquía · Bello'},message:{id:randomUUID(),kind:'text',text:'¿Tienen árboles de Navidad y cuánto cuestan?'},history:[],products:[],product_images:[],confirmed_answers:[],pending_tasks:[],information:[],checkout:{},payment:{},qr_assets:[]});
const decision=()=>({intent:'discovery',reply_text:'¿Quieres que consulte?',product_ids:[],quote_items:[],qr_asset_id:'',human_reason:'',human_question:'',human_task_id:'',human_priority:'normal',checkout:{},confirmed_item:null,accept_summary:false,cancel_cart:false,media_ids:[]});
function run(c,d,tools=[]){return guard(()=>({first:()=>({json:{context:c}})}),{first:()=>({json:{output:d,intermediateSteps:tools.map(tool=>({action:{tool}}))}})})[0].json.response;}
test('Bogotá attention and delivery boundaries are independent and closing is exclusive',()=>{
 for(const [local,a,d] of [['08:59',false,false],['09:00',true,true],['18:59',true,true],['19:00',true,false],['19:59',true,false],['20:00',false,false]])assert.deepEqual(serviceOpen(Date.parse('2026-10-29T'+local+':00-05:00')),{attention:a,delivery:d});
});
test('natural branch names and branch-list questions do not expose internal codes',()=>{
 assert.equal(branchFromText('En la de Niquía porfa'),'niquia');assert.equal(branchFromText('Santa Lucía'),'santa-lucia');assert.equal(asksBranches('Muéstrame todas las sedes'),true);assert.equal(asksBranches('¿La sede tiene árboles?'),false);
});
test('an empty search creates one concrete request without another permission question',()=>{
 const c=context(),r=run(c,decision(),['buscar_promociones']);assert.equal(r.status,'decision_ready');assert.equal(r.decision.intent,'handoff');assert.match(r.decision.actions[0].question,/árboles/);assert.doesNotMatch(r.decision.reply_text,/quieres|tamaños|material/i);
});
test('a brief approved price can anchor the named item without an unnecessary tool round trip',()=>{
 const c=context(),id=randomUUID();c.message.text='Dámelo, paso por él y pago en efectivo';c.confirmed_answers=[{id,question:'¿Tienen árbol de Navidad y cuánto vale?',answer:'Sí. A $100.000.'}];
 const d={...decision(),intent:'checkout',confirmed_item:{source_task_id:id,source_excerpt:'Sí. A $100.000.',name:'árbol de Navidad',variant:'',unit_price_cop:100000,quantity:1}};
 const r=run(c,d);assert.equal(r.status,'decision_ready');assert.equal(r.decision.confirmed_item.unit_price_cop,100000);assert.equal(r.decision.confirmed_item.product_id,undefined);
 assert.equal(run(c,{...d,confirmed_item:{...d.confirmed_item,unit_price_cop:10000}}).status,'unverified_confirmed_item');
});
test('new details preserve the original general case and elevate priority without an invented questionnaire',()=>{
 const c=context(),id=randomUUID();c.pending_tasks=[{id,kind:'missing_information',question:'Confirmar disponibilidad y precio del árbol.',status:'pending'}];c.message.text='¿Otros dos días más? Lo necesito para mañana.';
 const d={...decision(),intent:'handoff',human_reason:'missing_information',human_question:'Indicar impuestos, despacho inmediato y opciones no solicitadas.',human_task_id:id,human_priority:'high'};
 const r=run(c,d);assert.equal(r.decision.actions[0].task_id,id);assert.match(r.decision.actions[0].question,/disponibilidad y precio/);assert.match(r.decision.actions[0].question,/mañana/);assert.doesNotMatch(r.decision.actions[0].question,/impuestos/);assert.equal(r.decision.actions[0].priority,'high');
});
test('batch checkout parses all labelled data, preserving recipient and apartment',()=>{
 const c=context();c.message.text='Nombre para la compra: Ana\nRecibe: Luisa Pérez\nTeléfono: 3000000000\nDirección: Carrera 1 # 2-3, apto 405\nBarrio: Centro, Bello';c.checkout={stage:'collecting',fulfillment_type:'delivery',pending_selection:{name:'árbol'}};
 const r=checkoutReply({snapshot:c});assert.equal(r.checkout.customer_name,'Ana');assert.equal(r.checkout.recipient_name,'Luisa Pérez');assert.equal(r.checkout.recipient_phone,'3000000000');assert.match(r.checkout.delivery_address,/apto 405/);assert.equal(r.checkout.delivery_zone,'Centro, Bello');
});
test('waiting acknowledgements remain silent during review, but questions and summary acceptance remain active',()=>{
 const c=context();c.message.text='Okey yo espero';c.checkout={stage:'payment_review',cart:[{}]};assert.equal(quietAcknowledgement(c),true);c.message.text='Okey, ¿cuándo llega?';assert.equal(quietAcknowledgement(c),false);
 c.message.text='Sí';c.checkout={stage:'summary',summary_delivered:true,cart:[{}]};assert.equal(directConversationReply({snapshot:c}).accept_summary,true);
});
test('private catalog context subtracts holds, excludes unsupported images and preserves delivered option order',()=>{
 const ids=[randomUUID(),randomUUID()];const data={conversation:{branch_id:'niquia'},products:ids.map((id,i)=>({id,name:'Producto '+i,price:10000,active:true,storage_path:id+(i?'.webp':'.jpg')})),inventory:ids.map(product_id=>({product_id,quantity:2,valid_until:new Date(Date.now()+10000).toISOString()})),holds:[{product_id:ids[0],quantity:1}],checkout:{state:{offered_ids:ids}},offered_delivered:true,branches:[],qrs:[]};const s=commerceSnapshot(data);assert.equal(s.products[0].available_quantity,1);assert.deepEqual(s.last_options,ids);assert.equal(s.product_images.length,1);
});
test('approved negatives and amounts cannot be replaced by a contradictory or incomplete paraphrase',()=>{
 assert.equal(naturalResolutionText('Sí tenemos cargadores.','No tenemos cargadores.'),'No tenemos cargadores.');assert.equal(naturalResolutionText('Cuesta $10.000.','Cuesta $100.000.'),'Cuesta $100.000.');
});
test('the original product enquiry survives consent, punctuation and choosing a branch',()=>{
 const history=[{role:'customer',text:'Hola, ¿tienen árboles de Navidad y cuánto cuestan?'},{role:'assistant',text:'Hola, soy el asistente virtual de Tiendas Importados. Responde SÍ o ACEPTO.'},{role:'customer',text:'Sí, acepto.'},{role:'assistant',text:'¿En qué sede te atendemos?\n1. Santa Lucía\n2. Niquía'},{role:'customer',text:'En la de Niquía porfa'}];
 assert.match(intakeRequest(history,history.at(-1).text),/árboles de Navidad/);
 assert.equal(intakeRequest([...history,{role:'assistant',text:'Tenemos árboles a $100.000.'},{role:'customer',text:'Sí'}],'Sí'),'');
});

test('QR can echo the accepted cart but cannot silently change its quantity',()=>{
 const c=context(),id=randomUUID(),qr=randomUUID();c.message.text='Pásame el QR';c.cart=[{product_id:id,quantity:1}];c.products=[{id,branch_id:'niquia',name:'Artículo',active:true,stock_verified:true,stock_valid_until:new Date(Date.now()+10000).toISOString(),available_quantity:2,price_cop:10000}];c.payment={ready_for_qr:true,quote_id:'accepted-synthetic'};c.qr_assets=[{id:qr,branch_id:'niquia',active:true}];
 const d={...decision(),intent:'qr',product_ids:[id],quote_items:[{product_id:id,quantity:1}],qr_asset_id:qr};const r=run(c,d,['consultar_qr']);assert.equal(r.status,'decision_ready');assert.equal(r.decision.actions[0].type,'propose_qr');
 assert.equal(run(c,{...d,quote_items:[{product_id:id,quantity:2}]},['consultar_qr']).status,'incompatible_actions');
});
