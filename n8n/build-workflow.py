"""Build a separate, inactive IMPORTADOS workflow from the verified reference graph.

Reference files are read-only. This builder never calls n8n, Meta, or a database.
"""
from pathlib import Path
import json
import uuid

ROOT = Path(__file__).resolve().parent
REFERENCE = Path('/Users/samuel/Desktop/Cowork for Grupo El Rey/Plataforma/n8n/rebuild/attention-core.workflow.json')
w = json.loads(REFERENCE.read_text())

def rebrand(value):
    if isinstance(value, dict):
        return {k: rebrand(v) for k, v in value.items()}
    if isinstance(value, list):
        return [rebrand(v) for v in value]
    if isinstance(value, str):
        for before, after in [
            ('Grupo Almacenes El Rey', 'Importados'),
            ('Grupo El Rey', 'Importados'),
            ('EL REY', 'IMPORTADOS'),
            ('El Rey', 'Importados'),
            ('el-rey', 'importados'),
            ('elrey', 'importados'),
            ('almacenesimportados.co/trabaja-con-nosotros/', 'tiendasimportados.com/trabaja-con-nosotros'),
            ('Robledo Aures', 'Santa Lucía'),
            ('Las existencias están confirmadas solo hasta el cierre de ese mismo día a las 20:00 de Colombia. No promociones stock desactualizado. La tarifa del domicilio la confirma una persona. Atención 09:00–20:00; despachos de domicilio hasta 19:00. El piloto puede recoger datos fuera del horario pero no promete despacho inmediato.', 'Las existencias solo están confirmadas durante la vigencia exacta stock_valid_until del snapshot verificado. No promociones stock desactualizado. La tarifa del domicilio y cualquier política de entrega requieren confirmación propia de Importados. No hay horarios del bot ni de domicilios confirmados en esta integración; no los supongas.'),
            ('El horario 09–20 corresponde al canal de atención de WhatsApp. No lo conviertas en horario físico de todas las tiendas si ese dato no está confirmado.', 'No hay horario del canal de WhatsApp confirmado. Consulta el horario físico específico de cada sede; Santa Lucía y Niquía tienen estados diferentes.'),
            ('09–20 es únicamente el horario de WhatsApp. Si pregunta por la tienda física, busca el horario específico de la sede para ese día; si no existe, confírmalo con el equipo en vez de sustituirlo por el horario del chat. No afirmes que un domicilio fuera de horario quedó programado: solo se retoma su gestión en el siguiente horario y requiere confirmación.', 'El horario físico de Santa Lucía no define el horario de WhatsApp ni los domicilios. Si pregunta por una tienda, busca el horario específico de esa sede para ese día; si no existe, confírmalo con el equipo. Niquía aún no tiene horario confirmado. No afirmes que un domicilio quedó programado ni anuncies una próxima apertura del canal sin configuración verificada.'),
            ("// The channel's 09–20 schedule never substitutes for store-specific hours.", '// Never substitute channel hours for store-specific verified hours.'),
        ]:
            value = value.replace(before, after)
    return value

w = rebrand(w)
for key in ['id', 'versionId', 'activeVersionId', 'activeVersion', 'createdAt', 'updatedAt', 'shared', 'tags', 'pinData', 'staticData', 'meta']:
    w.pop(key, None)
w['name'] = 'IMPORTADOS · WhatsApp · Motor de atención'
w['active'] = False
w['settings'] = {'executionOrder': 'v1', 'timezone': 'America/Bogota', 'saveExecutionProgress': False, 'saveManualExecutions': False, 'saveDataErrorExecution': 'none', 'saveDataSuccessExecution': 'none', 'executionTimeout': 120}

