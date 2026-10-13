import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "./lib/constants.js";
import { isDemoMode } from "./lib/supabase.js";
import { listPqrsCases, listPqrsEvents, subscribeModules, updatePqrsCase } from "./lib/modules-api.js";

const TYPES = { peticion: "Petición", queja: "Queja", reclamo: "Reclamo", sugerencia: "Sugerencia", felicitacion: "Felicitación" };
const STATUSES = {
  received: { label: "Recibida", tone: "blue" }, in_review: { label: "En revisión", tone: "yellow" },
  awaiting_information: { label: "Esperando información", tone: "gray" }, completed: { label: "Completada", tone: "green" },
  closed: { label: "Cerrada", tone: "dark" }
};
function Status({ value }) { const item = STATUSES[value] || { label: value, tone: "gray" }; return <span className={`mod-tag ${item.tone}`}>{item.label}</span>; }

function CaseDetail({ item, onClose, onUpdated }) {
  const dialog = useRef(null);
  const alive = useRef(true);
  const [selected, setSelected] = useState(item);
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.internal_notes || "");
  const [response, setResponse] = useState("");
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    element.showModal();
    async function loadEvents() {
      try { const data = await listPqrsEvents(item.id); if (alive.current) { setEvents(data); setLoadingEvents(false); } }
      catch (loadError) { if (alive.current) { setError(loadError.message); setLoadingEvents(false); } }
    }
    void loadEvents();
    const unsubscribe = subscribeModules(["pqrs_case_events"], loadEvents);
    return () => { alive.current = false; unsubscribe(); element.close(); };
  }, [item.id]);
  async function save(withResponse) {
    if (withResponse && !response.trim()) { setError("Escribe la respuesta que podrá consultar el cliente."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await updatePqrsCase(item.id, { status, internal_notes: notes, response_message: withResponse ? response : "" });
      if (!alive.current) return;
      const updated = { ...selected, ...result.case };
      setSelected(updated); setResponse("");
      setNotice(withResponse ? "Respuesta registrada y disponible para la consulta del cliente. No se ha enviado correo ni WhatsApp." : "Gestión actualizada.");
      onUpdated(updated);
      try { const history = await listPqrsEvents(item.id); if (alive.current) setEvents(history); }
      catch { if (alive.current) setError("El cambio quedó guardado, pero no pudimos actualizar el historial. Vuelve a abrir el caso para consultarlo."); }
    } catch (saveError) { if (alive.current) setError(saveError.message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="mod-dialog mod-pqrs-detail" aria-labelledby="pqrs-detail-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><p className="eyebrow">{TYPES[selected.type] || selected.type} · IMPORTADOS</p><h2 id="pqrs-detail-title">{selected.case_number}</h2></div><button className="mod-close" aria-label="Cerrar detalle de PQRS" disabled={busy} onClick={onClose}>×</button></header>
    <div className="mod-candidate-summary"><div><small>CLIENTE</small><b>{selected.customer_name}</b><span>{selected.customer_email}</span>{selected.customer_phone && <span>{selected.customer_phone}</span>}</div><div><small>SEDE</small><b>{selected.branch?.name || "General"}</b><Status value={selected.status} /><span>{formatDateTime(selected.created_at)}</span></div></div>
    <article className="mod-message"><small>ASUNTO</small><h3>{selected.subject}</h3><p>{selected.description}</p></article>
    {selected.response_message && <article className="mod-message mod-saved-response"><small>ÚLTIMA RESPUESTA DISPONIBLE PARA EL CLIENTE</small><p>{selected.response_message}</p></article>}
    <p className="mod-help">Los adjuntos de PQRS no están habilitados en esta primera versión.</p>
    <form className="mod-form" onSubmit={event => { event.preventDefault(); void save(false); }}><fieldset disabled={busy || isDemoMode}><div className="mod-form-grid"><label>Estado<select autoFocus value={status} onChange={event => setStatus(event.target.value)}>{Object.entries(STATUSES).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select></label><label>Notas internas<textarea maxLength={6000} rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Información reservada para el equipo." /></label></div><label>Nueva respuesta para el cliente<textarea rows={5} maxLength={10000} value={response} onChange={event => setResponse(event.target.value)} placeholder="Escribe una respuesta clara, cercana y respetuosa." /></label></fieldset>
      <p className="mod-help">Al registrar una respuesta, el cliente puede verla con su radicado y código privado en la consulta pública. Los avisos por correo y WhatsApp no están configurados.</p>
      {error && <p className="mod-error" role="alert">{error}</p>}{notice && <p className="mod-success" role="status">{notice}</p>}
      <footer className="mod-actions"><button className="secondary" disabled={busy || isDemoMode}>Guardar gestión</button><button className="primary" type="button" disabled={busy || isDemoMode} onClick={() => save(true)}>{busy ? "Guardando…" : "Registrar respuesta"}</button></footer>
    </form>
    <section className="mod-history"><h3>Historial de atención</h3>{loadingEvents ? <p>Cargando historial…</p> : events.length ? events.map(event => <article key={event.id}><b>{event.actor_name || "Importados"}</b><span>{formatDateTime(event.created_at)}{event.status_after ? ` · ${STATUSES[event.status_after]?.label || event.status_after}` : ""}</span><p>{event.message}</p>{event.response_message && <p className="mod-history-response">{event.response_message}</p>}</article>) : <p>Este caso aún no registra gestiones del equipo.</p>}</section>
  </dialog>;
}

export default function PqrsHub({ profile }) {
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const fetching = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try { const data = await listPqrsCases(); if (alive.current) { setCases(data); setError(""); } }
    catch (loadError) { if (alive.current) setError(loadError.message); }
    finally { fetching.current = false; if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (profile?.role !== "admin") return;
    void refresh(); return subscribeModules(["pqrs_cases"], refresh);
  }, [profile?.role, refresh]);
  const filtered = useMemo(() => cases.filter(item => {
    const term = search.trim().toLowerCase();
    const matches = !term || `${item.case_number} ${item.customer_name} ${item.customer_email} ${item.subject}`.toLowerCase().includes(term);
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? !["closed", "completed"].includes(item.status) : item.status === statusFilter);
    return matches && matchesStatus;
  }), [cases, search, statusFilter]);
  if (profile?.role !== "admin") return <section className="mod-hub"><div className="mod-empty"><h2>Acceso de administración</h2><p>La información de atención al cliente está reservada para el equipo autorizado.</p></div></section>;
  return <section className="mod-hub mod-pqrs-hub"><div className="mod-heading"><div><p className="eyebrow">SERVICIO AL CLIENTE</p><h2>PQRS <span>{filtered.length}</span></h2><p>Una atención cercana, respetuosa y con seguimiento.</p></div><a className="mod-public-link" href="https://tiendasimportados.com/?pqrs=radicar#pqrs" target="_blank" rel="noopener noreferrer">Ver formulario público ↗</a></div>
    {isDemoMode && <p className="mod-info">Demostración: esta vista no contiene casos reales y no guarda respuestas.</p>}
    <div className="mod-filters"><label><span className="sr-only">Buscar PQRS</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar radicado, cliente o asunto" /></label><label><span className="sr-only">Filtrar por estado</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="active">Pendientes</option><option value="all">Todas</option>{Object.entries(STATUSES).map(([value, item]) => <option value={value} key={value}>{item.label}</option>)}</select></label><button className="secondary" onClick={refresh} disabled={loading}>Actualizar</button></div>
    {error && <div className="mod-error" role="alert">{error}<button onClick={refresh}>Reintentar</button></div>}
    {loading ? <div className="mod-empty"><p>Cargando PQRS…</p></div> : filtered.length ? <div className="mod-pqrs-list">{filtered.map(item => <button className="mod-pqrs-row" key={item.id} onClick={() => setSelected(item)}><div><b>{item.case_number}</b><small>{formatDateTime(item.created_at)}</small></div><div><b>{item.customer_name}</b><small>{item.customer_email}</small></div><div><span className="mod-type">{TYPES[item.type] || item.type}</span><strong>{item.subject}</strong></div><div><small>{item.branch?.name || "General"}</small><Status value={item.status} /></div><span aria-hidden="true">↗</span></button>)}</div> : <div className="mod-empty"><span aria-hidden="true">✓</span><h3>No hay PQRS en esta vista</h3><p>Los nuevos radicados aparecerán aquí. Puedes ampliar el filtro para consultar los casos completados.</p></div>}
    {selected && <CaseDetail item={selected} onClose={() => setSelected(null)} onUpdated={updated => setCases(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item))} />}
  </section>;
}
