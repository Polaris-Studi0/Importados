import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRANCHES, formatDateTime, formatMoney } from "./lib/constants.js";
import { isDemoMode } from "./lib/supabase.js";
import { getProductImageUrl, listCommerce, listInventoryEvents, saveKnowledge, saveProduct, setInventory, subscribeModules, uploadProductImage } from "./lib/modules-api.js";

function useAlive() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}

function Dialog({ title, busy, onClose, children }) {
  const ref = useRef(null);
  const titleId = "commerce-dialog-title";
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="mod-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><p className="eyebrow">ADMINISTRACIÓN · IMPORTADOS</p><h2 id={titleId}>{title}</h2></div><button type="button" className="mod-close" aria-label="Cerrar ventana" onClick={onClose} disabled={busy}>×</button></header>
    {children}
  </dialog>;
}

function ProductImage({ path, name }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    async function refresh() {
      try { const value = await getProductImageUrl(path); if (active) setUrl(value); }
      catch { if (active) setUrl(""); }
    }
    setUrl("");
    if (path) void refresh();
    const timer = path ? setInterval(refresh, 240000) : null;
    return () => { active = false; if (timer) clearInterval(timer); };
  }, [path]);
  return url ? <img className="mod-product-image" src={url} alt={name} onError={() => setUrl("")} /> : <div className="mod-product-placeholder" aria-label={path ? "Vista previa no disponible" : "Sin foto"}><span>{name?.slice(0, 1) || "+"}</span><small>{path ? "Sin vista previa" : "Sin foto"}</small></div>;
}