nodes = {n['name']: n for n in w['nodes']}
for n in w['nodes']:
    n['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'importados:attention:v1:' + n['name']))
    n.pop('credentials', None)
    n.pop('webhookId', None)
    n.pop('notes', None)
    if n['type'] == 'n8n-nodes-base.code':
        n['parameters']['mode'] = 'runOnceForAllItems'
        n['parameters']['language'] = 'javaScript'

nodes['Entrada privada de la intranet']['parameters'].update({'path': 'importados-assistant-turn-v1', 'authentication': 'headerAuth'})
nodes['Entrada privada de la intranet']['credentials'] = {'httpHeaderAuth': {'name': 'IMPORTADOS · Intranet → n8n'}}
nodes['Modelo conversacional']['parameters']['responsesApiEnabled'] = True
nodes['Modelo conversacional']['parameters']['builtInTools'] = {}

prefix = '''IDENTIDAD Y LÍMITES DE IMPORTADOS
Eres el asistente virtual de Importados. Habla de tú, cercano y respetuoso, con frases completas y claras. Tu marca, sitios, sedes e información son únicamente los de Importados y los hechos verificados de este turno.
La memoria viene exclusivamente del historial y contexto acotados que entrega el Worker. No existe memoria compartida con otros negocios. Catálogo vacío o promoción ausente no autoriza crear ni sugerir productos imaginarios.
La sede Santa Lucía está en carrera 87 # 47DD-50 y su horario de tienda confirmado es 9:00 a. m.–8:00 p. m. La sede Niquía, diagonal 55 avenida 33, está próxima a abrir; la inauguración está prevista para el 14 y 15 de noviembre de 2026 y su horario aún no está confirmado. Consulta siempre consultar_informacion para comunicar estos datos desde el snapshot verificado. El horario físico de Santa Lucía no define el horario del bot ni el de domicilios. No asumas atención o entregas automáticas a ninguna hora.
El canal laboral confirmado es https://tiendasimportados.com/trabaja-con-nosotros y la cuenta de Instagram es tiendasimportados. El formulario no confirma vacantes, contratación ni recepción de una hoja de vida. El número del negocio es +57 312 706 2214. El estado técnico del canal lo verifica el servidor; no expongas configuración interna al cliente ni afirmes envíos realizados sin confirmación.
Este motor devuelve exclusivamente propuestas sin efectos: send_allowed=false, mutations_executed=[] y ninguna herramienta aprueba pagos, crea pedidos, envía mensajes, avisa personas ni escribe datos. La intranet revalida y decide después. No prometas funciones comerciales o políticas que la información registrada no confirme.

'''
agent = nodes['Asistente de atención y compras']
agent['parameters']['options']['systemMessage'] = prefix + agent['parameters']['options']['systemMessage']
agent['parameters']['options']['systemMessage'] += '\n\nCONSULTA HUMANA COMPLETA\nSi el cliente pregunta disponibilidad y precio, conserva ambas preguntas en human_question. No conviertas una consulta de producto con precio en una pregunta solo de existencias. No agregues otras características que no solicitó.\n'
agent['parameters']['options']['passthroughBinaryImages'] = False
agent['parameters']['options']['passthroughBinaryPdfs'] = False
agent['parameters']['options']['enableStreaming'] = False
agent['onError'] = 'continueErrorOutput'
agent['retryOnFail'] = True
agent['maxTries'] = 2
agent['waitBetweenTries'] = 1000

decision_guard = nodes['Validar propuesta y referencias']['parameters']['jsCode']
decision_guard = decision_guard.replace(" actions.push({type:'propose_human_task',reason:d.human_reason,question,related_message_id:c.message.id});", """ // Preserve an explicit price enquiry when a model shortens the human task.
 const priceQuestion=/\\bprecio\\b|cuanto (?:cuesta(?:n)?|vale(?:n)?|sale(?:n)?)/i;
 const normalizeQuestion=value=>String(value||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase();
 const originalQuestion=String(c.onboarding_request||c.message.text).trim();
 const asksPrice=priceQuestion.test(normalizeQuestion(originalQuestion));
 const instructionRequest=/instruccion|prompt|secreto|token|api.?key|system|ignora|olvida|reglas? internas?/i.test(normalizeQuestion(originalQuestion));
 if(['missing_information','stock_check'].includes(d.human_reason)&&asksPrice){
  if(!shoppingActive&&!c.human_resolution&&!instructionRequest&&originalQuestion.length<=500)question='En '+c.branch.name+': '+originalQuestion;
  else if(!priceQuestion.test(normalizeQuestion(question)))question=question.slice(0,730)+' ¿Cuál es el precio vigente?';
 }
 actions.push({type:'propose_human_task',reason:d.human_reason,question,related_message_id:c.message.id});""")
nodes['Validar propuesta y referencias']['parameters']['jsCode'] = decision_guard

nodes['Estado y arquitectura']['parameters'].update({'content': '''## IMPORTADOS · Motor de atención
Entrada privada propia → contexto verificado → IA con seis herramientas acotadas → propuesta validada → Worker.

Este flujo es independiente y solo devuelve propuestas. No envía mensajes y no tiene acceso directo a Meta ni a la base operativa. El Worker conserva memoria, consentimiento, identidad, sede, catálogo y control manual y revalida cada efecto antes de guardar o enviar. Los controles de recepción/envío real del Worker permanecen desactivados durante la integración.

Herramientas: información, promociones, cotización, QR, pedido y consulta al equipo. Todas leen únicamente el snapshot acotado. Una ausencia de datos no prueba falta de stock. No se inventan productos ni precios. Un comprobante exige aprobación humana explícita.

La entrada usa exclusivamente Header Auth propia de Importados. Pendientes externos: registro del número en Meta, catálogo/stock/QR/políticas de Importados y prueba autorizada de extremo a extremo. No reutilizar credenciales de otro negocio.

Memoria: historial autorizado de esta conversación en el snapshot; sin memoria persistente propia. Historial de ejecuciones sin cuerpos guardados por defecto; pruebas sintéticas documentadas en n8n/tests.
''', 'height': 520, 'width': 850})
nodes['Contrato y pruebas']['parameters'].update({'content': '''## Contrato propio
POST /webhook/importados-assistant-turn-v1.
Header Auth: x-importados-webhook-secret, credencial IMPORTADOS · Intranet → n8n.
Entrada importados.bot.turn.v1. Salida importados.bot.decision.v1.
test exige source=synthetic; preview/pilot source=intranet y fingerprint SHA256.
Vigencia máxima 5 minutos; UUID de turno/conversación; versiones esperadas; consentimiento y automatización permitidos; control manual respetado.

send_allowed=false y mutations_executed=[] siempre. Se devuelve propuesta de texto y acciones; el Worker debe revalidar contexto, identidad, control, versiones, vigencia y referencias. Ninguna ejecución de n8n representa un envío.

Propuestas acotadas: propose_quote, propose_qr y propose_human_task; además checkout, confirmed_item, accept_summary y cancel_cart. Pago humano explícito; pedido solo tras commit idempotente del servidor. No validar un pago por imagen ni por texto del cliente.

Documentación exacta y pruebas locales: n8n/CONTRACT.md y n8n/tests. Exportación guardada con active=false. Este flujo nunca debe apuntar a otros negocios ni importar sus datos.
''', 'height': 530, 'width': 850})

for group in w.get('nodeGroups', []):
    group['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'importados:attention:group:' + group['name']))
w['nodeGroups'] = [
    {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'importados:attention:group:context')), 'name': 'Contexto y permisos', 'nodeNames': ['Validar turno y contexto', '¿Turno habilitado para IA?'], 'description': 'Comprueba consentimiento, control humano y vigencia antes de usar IA.'},
    {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'importados:attention:group:answer')), 'name': 'Atención verificada', 'nodeNames': ['Asistente de atención y compras', 'Modelo conversacional', 'consultar_informacion', 'buscar_promociones', 'cotizar_carrito', 'consultar_qr', 'consultar_pedido', 'solicitar_equipo', 'Respuesta y acciones estructuradas'], 'description': 'Prepara una respuesta con la memoria autorizada y seis consultas acotadas.'},
    {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'importados:attention:group:decision')), 'name': 'Propuesta sin efectos', 'nodeNames': ['Validar propuesta y referencias'], 'description': 'Verifica productos, importes y referencias antes de devolver la decisión al Worker.'},
    {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'importados:attention:group:failure')), 'name': 'Fallo controlado', 'nodeNames': ['Fallo controlado sin envíos'], 'description': 'Devuelve un estado seguro si falla la IA, sin enviar ni registrar nada.'},
    {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'importados:attention:group:guide')), 'name': 'Guía de integración', 'nodeNames': ['Estado y arquitectura', 'Contrato y pruebas'], 'description': 'Explica el contrato privado, las responsabilidades del Worker y lo que falta por configurar.'},
]

