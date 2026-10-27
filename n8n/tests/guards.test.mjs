import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const execute = (name, values) => new Script('(function(){' + read('source/' + name + '.js') + '\n})()').runInContext(createContext(values), { timeout: 1000 });
export function fixture() {
  const now = Date.now();
  return { contract: 'importados.bot.turn.v1', mode: 'test', turn_id: '11111111-1111-4111-8111-111111111111', conversation_id: '22222222-2222-4222-8222-222222222222', control_version: 3, context_version: 4, context_fingerprint: '', snapshot: { source: 'synthetic', issued_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 240000).toISOString(), control: { manual_paused: false, closed: false, consent: 'granted', allow_ai: true }, branch: { id: 'synthetic-santa-lucia', name: 'Santa Lucía' }, message: { id: 'synthetic-message-1', text: '¿Cuál es el horario de la tienda?', kind: 'text' }, history: [], products: [], information: [{ id: 'synthetic-schedule', topic: 'Horario físico Santa Lucía', text: 'Santa Lucía: carrera 87 # 47DD-50. Horario de tienda: 9:00 a. m. a 8:00 p. m.' }], qr_assets: [], last_options: [], cart: [], operator_instructions: [], payment: { ready_for_qr: false, quote_id: '' }, checkout: {}, order: null } };
}
function validate(body) { return execute('validate-turn', { $input: { all: () => [{ json: { body } }] } })[0].json; }
function tool(name, context, query = '{}') { return JSON.parse(execute(name, { $: () => ({ first: () => ({ json: { context } }) }), query })); }
function decision(context, output, tools = []) { return execute('validate-decision', { $: () => ({ first: () => ({ json: { context } }) }), $input: { first: () => ({ json: { output, intermediateSteps: tools.map(tool => ({ action: { tool } })) } }) } })[0].json; }
const proposal = () => ({ intent: 'information', reply_text: 'Santa Lucía abre de 9:00 a. m. a 8:00 p. m.', product_ids: [], quote_items: [], qr_asset_id: '', human_reason: '', human_question: '', checkout: {}, confirmed_item: null, media_ids: [], accept_summary: false, cancel_cart: false });
function safe(result) { const r = result.response; assert.equal(r.contract, 'importados.bot.decision.v1'); assert.equal(r.send_allowed, false); assert.equal(r.mutations_executed.length, 0); return r; }

test('reclamo amplía solo un caso general real y conserva prioridad alta',()=>{
 const b=fixture(),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';b.snapshot.message.text='¿Otros dos días más? Lo necesito para mañana.';
 b.snapshot.pending_tasks=[{id,status:'pending',kind:'missing_information',priority:'normal',question:'Disponibilidad y precio del producto A'}];
 const c=validate(b).context,output={...proposal(),intent:'handoff',reply_text:'Revisaremos.',human_reason:'pqrs',human_question:'Reclama por demora y necesita el producto A mañana.',human_task_id:id,human_priority:'high'};
 const r=safe(decision(c,output));assert.equal(r.status,'decision_ready');assert.equal(r.decision.actions[0].task_id,id);assert.equal(r.decision.actions[0].priority,'high');assert.match(r.decision.reply_text,/Lamento la demora/);
 assert.equal(safe(decision(c,{...output,human_task_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})).status,'invalid_task_update');
 c.pending_tasks[0].kind='payment_review';assert.equal(safe(decision(c,output)).status,'invalid_task_update');
});

test('cortesía pendiente conserva silencio real aunque se llame al modelo',()=>{
 const b=fixture();b.snapshot.message.text='Okey yo espero';b.snapshot.pending_tasks=[];
 const r=safe(decision(validate(b).context,{...proposal(),intent:'clarification',reply_text:'Te contesto por aquí.'}));assert.equal(r.decision.reply_text,'');assert.equal(r.decision.actions.length,0);
});

test('acepta contexto sintético propio con memoria acotada', () => { const v = validate(fixture()); assert.equal(v.allow_ai, true); assert.equal(v.context.branch.name, 'Santa Lucía'); assert.ok(v.llm_input.includes('memoria autorizada')); });
for (const [name, change, expected] of [
  ['control manual', b => b.snapshot.control.manual_paused = true, 'manual_control'],
  ['cierre', b => b.snapshot.control.closed = true, 'conversation_closed'],
  ['consentimiento ausente', b => b.snapshot.control.consent = 'unknown', 'consent_required'],
  ['IA diferida', b => b.snapshot.control.allow_ai = false, 'automation_deferred'],
  ['modo no autorizado', b => b.mode = 'live', 'integration_not_enabled'],
  ['marca ajena', b => b.contract = 'foreign.bot.turn.v1', 'invalid_contract'],
  ['vista previa sin huella', b => { b.mode = 'preview'; b.snapshot.source = 'intranet'; }, 'invalid_snapshot'],
  ['contexto vencido', b => b.snapshot.expires_at = new Date(Date.now() - 1000).toISOString(), 'stale_context'],
  ['vigencia excesiva', b => b.snapshot.expires_at = new Date(Date.now() + 600000).toISOString(), 'stale_context'],
  ['historial demasiado largo', b => b.snapshot.history = Array.from({ length: 61 }, () => ({ role: 'customer', text: 'synthetic' })), 'invalid_context_lists'],
  ['producto de otra sede', b => b.snapshot.products = [{ id: 'synthetic-item', branch_id: 'other-branch', name: 'synthetic', price_cop: 100, available_quantity: 1, active: true, stock_verified: true }], 'invalid_catalog'],
]) test('rechaza ' + name + ' sin efectos', () => { const b = fixture(); change(b); const r = validate(b); assert.equal(r.allow_ai, false); assert.equal(safe(r).status, expected); assert.equal(r.response.decision, null); });

