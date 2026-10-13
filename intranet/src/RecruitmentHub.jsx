import { useCallback, useEffect, useRef, useState } from "react";
import { BRANCHES, formatDateTime } from "./lib/constants.js";
import { isDemoMode } from "./lib/supabase.js";
import { changeVacancyStatus, getApplicationPdfUrl, listApplicationEvents, listApplications, listVacancies, reviewApplication, saveVacancy, subscribeModules } from "./lib/modules-api.js";

const REVIEW_STATUSES = { new: "Nueva", reviewing: "En revisión", contacted: "Contactada", archived: "Archivada" };
const VACANCY_STATUSES = { draft: "Borrador", published: "Publicada", closed: "Cerrada" };
const APPLICATION_BRANCHES = { "santa-lucia": "Santa Lucía · Medellín", niquia: "Niquía · Bello", cualquiera: "Cualquier sede" };
const PAGE_SIZE = 40;

function useAlive() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}

function Dialog({ title, busy, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="mod-dialog" aria-labelledby="recruitment-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><header><div><p className="eyebrow">EQUIPO · IMPORTADOS</p><h2 id="recruitment-dialog-title">{title}</h2></div><button type="button" className="mod-close" disabled={busy} aria-label="Cerrar ventana" onClick={onClose}>×</button></header>{children}</dialog>;
}

function ApplicationDetail({ application, vacancies, onClose, onSave }) {
  const [status, setStatus] = useState(application.review_status || "new");
  const [notes, setNotes] = useState(application.internal_notes || "");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [pdfLink, setPdfLink] = useState("");
  const [events, setEvents] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const alive = useAlive();
  const vacancy = vacancies.find(item => item.id === application.vacancy_id);
  useEffect(() => {
    let active = true;
    listApplicationEvents(application.id).then(items => { if (active) setEvents(items); }).catch(loadError => { if (active) setHistoryError(loadError.message); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [application.id]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(application.id, status, notes); }
    catch (saveError) { if (alive.current) setError(saveError.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function openPdf() {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setOpening(true); setError(""); setPdfLink("");
    try {
      const url = await getApplicationPdfUrl(application.object_path);
      if (popup && !popup.closed) popup.location.replace(url);
      else if (alive.current) setPdfLink(url);
    } catch (openError) { if (popup) popup.close(); if (alive.current) setError(openError.message); }
    finally { if (alive.current) setOpening(false); }
  }
  return <Dialog title={application.name} busy={busy || opening} onClose={onClose}>
    <div className="mod-candidate-summary"><div><small>RADICADO</small><b>{application.receipt}</b><span>{formatDateTime(application.created_at)}</span></div><div><small>SEDE DE INTERÉS</small><b>{APPLICATION_BRANCHES[application.branch] || application.branch}</b><span>{vacancy ? vacancy.title : "Postulación general"}</span></div></div>
    <div className="mod-contact"><span><b>Correo</b>{application.email}</span><span><b>Teléfono</b>{application.phone}</span></div>
    <div className="mod-private-file"><div><b>Hoja de vida privada</b><p>El acceso al PDF caduca en 5 minutos. Comparte los datos sólo con el equipo autorizado de selección.</p></div><button className="secondary" disabled={opening || busy || isDemoMode} onClick={openPdf}>{opening ? "Abriendo PDF…" : "Abrir PDF ↗"}</button>{pdfLink && <a href={pdfLink} target="_blank" rel="noopener noreferrer">El navegador bloqueó la pestaña. Abrir PDF aquí ↗</a>}</div>
    <form className="mod-form" onSubmit={submit}><fieldset disabled={busy || isDemoMode}><label>Seguimiento<select autoFocus value={status} onChange={event => setStatus(event.target.value)}>{Object.entries(REVIEW_STATUSES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Notas internas<textarea rows={5} maxLength={6000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Registra el seguimiento realizado por el equipo." /></label></fieldset>
      <p className="mod-help">Cambiar el estado guarda el seguimiento interno. No envía mensajes, no selecciona personas automáticamente y no elimina el archivo al archivar.</p>
      {error && <p className="mod-error" role="alert">{error}</p>}<footer className="mod-actions"><button type="button" className="secondary" disabled={busy || opening} onClick={onClose}>Cerrar</button><button className="primary" disabled={busy || opening || isDemoMode}>{busy ? "Guardando…" : "Guardar seguimiento"}</button></footer>
    </form>
    <section className="mod-history"><h3>Historial de seguimiento</h3>{historyError && <p className="mod-error" role="alert">{historyError}</p>}{historyLoading ? <p>Cargando historial…</p> : events.length ? events.map(item => <article key={item.id}><b>{item.actor_name || "Administración"} · {REVIEW_STATUSES[item.status_after] || item.status_after}</b><span>{formatDateTime(item.created_at)}</span>{item.internal_notes && <p>{item.internal_notes}</p>}</article>) : <p>Aún no se han registrado cambios de seguimiento.</p>}</section>
  </Dialog>;
}

function VacancyEditor({ vacancy, onClose, onSave }) {
  const [form, setForm] = useState(vacancy || { title: "", branch_id: "", description: "", requirements: "", status: "draft" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useAlive();
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(form); }
    catch (saveError) { if (alive.current) setError(saveError.message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Dialog title={vacancy ? "Editar vacante" : "Crear borrador de vacante"} busy={busy} onClose={onClose}><form className="mod-form" onSubmit={submit}><fieldset disabled={busy || isDemoMode}>
    <label>Nombre del cargo<input autoFocus required minLength={3} maxLength={160} value={form.title} onChange={event => change("title", event.target.value)} /></label>
    <label>Sede<select value={form.branch_id || ""} onChange={event => change("branch_id", event.target.value)}><option value="">Ambas sedes</option>{BRANCHES.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    <label>Descripción y condiciones<textarea rows={5} minLength={10} maxLength={6000} required value={form.description} onChange={event => change("description", event.target.value)} placeholder="Responsabilidades, modalidad y condiciones confirmadas por la tienda." /></label>
    <label>Requisitos<textarea rows={4} maxLength={6000} value={form.requirements || ""} onChange={event => change("requirements", event.target.value)} /></label>
  </fieldset><p className="mod-help">{vacancy?.status === "published" ? "Esta vacante está publicada. Los cambios se reflejarán en la información pública al guardarlos." : "Las nuevas vacantes se guardan como borradores. Publícalas sólo cuando el cargo y sus condiciones estén confirmados."}</p>{error && <p className="mod-error" role="alert">{error}</p>}<footer className="mod-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" disabled={busy || isDemoMode}>{busy ? "Guardando…" : "Guardar vacante"}</button></footer></form></Dialog>;
}

function VacancyAction({ vacancy, status, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useAlive();
  const publishing = status === "published";
  async function confirm() {
    setBusy(true); setError("");
    try { await onConfirm(vacancy.id, status); }
    catch (actionError) { if (alive.current) setError(actionError.message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Dialog title={publishing ? "Publicar vacante" : status === "closed" ? "Cerrar vacante" : "Retirar publicación"} busy={busy} onClose={onClose}><div className="mod-form"><div className="mod-context"><b>{vacancy.title}</b><span>{vacancy.branch_id ? BRANCHES.find(item => item.id === vacancy.branch_id)?.name : "Ambas sedes"}</span></div><p>{publishing ? "Al confirmar, el cargo y sus requisitos serán visibles en la sección de trabajo de Importados. Confirma que la vacante está autorizada y disponible." : "La vacante dejará de aparecer como disponible. Las postulaciones recibidas se conservan para el seguimiento del equipo."}</p>{error && <p className="mod-error" role="alert">{error}</p>}<footer className="mod-actions"><button className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" onClick={confirm} disabled={busy || isDemoMode}>{busy ? "Guardando…" : publishing ? "Confirmar publicación" : "Confirmar cambio"}</button></footer></div></Dialog>;
}

export default function RecruitmentHub({ profile }) {
  const [tab, setTab] = useState("applications");
  const [applications, setApplications] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("all");
  const [branch, setBranch] = useState("all");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const alive = useAlive();
  const generation = useRef(0);
  useEffect(() => { const timer = setTimeout(() => { setTerm(search); setPage(0); }, 300); return () => clearTimeout(timer); }, [search]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [result, items] = await Promise.all([listApplications({ page, pageSize: PAGE_SIZE, status, branch, search: term }), listVacancies()]);
      if (alive.current && generation.current === current) { setApplications(result.items); setTotal(result.total); setVacancies(items); setError(""); }
    } catch (loadError) { if (alive.current && generation.current === current) setError(loadError.message); }
    finally { if (alive.current && generation.current === current) setLoading(false); }
  }, [alive, page, status, branch, term]);
  useEffect(() => {
    if (profile?.role !== "admin") return;
    setLoading(true); void refresh();
    const unsubscribe = subscribeModules(["job_applications", "vacancies"], refresh);
    return () => { generation.current += 1; unsubscribe(); };
  }, [profile?.role, refresh]);
  async function afterSave(message) {
    if (!alive.current) return;
    setNotice(message); setEditor(null); await refresh();
  }
  if (profile?.role !== "admin") return <section className="mod-hub"><div className="mod-empty"><h2>Acceso de administración</h2><p>Las hojas de vida son privadas y están reservadas para el equipo autorizado.</p></div></section>;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <section className="mod-hub">
    <div className="mod-heading"><div><p className="eyebrow">PERSONAS Y OPORTUNIDADES</p><h2>Talento Importados</h2><p>Recibe postulaciones, revisa su seguimiento y gestiona vacantes confirmadas.</p></div><button className="primary" disabled={isDemoMode} onClick={() => setEditor({ type: "vacancy", item: null })}>+ Crear vacante</button></div>
    {isDemoMode && <p className="mod-info">Demostración: no se muestran hojas de vida reales ni se guardan cambios.</p>}
    <div className="mod-tabs" aria-label="Secciones de talento"><button className={tab === "applications" ? "active" : ""} aria-pressed={tab === "applications"} onClick={() => setTab("applications")}>Hojas de vida</button><button className={tab === "vacancies" ? "active" : ""} aria-pressed={tab === "vacancies"} onClick={() => setTab("vacancies")}>Vacantes <span>{vacancies.length}</span></button><a href="https://tiendasimportados.com/trabaja-con-nosotros/" target="_blank" rel="noopener noreferrer">Ver página de postulaciones ↗</a></div>
    {error && <div className="mod-error" role="alert">{error}<button onClick={refresh}>Reintentar</button></div>}{notice && <p className="mod-success" role="status">{notice}</p>}
    {tab === "applications" ? <><div className="mod-filters mod-recruitment-filters"><label><span className="sr-only">Buscar postulaciones</span><input type="search" maxLength={160} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nombre, radicado o correo" /></label><label><span className="sr-only">Estado de revisión</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="all">Todos los estados</option>{Object.entries(REVIEW_STATUSES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label><span className="sr-only">Sede de interés</span><select value={branch} onChange={event => { setBranch(event.target.value); setPage(0); }}><option value="all">Todas las sedes</option>{Object.entries(APPLICATION_BRANCHES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label></div>
      <p className="mod-help">Sólo aparecen postulaciones con recepción confirmada y PDF disponible. Los estados describen el seguimiento del equipo; no se evalúan perfiles automáticamente.</p>
      {loading ? <div className="mod-empty"><p>Cargando postulaciones…</p></div> : applications.length ? <div className="mod-application-list">{applications.map(item => <button key={item.id} className="mod-application-row" onClick={() => setEditor({ type: "application", item })}><div className="mod-person-avatar" aria-hidden="true">{item.name.slice(0, 1)}</div><div><b>{item.name}</b><small>{item.email}</small></div><div><b>{APPLICATION_BRANCHES[item.branch] || item.branch}</b><small>{item.receipt} · {formatDateTime(item.created_at)}</small></div><span className={`mod-tag ${item.review_status === "new" ? "yellow" : item.review_status === "archived" ? "gray" : "blue"}`}>{REVIEW_STATUSES[item.review_status] || "Nueva"}</span><span aria-hidden="true">↗</span></button>)}</div> : <div className="mod-empty"><span aria-hidden="true">↗</span><h3>{search || status !== "all" || branch !== "all" ? "No hay postulaciones con estos filtros" : "Aquí empieza el próximo equipo"}</h3><p>Las hojas de vida recibidas desde la landing aparecerán aquí. El PDF permanece privado.</p></div>}
      <nav className="mod-pagination" aria-label="Páginas de postulaciones"><span>{total} postulaciones · página {Math.min(page + 1, pages)} de {pages}</span><div><button className="secondary" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Anterior</button><button className="secondary" disabled={page + 1 >= pages || loading} onClick={() => setPage(value => value + 1)}>Siguiente</button></div></nav>
    </> : loading ? <div className="mod-empty"><p>Cargando vacantes…</p></div> : vacancies.length ? <div className="mod-vacancy-grid">{vacancies.map(item => <article key={item.id}><header><span className={`mod-tag ${item.status === "published" ? "green" : item.status === "draft" ? "yellow" : "gray"}`}>{VACANCY_STATUSES[item.status] || item.status}</span><small>{item.branch_id ? BRANCHES.find(value => value.id === item.branch_id)?.name || "Sede" : "Ambas sedes"}</small></header><h3>{item.title}</h3><p>{item.description}</p>{item.requirements && <details><summary>Requisitos</summary><p>{item.requirements}</p></details>}<small>Creada {formatDateTime(item.created_at)}</small><footer><button className="secondary" onClick={() => setEditor({ type: "vacancy", item })}>Editar</button>{item.status === "published" ? <button className="secondary" onClick={() => setEditor({ type: "action", item, status: "closed" })}>Cerrar vacante</button> : <button className="primary" onClick={() => setEditor({ type: "action", item, status: "published" })}>{item.status === "closed" ? "Reabrir y publicar" : "Publicar"}</button>}{item.status === "published" && <button className="mod-text-button" onClick={() => setEditor({ type: "action", item, status: "draft" })}>Volver a borrador</button>}</footer></article>)}</div> : <div className="mod-empty"><h3>Aún no hay vacantes publicadas</h3><p>Crea un borrador cuando tengas un cargo y sus condiciones confirmados. La postulación general sigue disponible.</p></div>}
    {editor?.type === "application" && <ApplicationDetail application={editor.item} vacancies={vacancies} onClose={() => setEditor(null)} onSave={async (id, value, notes) => { await reviewApplication(id, value, notes); await afterSave("Seguimiento guardado. No se ha enviado ningún mensaje al postulante."); }} />}
    {editor?.type === "vacancy" && <VacancyEditor vacancy={editor.item} onClose={() => setEditor(null)} onSave={async form => { await saveVacancy(form); await afterSave(form.id ? "Vacante actualizada." : "Borrador creado. Revisa su contenido antes de publicarlo."); }} />}
    {editor?.type === "action" && <VacancyAction vacancy={editor.item} status={editor.status} onClose={() => setEditor(null)} onConfirm={async (id, value) => { await changeVacancyStatus(id, value); await afterSave(value === "published" ? "Vacante publicada." : "Publicación retirada. Las postulaciones se conservan."); }} />}
  </section>;
}