(ROOT / 'attention-core.workflow.json').write_text(json.dumps(w, ensure_ascii=False, indent=2) + '\n')
(ROOT / 'system-prompt.md').write_text(agent['parameters']['options']['systemMessage'] + '\n')
for n in w['nodes']:
    if 'jsCode' in n.get('parameters', {}):
        basename = n['name'] if n['type'].endswith('toolCode') else {'Validar turno y contexto': 'validate-turn', 'Validar propuesta y referencias': 'validate-decision', 'Fallo controlado sin envíos': 'safe-failure'}[n['name']]
        (ROOT / 'source' / (basename + '.js')).write_text(n['parameters']['jsCode'] + '\n')
(ROOT / 'model-output.schema.json').write_text(json.dumps(json.loads(nodes['Respuesta y acciones estructuradas']['parameters']['inputSchema']), ensure_ascii=False, indent=2) + '\n')

def js(value):
    if isinstance(value, str) and value.startswith('={{'):
        return 'expr(' + json.dumps(value[1:], ensure_ascii=False) + ')'
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + js(v) for k, v in value.items()) + '}'
    if isinstance(value, list):
        return '[' + ','.join(js(v) for v in value) + ']'
    return json.dumps(value, ensure_ascii=False)

names = {n['name']: 'n' + str(i) for i, n in enumerate(w['nodes'])}
parts = ["import { workflow, node, trigger, sticky, newCredential, ifElse, languageModel, tool, outputParser, expr } from '@n8n/workflow-sdk';"]
# The agent needs declarations of its subnodes first.
ordered = [n for n in w['nodes'] if n['name'] != 'Asistente de atención y compras'] + [agent]
for n in ordered:
    kind = 'trigger' if n['type'] == 'n8n-nodes-base.webhook' else 'ifElse' if n['type'] == 'n8n-nodes-base.if' else 'languageModel' if n['type'].endswith('lmChatOpenAi') else 'tool' if n['type'].endswith('toolCode') else 'outputParser' if n['type'].endswith('outputParserStructured') else 'node'
    config = {k: n[k] for k in ['name', 'parameters', 'position', 'onError', 'retryOnFail', 'maxTries', 'waitBetweenTries'] if k in n}
    config_js = js(config)
    if n['name'] == 'Entrada privada de la intranet':
        config_js = config_js[:-1] + ',credentials:{httpHeaderAuth:newCredential("IMPORTADOS · Intranet → n8n")}}'
    if n['name'] == 'Asistente de atención y compras':
        config_js = config_js[:-1] + ',subnodes:{model:n4,tools:[n5,n6,n7,n8,n9,n10],outputParser:n11}}'
    parts.append('const ' + names[n['name']] + ' = ' + kind + '({type:' + js(n['type']) + ',version:' + js(n['typeVersion']) + ',config:' + config_js + '});')
parts.append('export default workflow("importados-attention-v1", "IMPORTADOS · WhatsApp · Motor de atención")\n  .add(n0).to(n1).to(n2.onTrue(n3.to(n12.to(n13))).onFalse(n13))\n  .add(n3.onError(n14.to(n13)))\n  .add(n15).add(n16)')
for g in w['nodeGroups']:
    parts.append('  .group(' + js(g['name']) + ',[' + ','.join(names[n] for n in g['nodeNames']) + '],{description:' + js(g['description']) + '})')
parts[-1] += ';'
(ROOT / 'attention-core.sdk.ts').write_text('\n'.join(parts) + '\n')
print('Built inactive Importados export, SDK source, prompt and bounded runtime sources.')
