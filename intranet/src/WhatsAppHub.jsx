import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRANCHES } from "./lib/constants.js";
import { isDemoMode } from "./lib/supabase.js";
import { actOnWhatsAppConversation, getWhatsAppConversation, getWhatsAppStatus, listWhatsAppConversations, listWhatsAppTasks, previewWhatsApp, uploadWhatsAppPhoto, getWhatsAppPhoto, getWhatsAppAttachment } from "./lib/whatsapp-api.js";
import "./whatsapp.css";

const pendingTask = task => !["resolved", "closed", "cancelled"].includes(task.status);
const branchName = id => BRANCHES.find(branch => branch.id === id)?.name || "Sin sede asignada";
const customerName = conversation => conversation.customer_name || conversation.customer_phone || "Cliente de WhatsApp";
const dateTime = value => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short", timeZone: "America/Bogota" }).format(date) : "Sin fecha";
};
const messageState = { received: "Recibido", queued: "En cola", pending: "Pendiente de envío", sending: "Enviando", uncertain: "Entrega por confirmar", sent: "Enviado", delivered: "Entregado", read: "Leído", failed: "Falló el envío", blocked: "Envío bloqueado", cancelled: "Cancelado" };

function Empty({ title, children, symbol = "↔" }) {
  return <div className="wa-empty"><span aria-hidden="true">{symbol}</span><h3>{title}</h3><p>{children}</p></div>;
}

function TaskCard({ task, conversation, busy, onResolve, onOpen }) {
  const [answer, setAnswer] = useState("");
  const open = pendingTask(task);
  async function submit(event) { event.preventDefault(); if (await onResolve(task, answer.trim())) setAnswer(""); }
  return <article className="wa-task">
    <div className="wa-task-top"><span className={`wa-tag ${open ? "amber" : "green"}`}>{open ? "Por responder" : "Resuelta"}</span><small>{dateTime(task.created_at)}</small></div>
    {onOpen && <button type="button" className="wa-text-button" onClick={() => onOpen(task.conversation_id)}>{customerName(conversation || {})} · Ver conversación →</button>}
    <h3>{task.question || "Solicitud de apoyo del equipo"}</h3>
    {task.priority === "high" && <span className="wa-tag wa-priority">Prioridad alta</span>}
    {task.updates?.length > 0 && <details className="wa-task-updates"><summary>Ampliaciones de la consulta ({task.revision})</summary>{task.updates.map(update=><div key={update.message_id}><small>{dateTime(update.created_at)}</small><p>{update.question}</p></div>)}</details>}
    {task.attachments?.length > 0 && <p className="wa-muted">Incluye una foto de referencia en el historial.</p>}
    <p className="wa-muted">{branchName(task.branch_id || conversation?.branch_id)}</p>
    {open ? <form onSubmit={submit}><label>Respuesta del equipo<textarea value={answer} maxLength={4000} onChange={event => setAnswer(event.target.value)} placeholder="Confirma la información que necesita atención…" required disabled={busy}/></label><small>La respuesta queda registrada para continuar la atención del cliente.</small><button className="primary" disabled={busy || !answer.trim()}>{busy ? "Guardando…" : "Guardar respuesta"}</button></form> : <p className="wa-task-answer">{task.answer || "La solicitud ya fue atendida."}</p>}
  </article>;
}

function PhotoMessage({ conversationId, assetId }) {
 const [url,setUrl]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);const active=useRef(null);
 useEffect(()=>()=>{active.current?.abort();},[]);
 useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
 async function view(){const controller=new AbortController();active.current=controller;setBusy(true);setError("");try{const blob=await getWhatsAppPhoto(conversationId,assetId,controller.signal);if(!controller.signal.aborted)setUrl(URL.createObjectURL(blob));}catch(e){if(!controller.signal.aborted)setError(e.message);}finally{if(!controller.signal.aborted)setBusy(false);}}
 return <div className="wa-photo-message">{url?<a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="Foto compartida por el equipo de Importados"/></a>:<button type="button" onClick={view} disabled={busy}>{busy?"Cargando foto…":"Ver foto enviada"}</button>}{error&&<small role="alert">{error}</small>}</div>;
}