function ProductEditor({ product, onClose, onSave }) {
  const [form, setForm] = useState(product || { name: "", sku: "", category: "", description: "", price: "", active: true, storage_path: null });
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useAlive();
  useEffect(() => {
    if (!photo) { setPreview(""); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(form, photo); }
    catch (saveError) { if (alive.current) setError(saveError.message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Dialog title={product ? "Editar producto" : "Nuevo producto"} busy={busy} onClose={onClose}><form className="mod-form" onSubmit={submit}>
    <fieldset disabled={busy || isDemoMode}>
      <div className="mod-form-grid"><label>Nombre<input autoFocus required minLength={2} maxLength={160} value={form.name} onChange={event => change("name", event.target.value)} /></label><label>Referencia / SKU<input maxLength={80} value={form.sku || ""} onChange={event => change("sku", event.target.value)} /></label><label>Categoría<input maxLength={100} value={form.category || ""} onChange={event => change("category", event.target.value)} /></label><label>Precio al detal (COP)<input type="number" min="0" max="999999999" step="1" required value={form.price} onChange={event => change("price", event.target.value)} /></label></div>
      <label>Descripción<textarea maxLength={3000} value={form.description || ""} onChange={event => change("description", event.target.value)} /></label>
      <div className="mod-photo-editor">{preview ? <img src={preview} alt="Vista previa de la foto elegida" /> : <ProductImage path={form.storage_path} name={form.name} />}<label>Foto del producto<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { setPhoto(event.target.files?.[0] || null); setError(""); }} /><small>JPG, PNG o WebP · máximo 5 MB. Almacenamiento privado.</small></label></div>
      <label className="mod-check"><input type="checkbox" checked={form.active} onChange={event => change("active", event.target.checked)} />Producto activo</label>
    </fieldset>
    {error && <p className="mod-error" role="alert">{error}</p>}
    <p className="mod-help">Este catálogo es interno. Guardar un producto no lo publica en la landing.</p>
    <footer className="mod-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" disabled={busy || isDemoMode}>{busy ? "Guardando…" : "Guardar producto"}</button></footer>
  </form></Dialog>;
}

function StockEditor({ product, stock, branch, onClose, onSave }) {
  const [quantity, setQuantity] = useState(String(stock?.quantity || 0));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useAlive();
  useEffect(() => {
    let active = true;
    listInventoryEvents(product.id, branch.id).then(items => { if (active) setEvents(items); }).catch(loadError => { if (active) setError(loadError.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [product.id, branch.id]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(product.id, branch.id, quantity); }
    catch (saveError) { if (alive.current) setError(saveError.message); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Dialog title="Actualizar existencias" busy={busy} onClose={onClose}><form className="mod-form" onSubmit={submit}>
    <div className="mod-context"><b>{product.name}</b><span>{branch.name} · {product.sku || "Sin referencia"}</span></div>
    <label>Cantidad disponible<input autoFocus type="number" min="0" max="100000000" step="1" required value={quantity} onChange={event => setQuantity(event.target.value)} disabled={busy || isDemoMode} /></label>
    <p className="mod-help">Ingresa el conteo total disponible en esta sede. El ajuste conserva el valor anterior y quién lo realizó. El registro de pedidos no descuenta estas existencias automáticamente.</p>
    {error && <p className="mod-error" role="alert">{error}</p>}
    <footer className="mod-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" disabled={busy || isDemoMode}>{busy ? "Guardando…" : "Confirmar conteo"}</button></footer>
  </form><section className="mod-history"><h3>Últimos ajustes</h3>{loading ? <p>Cargando historial…</p> : events.length ? events.map(item => <article key={item.id}><b>{item.before_quantity} → {item.after_quantity} unidades</b><span>{item.actor_name || "Administración"} · {formatDateTime(item.created_at)}</span></article>) : <p>Aún no se han registrado ajustes.</p>}</section></Dialog>;
}

function KnowledgeEditor({ item, onClose, onSave }) {
  const [form, setForm] = useState(item || { branch_id: "", topic: "", content: "", active: true });
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
  return <Dialog title={item ? "Editar información" : "Nueva información"} busy={busy} onClose={onClose}><form className="mod-form" onSubmit={submit}><fieldset disabled={busy || isDemoMode}>
    <label>Tema<input autoFocus required minLength={2} maxLength={160} value={form.topic} onChange={event => change("topic", event.target.value)} placeholder="Por ejemplo: cambios o disponibilidad" /></label>
    <label>Aplica a<select value={form.branch_id || ""} onChange={event => change("branch_id", event.target.value)}><option value="">Todas las sedes</option>{BRANCHES.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    <label>Información aprobada<textarea required maxLength={6000} rows={6} value={form.content} onChange={event => change("content", event.target.value)} /></label>
    <label className="mod-check"><input type="checkbox" checked={form.active} onChange={event => change("active", event.target.checked)} />Información vigente</label>
  </fieldset>{error && <p className="mod-error" role="alert">{error}</p>}<p className="mod-help">Registra únicamente condiciones confirmadas por la tienda. Esta información sirve como referencia del equipo; no envía mensajes automáticamente.</p><footer className="mod-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary" disabled={busy || isDemoMode}>{busy ? "Guardando…" : "Guardar información"}</button></footer></form></Dialog>;
}

export default function CommerceHub({ profile }) {
  const [tab, setTab] = useState("catalogue");
  const [data, setData] = useState({ products: [], inventory: [], knowledge: [] });
  const [branchId, setBranchId] = useState(BRANCHES[0]?.id || "");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const alive = useAlive();
  const fetching = useRef(false);
  const refresh = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try { const next = await listCommerce(); if (alive.current) { setData(next); setError(""); } }
    catch (loadError) { if (alive.current) setError(loadError.message); }
    finally { fetching.current = false; if (alive.current) setLoading(false); }
  }, [alive]);
  useEffect(() => {
    if (profile?.role !== "admin") return;
    void refresh();
    return subscribeModules(["products", "branch_inventory", "branch_knowledge"], refresh);
  }, [profile?.role, refresh]);
  const branch = BRANCHES.find(item => item.id === branchId) || BRANCHES[0];
  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    return data.products.filter(item => !term || `${item.name} ${item.sku || ""} ${item.category || ""}`.toLowerCase().includes(term));
  }, [data.products, search]);
  const knowledge = useMemo(() => data.knowledge.filter(item => (!item.branch_id || item.branch_id === branchId) && (!search.trim() || `${item.topic} ${item.content}`.toLowerCase().includes(search.trim().toLowerCase()))), [data.knowledge, branchId, search]);
  async function reloadAfterSave(message) {
    if (!alive.current) return;
    setEditor(null); setNotice(message); setError("");
    try { const next = await listCommerce(); if (alive.current) setData(next); }
    catch { if (alive.current) setError("El cambio quedó guardado, pero no pudimos actualizar esta vista. Pulsa Actualizar para volver a consultarla."); }
  }
  async function saveProductWithPhoto(form, photo) {
    const uploadedPath = photo ? await uploadProductImage(photo) : null;
    await saveProduct({ ...form, storage_path: uploadedPath || form.storage_path });
    await reloadAfterSave("Producto guardado en el catálogo interno.");
  }
  if (profile?.role !== "admin") return <section className="mod-hub"><div className="mod-empty"><h2>Acceso de administración</h2><p>Este módulo está reservado para el equipo administrador.</p></div></section>;
  return <section className="mod-hub">
    <div className="mod-heading"><div><p className="eyebrow">PRODUCTOS Y OPERACIÓN</p><h2>Catálogo e inventario</h2><p>Una referencia común para Santa Lucía y Niquía.</p></div><button className="primary" disabled={isDemoMode} onClick={() => { setNotice(""); setEditor({ type: tab === "knowledge" ? "knowledge" : "product", item: null }); }}>{tab === "knowledge" ? "+ Nueva información" : "+ Nuevo producto"}</button></div>
    {isDemoMode && <p className="mod-info">Demostración: esta vista está vacía y los cambios están desactivados. No contiene inventario real.</p>}
    <div className="mod-tabs" aria-label="Secciones de productos">{[["catalogue", "Catálogo"], ["inventory", "Inventario por sede"], ["knowledge", "Información de sedes"]].map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => { setTab(id); setSearch(""); }}>{label}</button>)}</div>
    <div className="mod-filters"><label><span className="sr-only">Buscar {tab === "knowledge" ? "información" : "producto"}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={tab === "knowledge" ? "Buscar tema o contenido" : "Buscar nombre, referencia o categoría"} /></label>{tab !== "catalogue" && <label><span className="sr-only">Sede</span><select value={branchId} onChange={event => setBranchId(event.target.value)}>{BRANCHES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<button className="secondary" onClick={refresh} disabled={loading}>Actualizar</button></div>
    {error && <div className="mod-error" role="alert">{error}<button onClick={refresh}>Reintentar</button></div>}{notice && <p className="mod-success" role="status">{notice}</p>}
    {loading ? <div className="mod-empty"><p>Cargando productos…</p></div> : tab === "knowledge" ? <div className="mod-knowledge-list">{knowledge.length ? knowledge.map(item => <article key={item.id}><div><span className="mod-tag">{item.branch_id ? BRANCHES.find(value => value.id === item.branch_id)?.name || "Sede" : "Todas las sedes"}</span><span className={`mod-tag ${item.active ? "green" : "gray"}`}>{item.active ? "Vigente" : "Inactiva"}</span></div><h3>{item.topic}</h3><p>{item.content}</p><button className="secondary" onClick={() => setEditor({ type: "knowledge", item })}>Editar información</button></article>) : <div className="mod-empty"><h3>Información por confirmar</h3><p>Agrega horarios, políticas y respuestas aprobadas para que el equipo trabaje con la misma información.</p></div>}</div> : products.length ? tab === "catalogue" ? <div className="mod-product-grid">{products.map(product => <article key={product.id}><ProductImage path={product.storage_path} name={product.name} /><div className="mod-product-content"><span className={`mod-tag ${product.active ? "green" : "gray"}`}>{product.active ? "Activo" : "Inactivo"}</span><h3>{product.name}</h3><p>{product.sku || "Sin referencia"} · {product.category || "Sin categoría"}</p><strong>{formatMoney(product.price)}</strong><button className="secondary" onClick={() => setEditor({ type: "product", item: product })}>Editar producto</button></div></article>)}</div> : <div className="mod-inventory-list"><div className="mod-list-head"><span>Producto</span><span>Disponible · {branch?.name}</span><span>Último conteo</span><span /></div>{products.map(product => { const stock = data.inventory.find(item => item.product_id === product.id && item.branch_id === branchId); return <article key={product.id}><div><b>{product.name}</b><small>{product.sku || "Sin referencia"}{!product.active ? " · Inactivo" : ""}</small></div><div><strong>{stock ? stock.quantity : "—"}</strong><small>{stock ? "unidades registradas" : "Sin conteo registrado"}</small></div><small>{stock ? formatDateTime(stock.updated_at) : "Pendiente de confirmar"}</small><button className="secondary" disabled={!product.active} title={!product.active ? "Activa el producto antes de registrar existencias." : undefined} onClick={() => setEditor({ type: "stock", item: product, stock, branch })}>Actualizar conteo</button></article>; })}</div> : <div className="mod-empty"><h3>{search ? "No encontramos coincidencias" : "Empieza con tus productos reales"}</h3><p>{search ? "Prueba otra referencia o nombre." : "Crea un producto y confirma las existencias de cada sede. No hemos cargado productos de ejemplo."}</p></div>}
    {editor?.type === "product" && <ProductEditor product={editor.item} onClose={() => setEditor(null)} onSave={saveProductWithPhoto} />}
    {editor?.type === "stock" && <StockEditor product={editor.item} stock={editor.stock} branch={editor.branch} onClose={() => setEditor(null)} onSave={async (productId, id, quantity) => { await setInventory(id, productId, quantity); await reloadAfterSave("Conteo actualizado y ajuste registrado."); }} />}
    {editor?.type === "knowledge" && <KnowledgeEditor item={editor.item} onClose={() => setEditor(null)} onSave={async form => { await saveKnowledge(form); await reloadAfterSave("Información guardada."); }} />}
  </section>;
}
