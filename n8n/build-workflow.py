"""Rebuild Importados artifacts from their own versioned sources. No external project is read."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
w=json.loads((ROOT/'attention-core.workflow.json').read_text())
w['active']=False
for key in ['id','versionId','activeVersionId','activeVersion','createdAt','updatedAt','pinData','staticData']:
    w.pop(key,None)
nodes={n['name']:n for n in w['nodes']}
agent=nodes['Asistente de atención y compras']
agent['parameters']['options']['systemMessage']=(ROOT/'system-prompt.md').read_text().strip()
for n in w['nodes']:
    if 'jsCode' in n.get('parameters',{}):
        basename=n['name'] if n['type'].endswith('toolCode') else {'Validar turno y contexto':'validate-turn','Validar propuesta y referencias':'validate-decision','Fallo controlado sin envíos':'safe-failure'}[n['name']]
        n['parameters']['jsCode']=(ROOT/'source'/(basename+'.js')).read_text().strip()
nodes['Respuesta y acciones estructuradas']['parameters']['inputSchema']=(ROOT/'model-output.schema.json').read_text().strip()
tool=nodes['solicitar_equipo']['parameters']
tool['description']='Prepara una consulta nueva o amplía un caso general abierto de pending_tasks de Importados. Argumentos reason, question, task_id (id real elegible o vacío) y priority (normal|high). Reclamos y compras bloqueadas: alta. No concede beneficios, factura ni aprueba pagos. Una propuesta no acredita registro o notificación.'
schema=tool['inputSchema']
if isinstance(schema,str):schema=json.loads(schema)
schema['properties']['task_id']={'type':'string'}
schema['properties']['priority']={'type':'string','enum':['normal','high']}
tool['inputSchema']=schema
(ROOT/'attention-core.workflow.json').write_text(json.dumps(w,ensure_ascii=False,indent=2)+'\n')
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