function IncomingAttachment({ conversationId, message }) {
 const [file,setFile]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const active=useRef(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 useEffect(()=>()=>{if(file?.url)URL.revokeObjectURL(file.url);},[file]);
 async function open(){
  active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);setError("");
  try{const blob=await getWhatsAppAttachment(conversationId,message.id,controller.signal);if(!controller.signal.aborted)setFile({url:URL.createObjectURL(blob),type:blob.type});}
  catch(e){if(!controller.signal.aborted)setError(e.message);}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 const name=message.attachment.filename||({image:"Imagen del cliente",audio:"Audio del cliente",video:"Video del cliente",sticker:"Sticker del cliente",document:"Documento del cliente"}[message.kind]||"Archivo del cliente");
 return <div className="wa-incoming-attachment"><b>{name}</b>{!file?<button type="button" disabled={busy} onClick={open}>{busy?"Preparando archivo…":error?"Volver a intentar":"Abrir archivo recibido"}</button>:<>
  {file.type.startsWith("image/")&&<a href={file.url} target="_blank" rel="noopener noreferrer"><img src={file.url} alt="Imagen enviada por el cliente"/></a>}
  {file.type.startsWith("audio/")&&<audio src={file.url} controls preload="metadata">Descarga el audio para escucharlo.</audio>}
  {file.type.startsWith("video/")&&<video src={file.url} controls preload="metadata"/>}
  <div className="wa-file-links"><a href={file.url} target="_blank" rel="noopener noreferrer">Abrir en otra pestaña ↗</a><a href={file.url} download={message.attachment.filename||"archivo"}>Descargar</a></div>
 </>}{error&&<p className="wa-file-error" role="alert">{error}</p>}<small>Archivo privado · solo para el equipo autorizado.</small></div>;
}

function Conversation({ id, profile, onChanged, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [photo,setPhoto]=useState(null);
  const [photoPreview,setPhotoPreview]=useState("");
  const [uploading,setUploading]=useState(false);
  const photoRequest=useRef(null);
  useEffect(()=>{if(!photo){setPhotoPreview("");return;}const url=URL.createObjectURL(photo);setPhotoPreview(url);return()=>URL.revokeObjectURL(url);},[photo]);
  const [branch, setBranch] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const alive = useRef(true);
  const readSequence = useRef(0);
  const actionInFlight = useRef(false);
  const actionController = useRef(null);
  const pendingRequest = useRef(null);
  const refreshing = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; actionController.current?.abort(); }; }, []);

  const load = useCallback(async signal => {
    if (actionInFlight.current) return;
    const sequence = ++readSequence.current;
    const revision = refreshing.current;
    try {
      const result = await getWhatsAppConversation(id, signal);
      if (alive.current && !signal?.aborted && sequence === readSequence.current && revision === refreshing.current) { setData(result); setError(""); }
    } catch (loadError) { if (alive.current && !signal?.aborted && sequence === readSequence.current) { if ([403, 404].includes(loadError.status)) { setData(null); pendingRequest.current = null; setPendingAction(null); } setError(loadError.message); } }
    finally { if (alive.current && !signal?.aborted && sequence === readSequence.current) setLoading(false); }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => { if (!document.hidden) void load(controller.signal); };
    const timer = setInterval(refresh, 12000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);

  async function act(values) {
    if (actionInFlight.current || !data?.conversation) return false;
    const signature = JSON.stringify(values);
    if (pendingRequest.current && pendingRequest.current.signature !== signature) { setError("Primero confirma la acción pendiente con el botón de reintento."); return false; }
    actionInFlight.current = true;
    setBusy(true); setNotice(""); setError("");
    const controller = new AbortController(); actionController.current = controller;
    refreshing.current++;
    let saved = false;
    try {
      if (!pendingRequest.current) {
        let currentConversation = data.conversation;
        {
          const current = await getWhatsAppConversation(id, controller.signal);
          if (!alive.current) return false;
          setData(current);
          if (["send","send_image"].includes(values.action) && (current.can_send !== true || current.conversation.status === "closed" || current.conversation.consent_status === "revoked")) { setError("El envío ya no está disponible. Revisa el estado de esta conversación antes de continuar."); return false; }
          currentConversation = current.conversation;
        }
        pendingRequest.current = { signature, values, conversation: currentConversation, requestId: crypto.randomUUID() };
      }
      const pending = pendingRequest.current;
      const result = await actOnWhatsAppConversation(pending.conversation, { ...values, request_id: pending.requestId }, controller.signal);
      saved = true;
      pendingRequest.current = null;
      if (alive.current) setPendingAction(null);
      if (["send","send_image"].includes(values.action) && alive.current) {setText("");setPhoto(null);photoRequest.current=null;}
      if (!alive.current) return false;
      if (result.conversation) setData(current => ({ ...current, conversation: result.conversation }));
      const latest = await getWhatsAppConversation(id, controller.signal);
      if (!alive.current) return false;
      setData(latest);
      setNotice(["send","send_image"].includes(values.action) ? "Solicitud de envío registrada. Revisa su estado en la conversación." : values.action === "resolve_task" ? "Respuesta guardada." : values.action === "pause" ? "Atención automática pausada. El equipo tiene el control." : values.action === "resume" ? pending.conversation.status === "closed" ? "Atención reabierta. La atención automática podrá continuar cuando el canal esté disponible." : "Pausa retirada. La atención automática podrá continuar cuando el canal esté disponible." : values.action === "close" ? "Conversación cerrada." : "Sede actualizada.");
      setConfirmClose(false);
      onChanged();
      return true;
    } catch (actionError) {
      if (!saved && actionError.confirmedRejection) { pendingRequest.current = null; if (alive.current) setPendingAction(null); }
      else if (!saved && pendingRequest.current && alive.current) setPendingAction(pendingRequest.current);
      if (alive.current && !controller.signal.aborted) { setError(saved ? `La acción quedó registrada, pero no pudimos actualizar el historial: ${actionError.message}` : actionError.message); onChanged(); }
      return saved;
    } finally { actionInFlight.current = false; if (alive.current) setBusy(false); }
  }

  const conversation = data?.conversation;
  const canSend = data?.can_send === true && conversation?.status !== "closed" && conversation?.consent_status !== "revoked";
  const sendReason=conversation?.status==="closed"?"Reabre la conversación para continuar.":conversation?.consent_status!=="granted"?"El cliente debe autorizar primero el tratamiento de sus datos.":!conversation?.manual_paused?"Pulsa «Tomar control» para escribir o enviar fotos.":"El envío requiere un canal activo y un mensaje del cliente en las últimas 24 horas.";
  async function submitMessage(event){event.preventDefault();if(!canSend||busy||uploading||pendingAction)return;
   if(!photo){if(text.trim())await act({action:"send",text:text.trim()});return;}
   setUploading(true);setError("");const controller=new AbortController();actionController.current=controller;
   try{if(!photoRequest.current?.asset){const result=await uploadWhatsAppPhoto(id,photo,photoRequest.current.id,controller.signal);photoRequest.current.asset=result.media.id;}if(alive.current)await act({action:"send_image",media_id:photoRequest.current.asset,text:text.trim()});}
   catch(e){if(alive.current&&!controller.signal.aborted)setError(e.message);}finally{if(alive.current)setUploading(false);}
  }
  const tasks = data?.tasks || [];
  const messages = useMemo(() => [...(data?.messages || [])].sort((left, right) => new Date(left.created_at) - new Date(right.created_at)), [data?.messages]);
  return <section className="wa-conversation" aria-label="Conversación seleccionada" aria-busy={loading || busy}>
    <button className="wa-mobile-back wa-text-button" onClick={onBack}>← Conversaciones</button>
    {loading && !conversation ? <p className="wa-loading" role="status">Cargando conversación…</p> : null}
    {error && <div className="wa-error" role="alert"><p>{error}</p><button disabled={busy} onClick={() => load()}>Actualizar</button></div>}
    {notice && <p className="wa-success" role="status">{notice}</p>}
    {pendingAction && <div className="wa-warning" role="status"><p>No recibimos la confirmación de la acción anterior. Reintenta para consultar el mismo registro y evitar duplicados.</p><button disabled={busy} onClick={() => act(pendingAction.values)}>Reintentar acción pendiente</button></div>}
    {conversation && <>
      <header className="wa-conversation-heading"><div><p className="wa-eyebrow">{branchName(conversation.branch_id)}</p><h2>{customerName(conversation)}</h2>{conversation.customer_phone && conversation.customer_name && <p>{conversation.customer_phone}</p>}</div><span className={`wa-tag ${conversation.status === "closed" ? "gray" : conversation.manual_paused ? "amber" : "green"}`}>{conversation.status === "closed" ? "Cerrada" : conversation.manual_paused ? "Atención del equipo" : "Abierta"}</span></header>
      <div className="wa-conversation-tools"><button disabled={busy || uploading || Boolean(pendingAction)} onClick={() => act({ action: conversation.status === "closed" || conversation.manual_paused ? "resume" : "pause" })}>{conversation.status === "closed" ? "Reabrir atención" : conversation.manual_paused ? "Reanudar atención automática" : "Tomar control"}</button>{conversation.status !== "closed" && <button disabled={busy || uploading || Boolean(pendingAction)} onClick={() => setConfirmClose(value => !value)}>Cerrar conversación</button>}</div>
      {confirmClose && <div className="wa-confirm"><p>Se cerrará esta atención y se conservará su historial.</p><button disabled={busy} className="primary" onClick={() => act({ action: "close" })}>Confirmar cierre</button><button disabled={busy} onClick={() => setConfirmClose(false)}>Volver</button></div>}
      {profile.role === "admin" && <form className="wa-branch-form" onSubmit={event => { event.preventDefault(); void act({ action: "assign_branch", branch_id: branch }); }}><label>Asignar a sede<select value={branch} onChange={event => setBranch(event.target.value)} disabled={busy || uploading || Boolean(pendingAction)}><option value="">{branchName(conversation.branch_id)}</option>{BRANCHES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button disabled={busy || uploading || Boolean(pendingAction) || !branch || branch === conversation.branch_id}>Guardar sede</button></form>}
      {conversation.consent_status === "revoked" && <p className="wa-warning">El cliente retiró su autorización. El envío de mensajes está bloqueado.</p>}
      <div className="wa-messages" aria-label="Historial de mensajes">
        {data.limits?.messages_truncated && <p className="wa-muted wa-history-limit">Se muestran los últimos {data.limits.messages || 100} mensajes.</p>}
        {!messages.length ? <Empty title="Sin mensajes registrados">El historial aparecerá aquí cuando se reciban mensajes del cliente.</Empty> : messages.map(message => <article key={message.id} className={`wa-message ${message.direction === "outbound" ? "outbound" : "inbound"}`}><small>{message.source === "operator" ? "Equipo Importados" : message.source === "assistant" ? "Atención automática" : "Cliente"}</small>{(message.body||!message.attachment)&&<p>{message.body || (message.kind === "text" ? "Mensaje sin texto" : "Mensaje sin vista previa")}</p>}{message.attachment?.asset_id && <PhotoMessage conversationId={id} assetId={message.attachment.asset_id}/>} {message.direction==="inbound"&&message.attachment?.id&&<IncomingAttachment conversationId={id} message={message}/>}<div><time dateTime={message.created_at}>{dateTime(message.created_at)}</time><span className={message.status === "failed" ? "wa-failed" : ""}>{messageState[message.status] || "Registrado"}</span></div></article>)}
      </div>
      {!canSend && <p className="wa-warning">{sendReason}</p>}
      <form className="wa-composer" onSubmit={submitMessage}><label>{photo?"Texto de la foto (opcional)":"Mensaje del equipo"}<textarea value={text} onChange={event => setText(event.target.value)} maxLength={photo?1024:4000} disabled={!canSend || busy || uploading || Boolean(pendingAction)} placeholder={canSend ? "Escribe la respuesta al cliente…" : sendReason}/></label>
        <div className="wa-photo-controls"><label className={`wa-attach ${!canSend?"disabled":""}`}>Adjuntar foto<input type="file" accept="image/jpeg,image/png" disabled={!canSend||busy||uploading||Boolean(pendingAction)} onChange={event=>{const file=event.target.files?.[0];if(file&&(!["image/jpeg","image/png"].includes(file.type)||file.size>5*1024*1024)){setError("Elige una foto JPG o PNG de hasta 5 MB.");event.target.value="";return;}setPhoto(file||null);photoRequest.current=file?{id:crypto.randomUUID(),asset:null}:null;event.target.value="";}}/></label><small>JPG o PNG · máximo 5 MB</small></div>
        {photo&&<div className="wa-selected-photo"><img src={photoPreview} alt="Foto seleccionada para enviar"/><span>{photo.name}</span><button type="button" disabled={busy||uploading||Boolean(pendingAction)} onClick={()=>{setPhoto(null);photoRequest.current=null;}}>Quitar foto</button></div>}
        <div><small>{canSend ? "El estado del envío aparecerá en el historial." : sendReason}</small><button className="primary" disabled={!canSend||busy||uploading||Boolean(pendingAction)||(!photo&&!text.trim())}>{uploading?"Preparando foto…":busy?"Guardando…":photo?"Enviar foto":"Enviar mensaje"}</button></div></form>
      {tasks.length > 0 && <section className="wa-conversation-tasks"><h3>Solicitudes al equipo <span>{tasks.filter(pendingTask).length} pendientes</span></h3>{data.limits?.tasks_truncated && <p className="wa-muted">Se muestran las últimas {data.limits.tasks || 100} solicitudes de esta conversación.</p>}{tasks.map(task => <TaskCard key={task.id} task={task} conversation={conversation} busy={busy || uploading || Boolean(pendingAction)} onResolve={(task, answer) => act({ action: "resolve_task", task_id: task.id, answer })}/>)}</section>}
    </>}
  </section>;
}

function Integration({ status, error }) {
  const [text, setText] = useState("");
  const [branch, setBranch] = useState(BRANCHES[0].id);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const channelReady = status?.channel?.ready === true;
  const automationReady = status?.automation?.ready === true;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setPreview(null); setPreviewError("");
    const nextController = new AbortController(); controller.current = nextController;
    try { const result = await previewWhatsApp(text.trim(), branch, nextController.signal); if (!nextController.signal.aborted) setPreview(result); }
    catch (problem) { if (!nextController.signal.aborted) setPreviewError(problem.message); }
    finally { if (!nextController.signal.aborted) setBusy(false); }
  }
  const result = preview?.preview;
  const limitations = preview?.limitations || result?.limitations || [];
  return <div className="wa-integration">
    <section className="wa-connection-card"><div className="wa-connection-icon" aria-hidden="true">↔</div><div><p className="wa-eyebrow">CANAL DE ATENCIÓN</p><h2>{channelReady ? "WhatsApp disponible" : status ? "Activación pendiente" : "Estado por confirmar"}</h2><p>{channelReady ? "La conexión del canal está preparada. Los envíos dependen de los permisos de atención." : "El equipo puede preparar la atención mientras se completa el registro del número en Meta."}</p>{status?.channel?.number && <b className="wa-number">{status.channel.number}</b>}</div><span className={`wa-tag ${channelReady ? "green" : "amber"}`}>{channelReady ? "Conectado" : "Pendiente"}</span></section>
    {error && <p className="wa-error" role="alert">{error}</p>}
    <div className="wa-checklist"><article><span className={`wa-step ${channelReady ? "done" : ""}`} aria-hidden="true">{channelReady ? "✓" : "1"}</span><div><h3>Registro del número</h3><p>{channelReady ? "Conexión del canal confirmada." : "Falta completar la activación del número y su conexión en Meta."}</p></div><span className={`wa-tag ${channelReady ? "green" : "amber"}`}>{channelReady ? "Disponible" : "Pendiente"}</span></article><article><span className={`wa-step ${automationReady ? "done" : ""}`} aria-hidden="true">{automationReady ? "✓" : "2"}</span><div><h3>Atención automática</h3><p>{automationReady ? "El flujo está preparado para recibir consultas autorizadas." : "La preparación de la atención automática está por confirmar."}</p></div><span className={`wa-tag ${automationReady ? "green" : "gray"}`}>{automationReady ? "Preparada" : "Por confirmar"}</span></article><article><span className={`wa-step ${status?.capabilities?.manual_send === true ? "done" : ""}`} aria-hidden="true">{status?.capabilities?.manual_send === true ? "✓" : "3"}</span><div><h3>Mensajes al cliente</h3><p>{status?.capabilities?.manual_send === true ? "Cada conversación comprueba sus permisos antes del envío." : "Se habilitarán después de verificar la conexión y los permisos del canal."}</p></div><span className={`wa-tag ${status?.capabilities?.manual_send === true ? "green" : "gray"}`}>{status?.capabilities?.manual_send === true ? "Habilitados" : "Bloqueados"}</span></article></div>
    <section className="wa-alert-settings"><h3>Avisos de consultas pendientes</h3><p>{status?.notifications?.configured?`Responsable: ${status.notifications.recipient_hint}. Recibirá un aviso por cada solicitud nueva que necesite apoyo del equipo.`:"No hay un responsable configurado para avisos por WhatsApp."}</p>{status?.notifications?.needs_template&&<p className="wa-warning">Meta debe aprobar la plantilla de avisos para enviarlos fuera de las 24 horas desde tu último mensaje al negocio.</p>}{status?.notifications?.failed>0&&<p className="wa-warning">Hay {status.notifications.failed} avisos con fallo o entrega por confirmar.</p>}</section>
    <section className="wa-preview"><div><p className="wa-eyebrow">PRUEBA SIN ENVÍO</p><h2>Ensayar una consulta</h2><p>Revisa la propuesta de atención con información de la sede. Esta prueba no crea una conversación ni envía mensajes a clientes.</p></div><form onSubmit={submit}><label>Sede<select value={branch} onChange={event => setBranch(event.target.value)} disabled={busy}>{BRANCHES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Consulta de prueba<textarea value={text} onChange={event => setText(event.target.value)} maxLength={2000} placeholder="Por ejemplo: ¿En qué horario atiende la sede?" required disabled={busy}/></label><button className="primary" disabled={busy || !text.trim() || status?.capabilities?.preview !== true}>{busy ? "Preparando propuesta…" : "Probar atención"}</button>{status?.capabilities?.preview !== true && <small>La prueba estará disponible cuando se confirme la preparación del canal.</small>}</form>
      {previewError && <p className="wa-error" role="alert">{previewError}</p>}
      {preview && <div className="wa-preview-result" role="status"><span className="wa-tag amber">Simulación · sin envío</span><h3>{result?.status === "decision_ready" ? "Propuesta de atención" : "La prueba aún no está disponible"}</h3>{result?.decision?.reply_text && <p>{result.decision.reply_text}</p>}{result?.decision?.actions?.length > 0 && <p className="wa-muted">La propuesta requiere {result.decision.actions.length} {result.decision.actions.length === 1 ? "acción de apoyo" : "acciones de apoyo"}. Ninguna se ejecutó en esta prueba.</p>}{limitations.length > 0 && <ul>{limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>}</div>}
    </section>
  </div>;
}

export default function WhatsAppHub({ profile }) {
  const admin = profile.role === "admin";
  const [tab, setTab] = useState("conversations");
  const [conversations, setConversations] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [status, setStatus] = useState(null);
  const [selected, setSelected] = useState(()=>{const id=new URLSearchParams(window.location.search).get("whatsapp");return /^[0-9a-f-]{36}$/i.test(id||"")?id:null;});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [branch, setBranch] = useState("all");
  const [loading, setLoading] = useState(!isDemoMode);
  const [errors, setErrors] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const [limits, setLimits] = useState({});
  const alive = useRef(true);
  const readSequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async signal => {
    if (isDemoMode) return;
    const sequence = ++readSequence.current;
    try {
      const results = await Promise.allSettled([listWhatsAppConversations(signal), listWhatsAppTasks(signal), ...(admin ? [getWhatsAppStatus(signal)] : [])]);
      if (!alive.current || signal?.aborted || sequence !== readSequence.current) return;
      const nextErrors = {};
      if (results[0].status === "fulfilled") { setConversations(results[0].value.conversations); setLimits(current => ({ ...current, conversations: results[0].value.limits })); }
      else nextErrors.conversations = results[0].reason.message;
      if (results[1].status === "fulfilled") { setTasks(results[1].value.tasks); setLimits(current => ({ ...current, tasks: results[1].value.limits })); } else nextErrors.tasks = results[1].reason.message;
      if (admin) { if (results[2].status === "fulfilled") setStatus(results[2].value); else { setStatus(null); nextErrors.status = results[2].reason.message; } }
      setErrors(nextErrors);
      if (!Object.keys(nextErrors).length) setUpdatedAt(new Date().toISOString());
    } finally { if (alive.current && !signal?.aborted && sequence === readSequence.current) setLoading(false); }
  }, [admin]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const check = () => { if (!document.hidden) void refresh(controller.signal); };
    const timer = setInterval(check, 12000);
    window.addEventListener("focus", check);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", check); };
  }, [refresh]);

  const pending = tasks.filter(pendingTask);
  const filtered = useMemo(() => conversations.filter(item => (filter === "all" || (filter === "active" ? item.status !== "closed" : item.manual_paused && item.status !== "closed")) && (branch === "all" || item.branch_id === branch) && `${item.customer_name || ""} ${item.customer_phone || ""} ${item.last_message_preview || ""}`.toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es"))), [conversations, filter, branch, search]);
  function openConversation(id) { setSelected(id); setTab("conversations"); }
  return <section className="wa-hub">
    <header className="wa-heading"><div><p className="wa-eyebrow">ATENCIÓN AL CLIENTE</p><h2>WhatsApp</h2><p>{admin ? "Conversaciones, solicitudes del equipo y conexión del canal." : `Atención y solicitudes de ${branchName(profile.branch_id)}.`}</p></div><button disabled={loading || isDemoMode} onClick={() => refresh()}>{loading ? "Cargando…" : "Actualizar"}</button></header>
    {isDemoMode && <p className="wa-warning">WhatsApp requiere una sesión real. Esta demostración no contiene chats ni envía mensajes.</p>}
    {admin && !isDemoMode && <div className={`wa-channel-strip ${status?.channel?.ready === true ? "ready" : ""}`}><span className="wa-channel-dot"/><div><b>{status?.channel?.ready === true ? "Canal disponible" : status ? "Número pendiente de activación" : "Estado del canal por confirmar"}</b><small>{status?.automation?.ready === true ? "Atención automática preparada" : "Preparación de la atención por confirmar"}{status?.capabilities?.manual_send !== true ? " · Envíos bloqueados" : ""}</small></div><button onClick={() => setTab("integration")}>Ver conexión →</button></div>}
    <nav className="wa-tabs" aria-label="Vistas de WhatsApp"><button className={tab === "conversations" ? "active" : ""} onClick={() => setTab("conversations")}>Conversaciones <span>{conversations.filter(item => item.status !== "closed").length}</span></button><button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>Solicitudes al equipo <span>{pending.length}</span></button>{admin && <button className={tab === "integration" ? "active" : ""} onClick={() => setTab("integration")}>Conexión y prueba</button>}</nav>
    {updatedAt && <p className="wa-last-read">Última actualización: {dateTime(updatedAt)} · Se actualiza mientras esta vista está abierta.</p>}
    {limits[tab]?.truncated && <p className="wa-warning">Se muestran las {tab === "tasks" ? limits.tasks.tasks || 100 : limits.conversations.conversations || 100} {tab === "tasks" ? "solicitudes" : "conversaciones"} más recientes. La búsqueda y los filtros se aplican a esta lista.</p>}
    {tab === "conversations" && <>{errors.conversations && <div className="wa-error" role="alert">{errors.conversations}</div>}<div className={`wa-workspace ${selected ? "has-selection" : ""}`}><aside className="wa-inbox"><div className="wa-filters"><label>Buscar conversación<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cliente o mensaje…"/></label><label>Estado<select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Abiertas</option><option value="paused">Atención del equipo</option><option value="all">Todas</option></select></label>{admin && <label>Sede<select value={branch} onChange={event => setBranch(event.target.value)}><option value="all">Todas las sedes</option><option value="">Sin asignar</option>{BRANCHES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div><div className="wa-conversation-list" aria-label="Conversaciones">{loading ? <p className="wa-loading" role="status">Cargando conversaciones…</p> : !filtered.length ? <Empty title={errors.conversations ? "Conversaciones sin cargar" : conversations.length ? "Sin coincidencias" : "Aún no hay conversaciones"}>{errors.conversations ? "Actualiza para volver a consultar." : conversations.length ? "Prueba con otro nombre o filtro." : "Las consultas reales aparecerán aquí cuando el número esté conectado y reciba mensajes."}</Empty> : filtered.map(item => <button key={item.id} className={`wa-conversation-item ${selected === item.id ? "active" : ""}`} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id}><div><b>{customerName(item)}</b><time>{dateTime(item.last_message_at || item.updated_at)}</time></div><p>{item.last_message_preview || "Sin vista previa del último mensaje"}</p><div><small>{branchName(item.branch_id)}</small><span className={`wa-tag ${item.status === "closed" ? "gray" : item.manual_paused ? "amber" : "green"}`}>{item.status === "closed" ? "Cerrada" : item.manual_paused ? "Equipo" : "Abierta"}</span></div></button>)}</div></aside>{selected ? <Conversation key={selected} id={selected} profile={profile} onChanged={() => refresh()} onBack={() => setSelected(null)}/> : <div className="wa-unselected"><Empty title="Cada atención, en un solo lugar">Selecciona una conversación para revisar mensajes, pausar la atención automática o responder solicitudes.</Empty></div>}</div></>}
    {tab === "tasks" && <>{errors.tasks && <p className="wa-error" role="alert">{errors.tasks}</p>}<p className="wa-view-help">Aquí verás las consultas que necesitan confirmación de una persona del equipo. Abre la conversación para responder y revisar el contexto.</p>{loading ? <p className="wa-loading" role="status">Cargando solicitudes…</p> : !pending.length ? <Empty title={errors.tasks ? "Solicitudes sin cargar" : "Sin solicitudes pendientes"} symbol="✓">{errors.tasks ? "Actualiza para volver a consultar." : "Las preguntas que necesiten apoyo del equipo aparecerán aquí."}</Empty> : <div className="wa-task-list">{pending.map(task => <article className="wa-task" key={task.id}><div className="wa-task-top"><span className="wa-tag amber">Por responder</span><small>{dateTime(task.created_at)}</small></div><h3>{task.question || "Solicitud de apoyo del equipo"}</h3>{task.priority==="high"&&<span className="wa-tag wa-priority">Prioridad alta</span>}{task.latest_question&&<p>{task.latest_question}</p>}<p>{branchName(task.branch_id)}</p><button onClick={() => openConversation(task.conversation_id)}>Abrir conversación →</button></article>)}</div>}</>}
    {tab === "integration" && admin && <Integration status={status} error={errors.status}/>}
  </section>;
}