test('vista previa exige origen intranet y huella y devuelve versiones exactas', () => { const b = fixture(); b.mode = 'preview'; b.snapshot.source = 'intranet'; b.context_fingerprint = 'a'.repeat(64); const c = validate(b).context; const r = safe(decision(c, proposal(), ['consultar_informacion'])); assert.equal(r.status, 'decision_ready'); assert.equal(r.expected_control_version, 3); assert.equal(r.expected_context_version, 4); assert.equal(r.expected_context_fingerprint, b.context_fingerprint); });
test('catálogo vacío no fabrica promociones, stock ni cotización', () => { const c = validate(fixture()).context; const p = tool('buscar_promociones', c, '{"query":"producto inexistente"}'); assert.equal(p.available.length, 0); assert.equal(p.unavailable.length, 0); assert.equal(tool('cotizar_carrito', c, '{"items":[{"product_id":"inventado","quantity":1}]}').status, 'needs_verification'); });
test('QR no autorizado no se presenta', () => { const c = validate(fixture()).context; assert.notEqual(tool('consultar_qr', c).status, 'qr_available'); const d = proposal(); d.intent = 'qr'; d.qr_asset_id = 'inventado'; assert.equal(safe(decision(c, d, ['consultar_qr'])).status, 'qr_not_authorized'); });
test('información requiere evidencia de herramienta en el turno', () => { const b = fixture(); b.snapshot.message.text = '¿Cuál es la dirección?'; const c = validate(b).context; assert.equal(safe(decision(c, proposal())).status, 'missing_tool_evidence'); });
test('propuesta válida permanece sin envíos ni mutaciones', () => { const c = validate(fixture()).context; const r = safe(decision(c, proposal(), ['consultar_informacion'])); assert.equal(r.status, 'decision_ready'); assert.equal(r.requires_commit, true); assert.equal(r.decision.actions.length, 0); });
test('adjunto no persistido no confirma recepción ni aprueba pago', () => { const b = fixture(); b.snapshot.message = { id: 'synthetic-payment', kind: 'image', text: 'Ya pagué', attachment: { id: 'synthetic-file', message_id: 'different-message', persisted: true } }; const c = validate(b).context; assert.equal(c.message.attachment_received, false); const d = proposal(); d.intent = 'handoff'; d.human_reason = 'payment_review'; d.human_question = 'Revisar comprobante de pago'; const r = safe(decision(c, d, ['solicitar_equipo'])); assert.equal(r.status, 'decision_ready'); assert.match(r.decision.reply_text, /adjunta el comprobante/); assert.equal(r.decision.actions[0].reason, 'payment_review'); });
test('audio sin transcripción no inventa compra', () => { const b = fixture(); b.snapshot.message.kind = 'audio'; b.snapshot.message.text = 'Audio recibido'; const c = validate(b).context; const d = proposal(); d.intent = 'checkout'; d.checkout = { customer_name: 'Inventado' }; const r = safe(decision(c, d)); assert.equal(r.decision.intent, 'clarification'); assert.match(r.decision.reply_text, /escribir/); assert.equal(Object.keys(r.decision.checkout).length, 0); });
test('exportación sin credenciales o rutas ajenas y sin emisores/DB', () => { const w = JSON.parse(read('attention-core.workflow.json')); assert.equal(w.active, false); assert.equal(w.nodes[0].parameters.path, 'importados-assistant-turn-v1'); for (const n of w.nodes) { assert.doesNotMatch(JSON.stringify(n), /el-rey|elrey|EL REY|almaceneselrey/i); assert.doesNotMatch(n.type, /httpRequest|whatsApp|postgres|supabase/i); if (n.credentials) assert.equal(n.credentials.httpHeaderAuth.name, 'IMPORTADOS · Intranet → n8n'); } });
test('horarios del canal y corte de stock no se heredan de otra marca', () => { const prompt = read('system-prompt.md'); assert.doesNotMatch(prompt, /Atención 09:00|despachos de domicilio hasta 19:00|09–20 es únicamente el horario de WhatsApp|El horario 09–20 corresponde al canal/); assert.match(prompt, /No hay horarios del bot ni de domicilios confirmados/); assert.match(prompt, /stock_valid_until/); assert.match(prompt, /Niquía aún no tiene horario confirmado/); });
test('la consulta humana conserva disponibilidad y precio explícitos sin cuestionario inventado', () => { const b = fixture(); b.snapshot.message.text = '¿Tienen licuadoras y cuánto cuestan?'; const c = validate(b).context; const d = proposal(); d.intent = 'handoff'; d.human_reason = 'missing_information'; d.human_question = '¿Tienen licuadoras disponibles y variantes (marca, capacidad, color) y stock por modelo?'; const r = safe(decision(c, d, ['buscar_promociones', 'solicitar_equipo'])); assert.equal(r.status, 'decision_ready'); assert.equal(r.decision.actions[0].question, 'En Santa Lucía: ¿Tienen licuadoras y cuánto cuestan?'); });
