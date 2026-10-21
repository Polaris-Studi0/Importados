import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRANCHES } from "./lib/constants.js";
import { isDemoMode } from "./lib/supabase.js";
import { actOnWhatsAppConversation, getWhatsAppConversation, getWhatsAppStatus, listWhatsAppConversations, listWhatsAppTasks, previewWhatsApp } from "./lib/whatsapp-api.js";
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
    <p className="wa-muted">{branchName(task.branch_id || conversation?.branch_id)}</p>
    {open ? <form onSubmit={submit}><label>Respuesta del equipo<textarea value={answer} maxLength={4000} onChange={event => setAnswer(event.target.value)} placeholder="Confirma la información que necesita atención…" required disabled={busy}/></label><small>La respuesta queda registrada para continuar la atención del cliente.</small><button className="primary" disabled={busy || !answer.trim()}>{busy ? "Guardando…" : "Guardar respuesta"}</button></form> : <p className="wa-task-answer">{task.answer || "La solicitud ya fue atendida."}</p>}
  </article>;
}

function Conversation({ id, profile, channelStatus, onChanged, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
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
        if (values.action === "send") {
          const current = await getWhatsAppConversation(id, controller.signal);
          if (!alive.current) return false;
          setData(current);
          if (current.can_send !== true || current.conversation.status === "closed" || current.conversation.consent_status === "revoked") { setError("El envío ya no está disponible. Revisa el estado de esta conversación antes de continuar."); return false; }
          currentConversation = current.conversation;
        }
        pendingRequest.current = { signature, values, conversation: currentConversation, requestId: crypto.randomUUID() };
      }
      const pending = pendingRequest.current;
      const result = await actOnWhatsAppConversation(pending.conversation, { ...values, request_id: pending.requestId }, controller.signal);
      saved = true;
      pendingRequest.current = null;
      if (alive.current) setPendingAction(null);
      if (values.action === "send" && alive.current) setText("");
      if (!alive.current) return false;
      if (result.conversation) setData(current => ({ ...current, conversation: result.conversation }));
      const latest = await getWhatsAppConversation(id, controller.signal);
      if (!alive.current) return false;
      setData(latest);
      setNotice(values.action === "send" ? "Solicitud de envío registrada. Revisa su estado en la conversación." : values.action === "resolve_task" ? "Respuesta guardada." : values.action === "pause" ? "Atención automática pausada. El equipo tiene el control." : values.action === "resume" ? pending.conversation.status === "closed" ? "Atención reabierta. La atención automática podrá continuar cuando el canal esté disponible." : "Pausa retirada. La atención automática podrá continuar cuando el canal esté disponible." : values.action === "close" ? "Conversación cerrada." : "Sede actualizada.");
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
  const canSend = data?.can_send === true && (profile.role !== "admin" || channelStatus?.capabilities?.manual_send === true) && conversation?.status !== "closed" && conversation?.consent_status !== "revoked";
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
      <div className="wa-conversation-tools"><button disabled={busy || Boolean(pendingAction)} onClick={() => act({ action: conversation.status === "closed" || conversation.manual_paused ? "resume" : "pause" })}>{conversation.status === "closed" ? "Reabrir atención" : conversation.manual_paused ? "Reanudar atención automática" : "Pausar atención automática"}</button>{conversation.status !== "closed" && <button disabled={busy || Boolean(pendingAction)} onClick={() => setConfirmClose(value => !value)}>Cerrar conversación</button>}</div>
      {confirmClose && <div className="wa-confirm"><p>Se cerrará esta atención y se conservará su historial.</p><button disabled={busy} className="primary" onClick={() => act({ action: "close" })}>Confirmar cierre</button><button disabled={busy} onClick={() => setConfirmClose(false)}>Volver</button></div>}
      {profile.role === "admin" && <form className="wa-branch-form" onSubmit={event => { event.preventDefault(); void act({ action: "assign_branch", branch_id: branch }); }}><label>Asignar a sede<select value={branch} onChange={event => setBranch(event.target.value)} disabled={busy || Boolean(pendingAction)}><option value="">{branchName(conversation.branch_id)}</option>{BRANCHES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button disabled={busy || Boolean(pendingAction) || !branch || branch === conversation.branch_id}>Guardar sede</button></form>}
      {conversation.consent_status === "revoked" && <p className="wa-warning">El cliente retiró su autorización. El envío de mensajes está bloqueado.</p>}
      <div className="wa-messages" aria-label="Historial de mensajes">
        {data.limits?.messages_truncated && <p className="wa-muted wa-history-limit">Se muestran los últimos {data.limits.messages || 100} mensajes.</p>}
        {!messages.length ? <Empty title="Sin mensajes registrados">El historial aparecerá aquí cuando se reciban mensajes del cliente.</Empty> : messages.map(message => <article key={message.id} className={`wa-message ${message.direction === "outbound" ? "outbound" : "inbound"}`}><small>{message.source === "operator" ? "Equipo Importados" : message.source === "assistant" ? "Atención automática" : "Cliente"}</small><p>{message.body || (message.kind === "text" ? "Mensaje sin texto" : "Archivo o mensaje sin vista previa")}</p><div><time dateTime={message.created_at}>{dateTime(message.created_at)}</time><span className={message.status === "failed" ? "wa-failed" : ""}>{messageState[message.status] || "Registrado"}</span></div></article>)}
      </div>
      <form className="wa-composer" onSubmit={async event => { event.preventDefault(); if (canSend && text.trim() && await act({ action: "send", text: text.trim() })) setText(""); }}><label>Mensaje del equipo<textarea value={text} onChange={event => setText(event.target.value)} maxLength={4000} disabled={!canSend || busy || Boolean(pendingAction)} placeholder={canSend ? "Escribe la respuesta al cliente…" : "El envío de mensajes todavía no está habilitado."} required/></label><div><small>{canSend ? "El estado del envío aparecerá en el historial." : conversation.status === "closed" ? "Esta conversación está cerrada." : "Disponible al completar la activación y los permisos del canal."}</small><button className="primary" disabled={!canSend || busy || Boolean(pendingAction) || !text.trim()}>{busy ? "Guardando…" : "Enviar mensaje"}</button></div></form>
      {tasks.length > 0 && <section className="wa-conversation-tasks"><h3>Solicitudes al equipo <span>{tasks.filter(pendingTask).length} pendientes</span></h3>{data.limits?.tasks_truncated && <p className="wa-muted">Se muestran las últimas {data.limits.tasks || 100} solicitudes de esta conversación.</p>}{tasks.map(task => <TaskCard key={task.id} task={task} conversation={conversation} busy={busy || Boolean(pendingAction)} onResolve={(task, answer) => act({ action: "resolve_task", task_id: task.id, answer })}/>)}</section>}
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
  const [selected, setSelected] = useState(null);
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
    {tab === "conversations" && <>{errors.conversations && <div className="wa-error" role="alert">{errors.conversations}</div>}<div className={`wa-workspace ${selected ? "has-selection" : ""}`}><aside className="wa-inbox"><div className="wa-filters"><label>Buscar conversación<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Cliente o mensaje…"/></label><label>Estado<select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Abiertas</option><option value="paused">Atención del equipo</option><option value="all">Todas</option></select></label>{admin && <label>Sede<select value={branch} onChange={event => setBranch(event.target.value)}><option value="all">Todas las sedes</option><option value="">Sin asignar</option>{BRANCHES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div><div className="wa-conversation-list" aria-label="Conversaciones">{loading ? <p className="wa-loading" role="status">Cargando conversaciones…</p> : !filtered.length ? <Empty title={errors.conversations ? "Conversaciones sin cargar" : conversations.length ? "Sin coincidencias" : "Aún no hay conversaciones"}>{errors.conversations ? "Actualiza para volver a consultar." : conversations.length ? "Prueba con otro nombre o filtro." : "Las consultas reales aparecerán aquí cuando el número esté conectado y reciba mensajes."}</Empty> : filtered.map(item => <button key={item.id} className={`wa-conversation-item ${selected === item.id ? "active" : ""}`} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id}><div><b>{customerName(item)}</b><time>{dateTime(item.last_message_at || item.updated_at)}</time></div><p>{item.last_message_preview || "Sin vista previa del último mensaje"}</p><div><small>{branchName(item.branch_id)}</small><span className={`wa-tag ${item.status === "closed" ? "gray" : item.manual_paused ? "amber" : "green"}`}>{item.status === "closed" ? "Cerrada" : item.manual_paused ? "Equipo" : "Abierta"}</span></div></button>)}</div></aside>{selected ? <Conversation key={selected} id={selected} profile={profile} channelStatus={status} onChanged={() => refresh()} onBack={() => setSelected(null)}/> : <div className="wa-unselected"><Empty title="Cada atención, en un solo lugar">Selecciona una conversación para revisar mensajes, pausar la atención automática o responder solicitudes.</Empty></div>}</div></>}
    {tab === "tasks" && <>{errors.tasks && <p className="wa-error" role="alert">{errors.tasks}</p>}<p className="wa-view-help">Aquí verás las consultas que necesitan confirmación de una persona del equipo. Abre la conversación para responder y revisar el contexto.</p>{loading ? <p className="wa-loading" role="status">Cargando solicitudes…</p> : !pending.length ? <Empty title={errors.tasks ? "Solicitudes sin cargar" : "Sin solicitudes pendientes"} symbol="✓">{errors.tasks ? "Actualiza para volver a consultar." : "Las preguntas que necesiten apoyo del equipo aparecerán aquí."}</Empty> : <div className="wa-task-list">{pending.map(task => <article className="wa-task" key={task.id}><div className="wa-task-top"><span className="wa-tag amber">Por responder</span><small>{dateTime(task.created_at)}</small></div><h3>{task.question || "Solicitud de apoyo del equipo"}</h3><p>{branchName(task.branch_id)}</p><button onClick={() => openConversation(task.conversation_id)}>Abrir conversación →</button></article>)}</div>}</>}
    {tab === "integration" && admin && <Integration status={status} error={errors.status}/>}
  </section>;
}
