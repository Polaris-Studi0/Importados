import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isDemoMode, isConfigured, initialAuthFlow } from "./lib/supabase.js";
import { BRANCHES, STATUS, PAYMENT, formatMoney, formatDateTime } from "./lib/constants.js";
import { getPaymentReceiptUrl, getProfile, listCouriers, listEvents, listOrders, listStaff, saveCourier, saveOrder, saveStaff, signIn, signOut, subscribeToOrders, transitionOrder, uploadPaymentReceipt } from "./lib/api.js";
import CommerceHub from "./CommerceHub.jsx";
import RecruitmentHub from "./RecruitmentHub.jsx";
import TeamHub from "./TeamHub.jsx";
import PasswordSetup from "./PasswordSetup.jsx";
import {useModalFocus} from "./lib/modal-focus.js";
import PqrsHub from "./PqrsHub.jsx";
import BranchChat from "./BranchChat.jsx";
import useBranchChat from "./useBranchChat.js";
import { observeAuthProfile } from "./lib/auth-profile.js";

const demoProfiles = {
  admin: { id:"demo-admin", full_name:"Administración · Demo", role:"admin", branch_id:null, branch:null },
  cashier: { id:"demo-cashier", full_name:"Caja · Demo", role:"cashier", branch_id:"santa-lucia", branch:BRANCHES[0] }
};

function Login({ onDemoLogin, accessError, onRetry }){
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [notice,setNotice]=useState("");
  async function recover(){if(!email){setError("Escribe tu correo para solicitar un enlace de acceso.");return;}setBusy(true);setError("");try{const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});if(error)throw error;setNotice("Si el correo tiene acceso, recibirás un enlace para configurar tu contraseña.");}catch{setError("No pudimos solicitar el enlace. Espera unos minutos o contacta a administración.");}finally{setBusy(false);}}
  async function submit(event){
    event.preventDefault(); setBusy(true); setError("");
    try { await signIn(email,password); }
    catch (loginError){ setError(loginError.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : loginError.message); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-brand"><svg className="importados-logo" viewBox="250 190 1200 510" role="img" aria-label="Importados"><image href="/logo.png" width="1676" height="939"/></svg><p className="login-tag">EL EQUIPO DETRÁS DE CADA VISITA</p><h1>Todo en<br/>su lugar.</h1><span>Dos sedes. Un mismo equipo.<br/>Tu espacio para coordinar, atender y crecer.</span></section>
    <section className="login-card">
      <p className="eyebrow">ACCESO SEGURO</p><h2>Bienvenido</h2><p>Ingresa a tu espacio de trabajo en Importados.</p>
      {isDemoMode ? <div className="demo-access">
        <div className="demo-notice"><b>Modo demostración</b><span>Conecta Supabase para activar usuarios y datos reales.</span></div>
        <button className="primary" onClick={()=>onDemoLogin(demoProfiles.admin)}>Entrar como administrador <span>→</span></button>
        <button className="secondary" onClick={()=>onDemoLogin(demoProfiles.cashier)}>Entrar como caja · Santa Lucía</button>
      </div> : <form onSubmit={submit}>
        {!isConfigured&&<p className="form-error">El acceso aún no está configurado. Comunícate con administración.</p>}
        <label>Correo<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required /></label>
        <label>Contraseña<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {(error||accessError) && <p className="form-error" role="alert">{error||accessError}</p>}
        {accessError&&onRetry&&<button type="button" className="secondary" onClick={onRetry}>Volver a intentar cargar mi acceso</button>}
        <button className="primary" disabled={busy||!isConfigured}>{busy ? "Ingresando…" : "Ingresar"}<span>→</span></button><button className="login-recover" type="button" disabled={busy||!isConfigured} onClick={recover}>Configurar o recuperar mi contraseña</button>{notice&&<p className="form-note" role="status">{notice}</p>}
      </form>}
    </section>
  </main>;
}

function StatusPill({ status }){
  const value = STATUS[status] || {label:status,tone:"gray"};
  return <span className={`status-pill ${value.tone}`}><i />{value.label}</span>;
}

function Sidebar({ profile, page, setPage, onLogout, chatUnread }){
  const admin = profile.role === "admin";
  const items = admin
    ? [["orders","Pedidos","↗"],["new","Nuevo pedido","+"],["commerce","Catálogo e inventario","▦"],["recruitment","Talento y vacantes","◇"],["pqrs","Servicio al cliente","◎"],["staff","Personal de caja","◉"],["couriers","Domiciliarios","→"],["audit","Trazabilidad","≡"],["internalChat","Chat con sedes","↔"],["team","Accesos del equipo","⊕"]]
    : [["orders","Pedidos de sede","01"],["ready","Por despacho","02"],["history","Historial","03"],["internalChat","Administración","04"]];
  return <aside className="sidebar">
    <div className="brand"><svg className="importados-logo" viewBox="250 190 1200 510" role="img" aria-label="Importados"><image href="/logo.png" width="1676" height="939"/></svg><div><strong>INTRANET</strong><small>Tendencias sin fronteras</small></div></div>
    <p className="workspace-label">{admin ? "ADMINISTRACIÓN" : "OPERACIÓN DE CAJA"}</p>
    <nav>{items.map(([id,label,index])=><button key={id} className={page===id?"active":""} onClick={()=>setPage(id)}><i>{index}</i>{label}{id==="internalChat"&&chatUnread>0&&<span className="chat-unread">{chatUnread}</span>}</button>)}</nav>
    <div className="sidebar-footer"><div className="live"><i/><span><b>Sistema activo</b><small>Actualización automática</small></span></div><button className="logout" onClick={onLogout}>Cerrar sesión</button></div>
  </aside>;
}

function courierFor(order,couriers){
  const saved=order.courier||couriers.find(item=>item.id===order.courier_id);
  if(saved)return saved;
  if(!order.courier_name)return null;
  return {name:order.courier_name,plate:order.courier_plate||"Sin placa",phone:order.courier_phone||"Sin teléfono",provider:order.courier_provider||"Servicio externo",temporary:true};
}

function CashierOrders({ orders, couriers, onOpen, onTransition, onHandoff }){
  const time = value=>new Intl.DateTimeFormat("es-CO",{hour:"numeric",minute:"2-digit"}).format(new Date(value));
  if(!orders.length) return <div className="cashier-empty"><span>✓</span><h3>Todo al día</h3><p>No hay pedidos que coincidan con esta vista.</p></div>;
  return <div className="cashier-order-list">{orders.map(order=>{
    const courier=courierFor(order,couriers);
    const canReady=order.status==="preparing";
    const canDispatch=order.status==="ready"&&order.fulfillment_type==="delivery"&&courier;
    const canPickup=order.status==="ready"&&order.fulfillment_type==="pickup";
    return <article className={`cashier-order-card ${order.status}`} key={order.id}>
      <button className="cashier-thumb" onClick={()=>onOpen(order)} aria-label={`Ver detalle ${order.order_number}`}><span>{order.items.length}</span><small>PRODUCTOS</small></button>
      <div className="cashier-time"><small>HOY</small><strong>{time(order.created_at)}</strong><span>{formatDateTime(order.created_at).split(",")[0]}</span></div>
      <div className="cashier-products"><StatusPill status={order.status}/><p>#{order.order_number} · {order.fulfillment_type==="pickup"?"RECOGIDA":"DOMICILIO"}</p><ul>{order.items.map((item,index)=><li key={`${item.name}-${index}`}><b>{item.qty}×</b>{item.name}</li>)}</ul><div className="cashier-meta"><strong>{formatMoney(Number(order.total||0)+Number(order.delivery_fee||0))}</strong><span>{PAYMENT[order.payment_method]}</span></div></div>
      <div className="cashier-destination"><small>{order.fulfillment_type==="pickup"?"RECOGE EN":"ENTREGA"}</small><strong>{order.fulfillment_type==="pickup"?order.branch?.name:order.delivery_zone}</strong><span>{order.fulfillment_type==="pickup"?order.customer_name:order.delivery_address}</span>{order.fulfillment_type==="delivery"&&(courier?<div className="cashier-courier assigned"><small>DOMICILIARIO ASIGNADO</small><b>{courier.name}</b><span>Placa {courier.plate}{order.eta_minutes?` · ${order.eta_minutes} min`:""}</span></div>:<div className="cashier-courier waiting"><small>DOMICILIARIO</small><b>Por asignar</b><span>Administración confirmará la asignación</span></div>)}<button onClick={()=>onOpen(order)}>Ver detalle</button></div>
      <div className="cashier-action">{canReady&&<button onClick={()=>onTransition(order,"ready")}>Listo para despacho <span>→</span></button>}{canDispatch&&<button onClick={()=>onHandoff(order,"dispatch")}>Entregado al domiciliario <span>→</span></button>}{canPickup&&<button onClick={()=>onHandoff(order,"pickup")}>Entregado al cliente <span>→</span></button>}{order.status==="ready"&&order.fulfillment_type==="delivery"&&!courier&&<button disabled>Esperando domiciliario <span>···</span></button>}{["dispatched","delivered"].includes(order.status)&&<div className="cashier-done"><span>✓</span><b>{order.status==="delivered"?"Entregado":"Despachado"}</b></div>}</div>
    </article>;
  })}</div>;
}

function Header({ profile, onLogout, page }){
  return <header className="topbar"><div><p className="eyebrow">CENTRO DE OPERACIONES</p><h1>{profile.role === "admin" ? ({orders:"Control de pedidos",commerce:"Catálogo e inventario",recruitment:"Talento y vacantes",pqrs:"Servicio al cliente",staff:"Personal de caja",couriers:"Domiciliarios",audit:"Trazabilidad",internalChat:"Chat con sedes",team:"Accesos del equipo"}[page]||"Centro de operaciones") : profile.branch?.name}</h1></div><button className="profile" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión"><span>{profile.full_name.split(" ").map(part=>part[0]).slice(0,2).join("")}</span><div><b>{profile.full_name}</b><small>{profile.role === "admin" ? "Administrador" : "Responsable de caja"}</small></div></button></header>;
}

function Summary({ orders }){
  const count = status => orders.filter(order=>order.status===status).length;
  return <section className="summary">
    <article><small>EN PREPARACIÓN</small><strong>{count("preparing")}</strong><span>La sede está alistando</span></article>
    <article><small>POR DESPACHO</small><strong>{count("ready")}</strong><span>Listos para asignación</span></article>
    <article><small>EN CAMINO</small><strong>{count("dispatched")}</strong><span>Con el domiciliario</span></article>
    <article className="cutoff"><small>ENTREGADOS</small><strong>{count("delivered")}</strong><span>Procesos completados</span></article>
  </section>;
}

function OrdersTable({ orders, couriers, profile, onOpen, onEdit, onAssign, onTransition }){
  if(!orders.length) return <div className="empty"><span>✓</span><h3>Todo al día</h3><p>No hay pedidos que coincidan con los filtros.</p></div>;
  return <div className="order-table">
    <div className="table-head"><span>Pedido</span><span>Cliente y destino</span><span>Estado</span><span>Domiciliario / tiempo</span><span>Total</span><span /></div>
    {orders.map(order=>{
      const courier = courierFor(order,couriers);
      return <article key={order.id} className="order-row" onClick={()=>onOpen(order)}>
        <div className="order-id"><b>#{order.order_number}</b><small>{formatDateTime(order.created_at)}</small><em>{order.fulfillment_type === "pickup" ? "Recogida" : "Domicilio"}</em></div>
        <div><b>{order.customer_name}</b><small>{order.fulfillment_type === "pickup" ? order.branch?.name : `${order.delivery_zone || "Sin zona"} · ${order.branch?.name || ""}`}</small><p>{order.items?.[0]?.name}{order.items?.length>1 ? ` +${order.items.length-1}` : ""}</p></div>
        <div><StatusPill status={order.status}/></div>
        <div className="courier-cell">{courier ? <><b>{courier.name}</b><small>{courier.plate}{order.eta_minutes ? ` · ${order.eta_minutes} min` : ""}</small></> : <><b className="muted">Sin asignar</b><small>{order.fulfillment_type === "pickup" ? "Recoge el cliente" : "Pendiente"}</small></>}</div>
        <div className="amount">{formatMoney(Number(order.total||0)+Number(order.delivery_fee||0))}</div>
        <div className="row-actions" onClick={event=>event.stopPropagation()}><button onClick={()=>onOpen(order)} aria-label={`Ver pedido ${order.order_number}`}>Detalle</button>
          {profile.role === "admin" && <><button title="Editar" onClick={()=>onEdit(order)}>Editar</button>{order.fulfillment_type==="delivery" && !["delivered","cancelled"].includes(order.status) && <button className="accent" onClick={()=>onAssign(order)}>Asignar</button>}</>}
          {profile.role === "cashier" && order.status==="preparing" && <button className="accent" onClick={()=>onTransition(order,"ready")}>Listo</button>}
          {profile.role === "cashier" && order.status==="ready" && order.fulfillment_type==="delivery" && courier && <button className="accent" onClick={()=>onTransition(order,"dispatch")}>Entregar</button>}
          {profile.role === "cashier" && order.status==="ready" && order.fulfillment_type==="pickup" && <button className="accent" onClick={()=>onTransition(order,"pickup")}>Entregar</button>}
        </div>
      </article>;
    })}
  </div>;
}

function OrderDetail({ order, couriers, profile, onClose, onEdit, onAssign, onTransition, onHandoff, onReceipt, onOpenReceipt , error }){
  const [cancelConfirm,setCancelConfirm]=useState(false);
  const [uploading,setUploading]=useState(false);
  if(!order) return null;
  const courier = courierFor(order,couriers);
  const deliveryFee=Number(order.delivery_fee||0);
  const timeline = [
    ["Pedido registrado",order.created_at,true],
    ["Listo en la sede",order.ready_at,Boolean(order.ready_at)],
    [order.fulfillment_type==="pickup"?"Entregado al cliente":"Entregado al domiciliario",order.fulfillment_type==="pickup"?order.delivered_at:order.dispatched_at,Boolean(order.fulfillment_type==="pickup"?order.delivered_at:order.dispatched_at)],
    ...(order.fulfillment_type==="delivery" ? [["Entrega final confirmada",order.delivered_at,Boolean(order.delivered_at)]] : [])
  ];
  async function receiptChange(event){const file=event.target.files?.[0];if(!file)return;setUploading(true);try{await onReceipt(order,file);}finally{setUploading(false);event.target.value="";}}
  return <div className="overlay"><button className="backdrop" aria-label="Cerrar" onClick={onClose}/><aside className="drawer">
    <button className="close" onClick={onClose}>×</button>{error&&<p className="form-error" role="alert">{error}</p>}<p className="eyebrow">DETALLE DEL PEDIDO</p><h2>#{order.order_number}</h2><StatusPill status={order.status}/>
    <section className="detail-block"><h3>Productos</h3>{order.items.map((item,index)=><div className="product-line" key={`${item.name}-${index}`}><span>{item.qty}×</span><p>{item.name}</p><b>{formatMoney(item.qty*item.unit_price)}</b></div>)}{order.fulfillment_type==="delivery"&&<div className="product-line delivery-line"><span>+</span><p>Domicilio asumido por el cliente</p><b>{formatMoney(deliveryFee)}</b></div>}<div className="detail-total"><span>Total cobrado</span><strong>{formatMoney(Number(order.total||0)+deliveryFee)}</strong></div></section>
    <dl><div><dt>Cliente</dt><dd>{order.customer_name}<small>{order.customer_phone}</small></dd></div><div><dt>Modalidad</dt><dd>{order.fulfillment_type==="pickup"?"Recogida en tienda":"Domicilio"}</dd></div><div><dt>Sede</dt><dd>{order.branch?.name}</dd></div><div><dt>Pago</dt><dd>{PAYMENT[order.payment_method]}</dd></div><div><dt>Origen</dt><dd>{order.source || "No indicado"}</dd></div>{order.fulfillment_type==="delivery"&&<div><dt>Entrega</dt><dd>{order.delivery_address}<small>{order.delivery_zone}</small></dd></div>}</dl>
    {courier && <section className="courier-box"><small>DOMICILIARIO ASIGNADO {courier.temporary?"· SOLO ESTE PEDIDO":"· FRECUENTE"}</small><strong>{courier.name}</strong><span>{courier.provider} · Placa {courier.plate} · {courier.phone}</span><b>{order.eta_minutes ? `Tiempo estimado: ${order.eta_minutes} min` : "Sin tiempo estimado"}{deliveryFee?` · Domicilio ${formatMoney(deliveryFee)}`:""}</b></section>}
    {order.handoff_staff_name&&<section className="handoff-box"><small>ENTREGA REALIZADA POR</small><strong>{order.handoff_staff_name}</strong><span>{formatDateTime(order.fulfillment_type==="pickup"?order.delivered_at:order.dispatched_at)}</span></section>}
    <section className="receipt-box"><div><h3>Comprobante de pago</h3><p>{order.payment_receipt_name||"No se ha adjuntado comprobante."}</p>{order.payment_receipt_uploaded_at&&<small>Subido {formatDateTime(order.payment_receipt_uploaded_at)}</small>}</div><div>{order.payment_receipt_path&&<button type="button" onClick={()=>onOpenReceipt(order.payment_receipt_path,order.payment_receipt_bucket)}>Ver comprobante</button>}<label className="upload-button">{uploading?"Subiendo…":order.payment_receipt_path?"Reemplazar":"Adjuntar"}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={uploading} onChange={receiptChange}/></label></div></section>
    {(order.customer_notes||order.internal_notes)&&<section className="notes"><h3>Notas</h3>{order.customer_notes&&<p><b>Cliente:</b> {order.customer_notes}</p>}{order.internal_notes&&<p><b>Interna:</b> {order.internal_notes}</p>}</section>}
    <section className="timeline"><h3>Trazabilidad</h3>{timeline.map(([label,date,complete])=><div className={complete?"complete":""} key={label}><i/><p><b>{label}</b><small>{complete?formatDateTime(date):"Pendiente"}{complete&&order.handoff_staff_name&&((label==="Entregado al domiciliario")||(label==="Entregado al cliente"))?` · ${order.handoff_staff_name}`:""}</small></p></div>)}</section>
    <div className="drawer-actions">{profile.role==="admin"&&<><button onClick={()=>onEdit(order)}>Editar pedido</button>{order.fulfillment_type==="delivery"&&!['delivered','cancelled'].includes(order.status)&&<button className="primary" onClick={()=>onAssign(order)}>Asignar domiciliario</button>}{order.status==="dispatched"&&<button className="primary" onClick={()=>onTransition(order,"delivered")}>Confirmar entrega final</button>}</>}{(profile.role==="cashier"||profile.role==="admin")&&order.status==="preparing"&&<button className="primary" onClick={()=>onTransition(order,"ready")}>Marcar listo para despacho</button>}{(profile.role==="cashier"||profile.role==="admin")&&order.status==="ready"&&order.fulfillment_type==="delivery"&&courier&&<button className="primary" onClick={()=>onHandoff(order,"dispatch")}>Entregado al domiciliario</button>}{(profile.role==="cashier"||profile.role==="admin")&&order.status==="ready"&&order.fulfillment_type==="pickup"&&<button className="primary" onClick={()=>onHandoff(order,"pickup")}>Entregado al cliente</button>}</div>{profile.role==="admin"&&!['delivered','cancelled'].includes(order.status)&&<section className="cancel-order">{cancelConfirm?<><p>La cancelación conserva el pedido y su historial. Confirma que deseas detener esta entrega.</p><button onClick={()=>onTransition(order,"cancel")}>Confirmar cancelación</button><button onClick={()=>setCancelConfirm(false)}>Volver</button></>:<button onClick={()=>setCancelConfirm(true)}>Cancelar pedido</button>}</section>}
  </aside></div>;
}

const blankOrder = { branch_id:"santa-lucia",fulfillment_type:"delivery",status:"preparing",customer_name:"",customer_phone:"",delivery_address:"",delivery_zone:"",items:[{qty:1,name:"",unit_price:0}],payment_method:"transfer",source:"Punto físico",customer_notes:"",internal_notes:"",courier_id:null,courier_name:null,courier_plate:null,courier_phone:null,courier_provider:null,delivery_fee:0,eta_minutes:null,promised_at:null };

function OrderEditor({ order, onClose, onSave , error }){
  const [form,setForm] = useState(()=>structuredClone(order||blankOrder));
  const [receiptFile,setReceiptFile] = useState(null);
  const [fileError,setFileError] = useState("");
  const [busy,setBusy] = useState(false);
  const total = form.items.reduce((sum,item)=>sum+Number(item.qty||0)*Number(item.unit_price||0),0);
  const change = (key,value)=>setForm(current=>({...current,[key]:value}));
  const changeItem = (index,key,value)=>setForm(current=>({...current,items:current.items.map((item,itemIndex)=>itemIndex===index?{...item,[key]:value}:item)}));
  const removeItem = index=>setForm(current=>({...current,items:current.items.filter((_,itemIndex)=>itemIndex!==index)}));
  function receiptChange(event){
    const file=event.target.files?.[0]||null;
    const allowed=["image/jpeg","image/png","image/webp","application/pdf"];
    if(file&&!allowed.includes(file.type)){setReceiptFile(null);setFileError("Usa una imagen JPG, PNG, WEBP o un PDF.");return;}
    if(file&&file.size>5*1024*1024){setReceiptFile(null);setFileError("El comprobante debe pesar máximo 5 MB.");return;}
    setReceiptFile(file);setFileError("");
  }
  async function submit(event){ event.preventDefault(); if(fileError)return;setBusy(true); try{await onSave({...form,total},receiptFile);}finally{setBusy(false);} }
  return <div className="overlay"><button className="backdrop" aria-label="Cerrar" onClick={onClose}/><section className="modal editor"><button className="close" onClick={onClose}>×</button>{error&&<p className="form-error" role="alert">{error}</p>}<p className="eyebrow">{order?"EDITAR PEDIDO":"NUEVO PEDIDO"}</p><h2>{order?`#${order.order_number}`:"Registrar venta"}</h2>
    <form onSubmit={submit}>
      <div className="form-grid"><label>Sede<select value={form.branch_id} onChange={e=>change("branch_id",e.target.value)}>{BRANCHES.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Modalidad<select value={form.fulfillment_type} onChange={e=>setForm(current=>({...current,fulfillment_type:e.target.value,courier_id:e.target.value==="pickup"?null:current.courier_id,delivery_fee:e.target.value==="pickup"?0:current.delivery_fee}))}><option value="delivery">Domicilio</option><option value="pickup">Recogida en tienda</option></select></label><label>Cliente<input value={form.customer_name} onChange={e=>change("customer_name",e.target.value)} required /></label><label>Teléfono<input value={form.customer_phone} onChange={e=>change("customer_phone",e.target.value)} required /></label>{form.fulfillment_type==="delivery"&&<><label>Dirección<input value={form.delivery_address} onChange={e=>change("delivery_address",e.target.value)} required /></label><label>Zona o barrio<input value={form.delivery_zone} onChange={e=>change("delivery_zone",e.target.value)} required /></label><label>Costo del domicilio para el cliente<input type="number" min="0" step="500" value={form.delivery_fee||0} onChange={e=>change("delivery_fee",Number(e.target.value))}/></label></>}<label>Medio de pago<select value={form.payment_method} onChange={e=>change("payment_method",e.target.value)}>{Object.entries(PAYMENT).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Origen<input value={form.source} onChange={e=>change("source",e.target.value)} placeholder="WhatsApp, Instagram…" /></label>{order&&<p className="form-note">El estado cambia desde las acciones del pedido y queda registrado en la trazabilidad.</p>}</div>
      <fieldset><legend>Productos</legend>{form.items.map((item,index)=><div className="item-row" key={index}><label>Producto<input value={item.name} onChange={e=>changeItem(index,"name",e.target.value)} required /></label><label>Cantidad<input type="number" min="1" value={item.qty} onChange={e=>changeItem(index,"qty",Number(e.target.value))} required /></label><label>Precio unitario<input type="number" min="0" step="100" value={item.unit_price} onChange={e=>changeItem(index,"unit_price",Number(e.target.value))} required /></label>{form.items.length>1&&<button type="button" className="remove" onClick={()=>removeItem(index)}>×</button>}</div>)}<button type="button" className="add-line" onClick={()=>change("items",[...form.items,{qty:1,name:"",unit_price:0}])}>+ Agregar producto</button><div className="calculated-total">TOTAL CON DOMICILIO <strong>{formatMoney(total+Number(form.delivery_fee||0))}</strong></div></fieldset>
      <section className="editor-receipt"><div><b>Comprobante de pago</b><span>Opcional · puedes adjuntarlo ahora o hacerlo después desde el detalle del pedido.</span>{order?.payment_receipt_name&&!receiptFile&&<small>Actual: {order.payment_receipt_name}</small>}{receiptFile&&<small>Seleccionado: {receiptFile.name}</small>}{fileError&&<small className="form-error">{fileError}</small>}</div><label className="upload-button">{receiptFile?"Cambiar archivo":order?.payment_receipt_path?"Reemplazar":"Seleccionar archivo"}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={receiptChange}/></label></section>
      <div className="form-grid"><label className="wide">Indicaciones del cliente<textarea value={form.customer_notes||""} onChange={e=>change("customer_notes",e.target.value)} /></label><label className="wide">Nota interna<textarea value={form.internal_notes||""} onChange={e=>change("internal_notes",e.target.value)} /></label></div>
      <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy?"Guardando…":"Guardar pedido"}</button></div>
    </form>
  </section></div>;
}

function AssignmentModal({ order, couriers, onClose, onSave , error }){
  const [mode,setMode] = useState(order.courier_id?"frequent":"temporary");
  const [courierId,setCourierId] = useState(order.courier_id||"");
  const [details,setDetails] = useState({name:order.courier_name||"",plate:order.courier_plate||"",phone:order.courier_phone||"",provider:order.courier_provider||"DiDi Entregas"});
  const [saveFrequent,setSaveFrequent] = useState(false);
  const [eta,setEta] = useState(order.eta_minutes||15);
  const [deliveryFee,setDeliveryFee] = useState(order.delivery_fee||0);
  const [busy,setBusy] = useState(false);
  const change=(key,value)=>setDetails(current=>({...current,[key]:value}));
  async function submit(event){
    event.preventDefault();setBusy(true);
    try{
      let courierData=details;
      if(mode==="frequent"){
        const selected=couriers.find(item=>item.id===courierId);
        if(!selected)throw new Error("Selecciona un domiciliario frecuente.");
        courierData=selected;
      }
      await onSave({values:{...order,courier_id:mode==="frequent"?courierId:null,courier_name:courierData.name.trim(),courier_plate:courierData.plate.trim().toUpperCase(),courier_phone:courierData.phone?.trim()||"",courier_provider:courierData.provider.trim(),delivery_fee:Number(deliveryFee||0),eta_minutes:Number(eta),promised_at:new Date(Date.now()+Number(eta)*60_000).toISOString()},saveFrequent:mode==="temporary"&&saveFrequent});
    }finally{setBusy(false);}
  }
  return <div className="overlay"><button className="backdrop" aria-label="Cerrar" onClick={onClose}/><section className="modal assignment-modal"><button className="close" onClick={onClose}>×</button>{error&&<p className="form-error" role="alert">{error}</p>}<p className="eyebrow">ASIGNAR DOMICILIARIO</p><h2>#{order.order_number}</h2><form onSubmit={submit}>
    <div className="assignment-mode"><button type="button" className={mode==="temporary"?"active":""} onClick={()=>setMode("temporary")}><b>Servicio por plataforma</b><span>Solo se guarda en este pedido</span></button><button type="button" className={mode==="frequent"?"active":""} onClick={()=>setMode("frequent")}><b>Domiciliario frecuente</b><span>Personal disponible habitualmente</span></button></div>
    {mode==="frequent"?<label>Domiciliario<select value={courierId} onChange={e=>setCourierId(e.target.value)} required><option value="">Selecciona una persona</option>{couriers.filter(item=>item.active).map(item=><option key={item.id} value={item.id}>{item.name} · {item.plate} · {item.provider}</option>)}</select></label>:<><div className="form-grid"><label>Nombre del domiciliario<input value={details.name} onChange={e=>change("name",e.target.value)} required/></label><label>Placa<input value={details.plate} onChange={e=>change("plate",e.target.value.toUpperCase())} required/></label><label>Plataforma o proveedor<input list="delivery-platforms" value={details.provider} onChange={e=>change("provider",e.target.value)} required/><datalist id="delivery-platforms"><option value="Rappi"/><option value="DiDi Entregas"/><option value="Mensajeros Urbanos"/><option value="inDrive"/><option value="Independiente"/></datalist></label><label>Teléfono (opcional)<input value={details.phone} onChange={e=>change("phone",e.target.value)} required={saveFrequent}/></label></div><label className="check save-courier"><input type="checkbox" checked={saveFrequent} onChange={e=>setSaveFrequent(e.target.checked)}/><span><b>Guardar como domiciliario frecuente</b><small>Déjalo desmarcado para Rappi, DiDi y servicios ocasionales.</small></span></label></>}
    <div className="form-grid"><label>Tiempo estimado de llegada<input type="number" min="1" max="240" value={eta} onChange={e=>setEta(e.target.value)} required/><span className="input-suffix">minutos</span></label><label>Costo del domicilio para el cliente<input type="number" min="0" step="500" value={deliveryFee} onChange={e=>setDeliveryFee(e.target.value)} required/></label></div>
    <div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy?"Asignando…":"Confirmar asignación"}</button></div>
  </form></section></div>;
}

function HandoffModal({ order, staff, action, onClose, onConfirm , error }){
  const available=staff.filter(member=>member.active&&member.branch_id===order.branch_id);
  const [staffId,setStaffId]=useState(available[0]?.id||"");
  const [busy,setBusy]=useState(false);
  const delivery=action==="dispatch";
  async function submit(event){event.preventDefault();setBusy(true);try{await onConfirm(order,action,staffId);}finally{setBusy(false);}}
  return <div className="overlay"><button className="backdrop" aria-label="Cerrar" onClick={onClose}/><section className="modal small"><button className="close" onClick={onClose}>×</button>{error&&<p className="form-error" role="alert">{error}</p>}<p className="eyebrow">REGISTRAR ENTREGA</p><h2>{delivery?"Al domiciliario":"Al cliente"}</h2><p className="modal-intro">La fecha y hora se guardarán automáticamente. Selecciona quién realizó la entrega física del pedido #{order.order_number}.</p><form onSubmit={submit}><label>Responsable de caja<select value={staffId} onChange={e=>setStaffId(e.target.value)} required><option value="">Selecciona una persona</option>{available.map(member=><option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>{available.length===0&&<div className="inline-warning">El administrador debe crear primero una persona activa para esta sede.</div>}<div className="modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy||!staffId}>{busy?"Registrando…":delivery?"Confirmar entrega al domiciliario":"Confirmar entrega al cliente"}</button></div></form></section></div>;
}

function StaffManager({ staff, onSave }){
  const empty={full_name:"",branch_id:"santa-lucia",active:true};
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState(empty);
  function edit(member){setEditing(member.id);setForm(member);}
  async function submit(event){event.preventDefault();const saved=await onSave({...form,id:editing});if(saved){setEditing(null);setForm(empty);}}
  return <section className="manager"><div className="section-title"><div><p className="eyebrow">RESPONSABLES DE ENTREGA</p><h2>Personal de caja</h2></div><span>Se seleccionan al entregar cada pedido</span></div><div className="manager-grid"><form className="panel courier-form" onSubmit={submit}><h3>{editing?"Editar persona":"Agregar persona"}</h3><label>Nombre completo<input value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} required/></label><label>Sede<select value={form.branch_id} onChange={e=>setForm({...form,branch_id:e.target.value})}>{BRANCHES.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label className="check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Disponible para registrar entregas</label><button className="primary">{editing?"Guardar cambios":"Agregar persona"}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setForm(empty);}}>Cancelar</button>}</form><div className="panel courier-list">{staff.length===0?<div className="empty compact"><h3>Aún no hay personal</h3><p>Agrega las personas de caja y asígnalas a su sede.</p></div>:staff.map(member=><article key={member.id}><span className={member.active?"available":"offline"}/><div><b>{member.full_name}</b><small>{member.branch?.name||BRANCHES.find(branch=>branch.id===member.branch_id)?.name}</small><em>{member.active?"Disponible":"Inactiva"}</em></div><button onClick={()=>edit(member)}>Editar</button></article>)}</div></div></section>;
}

function CourierManager({ couriers, onSave }){
  const empty = {name:"",plate:"",phone:"",provider:"Independiente",active:true};
  const [editing,setEditing] = useState(null);
  const [form,setForm] = useState(empty);
  function edit(courier){setEditing(courier.id);setForm(courier);}
  async function submit(event){event.preventDefault();const saved=await onSave({...form,id:editing});if(saved){setEditing(null);setForm(empty);}}
  return <section className="manager"><div className="section-title"><div><p className="eyebrow">EQUIPO DE ENTREGA</p><h2>Domiciliarios</h2></div></div><div className="manager-grid"><form className="panel courier-form" onSubmit={submit}><h3>{editing?"Editar domiciliario":"Agregar domiciliario"}</h3><label>Nombre<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></label><label>Placa<input value={form.plate} onChange={e=>setForm({...form,plate:e.target.value.toUpperCase()})} required/></label><label>Teléfono<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} required/></label><label>Proveedor<input value={form.provider} onChange={e=>setForm({...form,provider:e.target.value})}/></label><label className="check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Disponible para asignar</label><button className="primary">{editing?"Guardar cambios":"Agregar"}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setForm(empty);}}>Cancelar</button>}</form><div className="panel courier-list">{couriers.map(item=><article key={item.id}><span className={item.active?"available":"offline"}/><div><b>{item.name}</b><small>{item.plate} · {item.phone}</small><em>{item.provider}</em></div><button onClick={()=>edit(item)}>Editar</button></article>)}</div></div></section>;
}

const AUDIT_LABELS={created:"Pedido creado",updated:"Pedido actualizado",courier_assigned:"Domiciliario asignado",payment_receipt_uploaded:"Comprobante adjuntado",status_changed:"Estado actualizado",ready:"Marcado como listo",dispatch:"Entregado al domiciliario",pickup:"Entregado al cliente",delivered:"Entrega final confirmada",cancelled:"Pedido cancelado"};
const AUDIT_FIELDS={status:"Estado",branch_id:"Sede",customer_name:"Cliente",customer_phone:"Teléfono",delivery_address:"Dirección",delivery_zone:"Zona",items:"Productos",total:"Subtotal de productos",delivery_fee:"Costo del domicilio",payment_method:"Medio de pago",source:"Origen",customer_notes:"Nota del cliente",internal_notes:"Nota interna",courier_id:"Domiciliario frecuente",courier_name:"Nombre del domiciliario",courier_plate:"Placa",courier_phone:"Teléfono del domiciliario",courier_provider:"Plataforma",eta_minutes:"Tiempo estimado",promised_at:"Hora prometida",handoff_staff_name:"Responsable de caja",payment_receipt_name:"Comprobante",fulfillment_type:"Modalidad"};

function auditValue(field,value,couriers){
  if(value==null||value==="")return "Sin definir";
  if(field==="status")return STATUS[value]?.label||value;
  if(field==="payment_method")return PAYMENT[value]||value;
  if(field==="branch_id")return BRANCHES.find(item=>item.id===value)?.name||value;
  if(field==="courier_id")return couriers.find(item=>item.id===value)?.name||value;
  if(field==="items")return value.map(item=>`${item.qty}× ${item.name}`).join(" · ");
  if(field==="total"||field==="delivery_fee")return formatMoney(value);
  if(field==="eta_minutes")return `${value} minutos`;
  if(field==="promised_at")return formatDateTime(value);
  if(field==="fulfillment_type")return value==="delivery"?"Domicilio":"Recogida en tienda";
  return String(value);
}

function changedAuditFields(event){
  return event.before_data
    ? Object.keys(AUDIT_FIELDS).filter(key=>JSON.stringify(event.before_data?.[key])!==JSON.stringify(event.after_data?.[key]))
    : Object.keys(AUDIT_FIELDS).filter(key=>event.after_data?.[key]!=null);
}

function TraceabilityDrawer({ order, events, couriers, onClose, onOpenReceipt, error="" }){
  const courier=courierFor(order,couriers);
  const chronological=[...events].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const grandTotal=Number(order.total||0)+Number(order.delivery_fee||0);
  return <div className="overlay"><button className="backdrop" aria-label="Cerrar" onClick={onClose}/><aside className="drawer trace-drawer"><button className="close" onClick={onClose}>×</button>{error&&<p className="form-error" role="alert">{error}</p>}
    <div className="trace-case-heading"><div><p className="eyebrow">EXPEDIENTE DEL PEDIDO</p><h2>#{order.order_number}</h2><span>{order.branch?.name||BRANCHES.find(branch=>branch.id===order.branch_id)?.name}</span></div><StatusPill status={order.status}/></div>
    <section className="trace-case-summary"><div><small>CLIENTE</small><b>{order.customer_name}</b><span>{order.customer_phone}</span></div><div><small>TOTAL COBRADO</small><b>{formatMoney(grandTotal)}</b><span>{PAYMENT[order.payment_method]}</span></div><div><small>MODALIDAD</small><b>{order.fulfillment_type==="delivery"?"Domicilio":"Recogida"}</b><span>{order.fulfillment_type==="delivery"?order.delivery_zone:order.branch?.name}</span></div></section>
    {order.payment_receipt_path?<section className="trace-receipt available"><div><span>✓</span><p><small>COMPROBANTE DE TRANSFERENCIA</small><b>{order.payment_receipt_name}</b><em>{order.payment_receipt_uploaded_at?`Adjuntado ${formatDateTime(order.payment_receipt_uploaded_at)}`:"Disponible"}</em></p></div><button onClick={()=>onOpenReceipt(order.payment_receipt_path,order.payment_receipt_bucket)}>Ver comprobante</button></section>:<section className="trace-receipt"><div><span>—</span><p><small>COMPROBANTE DE TRANSFERENCIA</small><b>Sin comprobante adjunto</b><em>Este pedido no tiene un archivo asociado.</em></p></div></section>}
    <section className="trace-operational"><h3>Datos operativos</h3><dl><div><dt>Dirección</dt><dd>{order.fulfillment_type==="delivery"?order.delivery_address:"Recoge en sede"}</dd></div><div><dt>Domiciliario</dt><dd>{courier?`${courier.name} · ${courier.provider} · ${courier.plate}`:"Sin asignar"}</dd></div><div><dt>Responsable de entrega</dt><dd>{order.handoff_staff_name||"Pendiente"}</dd></div><div><dt>Costo del domicilio</dt><dd>{formatMoney(order.delivery_fee||0)}</dd></div></dl></section>
    <section className="trace-history"><div className="trace-history-title"><div><p className="eyebrow">LÍNEA DE TIEMPO</p><h3>Todo lo que ha pasado</h3></div><span>{chronological.length} movimientos</span></div>
      {chronological.length===0?<div className="empty compact"><h3>Sin movimientos registrados</h3></div>:<div className="trace-event-list">{chronological.map(event=>{const fields=changedAuditFields(event);return <article key={event.id} className="trace-event"><div className="trace-event-axis"><i/><span/></div><div className="trace-event-body"><div className="trace-event-top"><div><b>{AUDIT_LABELS[event.action]||event.action}</b><p>{event.actor_name||"Sistema"}{event.staff_name?` · Responsable físico: ${event.staff_name}`:""}</p></div><time>{formatDateTime(event.created_at)}</time></div>{fields.length>0&&<details><summary>{event.before_data?"Ver cambios realizados":"Ver información registrada"}</summary><dl>{fields.map(field=><div key={field}><dt>{AUDIT_FIELDS[field]}</dt>{event.before_data&&<dd><small>Antes</small><span>{auditValue(field,event.before_data[field],couriers)}</span></dd>}<dd><small>{event.before_data?"Después":"Valor"}</small><span>{auditValue(field,event.after_data?.[field],couriers)}</span></dd></div>)}</dl></details>}</div></article>;})}</div>}
    </section>
  </aside></div>;
}

function AuditLog({ events, orders, couriers, onOpenReceipt }){
  const [query,setQuery]=useState("");
  const [branch,setBranch]=useState("all");
  const [selectedId,setSelectedId]=useState(null);
  const records=useMemo(()=>orders.map(order=>{
    const orderEvents=events.filter(event=>event.order_id===order.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    return {order,events:orderEvents,lastEvent:orderEvents[0]||null};
  }).filter(record=>{
    const term=query.trim().toLowerCase();
    const haystack=`${record.order.order_number} ${record.order.customer_name} ${record.order.customer_phone} ${record.order.delivery_zone||""}`.toLowerCase();
    return (branch==="all"||record.order.branch_id===branch)&&(!term||haystack.includes(term));
  }).sort((a,b)=>new Date(b.lastEvent?.created_at||b.order.updated_at)-new Date(a.lastEvent?.created_at||a.order.updated_at)),[orders,events,query,branch]);
  const selectedOrder=orders.find(order=>order.id===selectedId);
  const selected=selectedOrder?{order:selectedOrder,events:events.filter(event=>event.order_id===selectedId)}:null;
  const receiptCount=orders.filter(order=>order.payment_receipt_path).length;
  return <section className="trace-page"><div className="section-title"><div><p className="eyebrow">EXPEDIENTES OPERATIVOS</p><h2>Trazabilidad por pedido</h2></div><span>{orders.length} pedidos · {events.length} movimientos</span></div>
    <div className="trace-overview"><article><small>PEDIDOS REGISTRADOS</small><strong>{orders.length}</strong><span>Con historial individual</span></article><article><small>CON COMPROBANTE</small><strong>{receiptCount}</strong><span>Archivos protegidos</span></article><article><small>ENTREGADOS</small><strong>{orders.filter(order=>order.status==="delivered").length}</strong><span>Proceso finalizado</span></article></div>
    <div className="trace-filters"><label className="search"><span>⌕</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar número, cliente, teléfono o zona"/></label><select value={branch} onChange={event=>setBranch(event.target.value)}><option value="all">Todas las sedes</option>{BRANCHES.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <div className="trace-order-list panel"><div className="trace-order-head"><span>Pedido</span><span>Cliente / sede</span><span>Último movimiento</span><span>Soportes</span><span/></div>{records.length===0?<div className="empty compact"><h3>No encontramos pedidos</h3><p>Prueba con otro número, cliente o sede.</p></div>:records.map(record=><button className="trace-order-record" key={record.order.id} onClick={()=>setSelectedId(record.order.id)}><div><b>#{record.order.order_number}</b><StatusPill status={record.order.status}/></div><div><b>{record.order.customer_name}</b><span>{record.order.branch?.name||BRANCHES.find(item=>item.id===record.order.branch_id)?.name}</span></div><div><b>{record.lastEvent?AUDIT_LABELS[record.lastEvent.action]||record.lastEvent.action:"Pedido registrado"}</b><span>{formatDateTime(record.lastEvent?.created_at||record.order.created_at)}</span><small>{record.events.length} movimiento{record.events.length===1?"":"s"}</small></div><div>{record.order.payment_receipt_path?<span className="trace-support yes">✓ Comprobante</span>:<span className="trace-support">Sin archivo</span>}</div><i>→</i></button>)}</div>
    {selected&&<TraceabilityDrawer order={selected.order} events={selected.events} couriers={couriers} onClose={()=>setSelectedId(null)} onOpenReceipt={onOpenReceipt}/>}
  </section>;
}

function App(){
  useModalFocus();
  const [passwordSetup,setPasswordSetup]=useState(initialAuthFlow);
  useEffect(()=>{if(!supabase)return;const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{if(event==="PASSWORD_RECOVERY")setPasswordSetup(true);});return()=>subscription.unsubscribe();},[]);
  const [profile,setProfile] = useState(null);
  const [loading,setLoading] = useState(!isDemoMode&&isConfigured);
  const [accessError,setAccessError]=useState("");
  const authObserver=useRef(null);
  const accessEpoch=useRef(0), accessIdentity=useRef(null);
  const [orders,setOrders] = useState([]);
  const [couriers,setCouriers] = useState([]);
  const [staff,setStaff] = useState([]);
  const [events,setEvents] = useState([]);
  const [page,setPage] = useState("orders");
  const [internalBranch,setInternalBranch]=useState(null);
  const openInternalChat=useCallback(branch=>{setInternalBranch(branch);setPage("internalChat");},[]);
  const chat=useBranchChat(profile,profile?.role==="cashier"?profile.branch_id:internalBranch,page==="internalChat",openInternalChat);
  const [search,setSearch] = useState("");
  const [branchFilter,setBranchFilter] = useState("all");
  const [statusFilter,setStatusFilter] = useState("active");
  const [detail,setDetail] = useState(null);
  const [editor,setEditor] = useState(null);
  const [assignment,setAssignment] = useState(null);
  const [handoff,setHandoff] = useState(null);
  const [toast,setToast] = useState("");
  const [error,setError] = useState("");

  useEffect(()=>{
    if(isDemoMode||!isConfigured) return;
    const observer=observeAuthProfile({
      auth:supabase.auth,
      loadProfile:getProfile,
      onState:state=>{const identity=state.profile?`${state.profile.id}:${state.profile.role}:${state.profile.branch_id}`:null;if(identity!==accessIdentity.current){accessIdentity.current=identity;accessEpoch.current++;setOrders([]);setCouriers([]);setStaff([]);setEvents([]);setDetail(null);setEditor(null);setAssignment(null);setHandoff(null);setInternalBranch(null);setSearch("");setBranchFilter("all");setPage("orders");}setProfile(state.profile);setLoading(state.loading);setAccessError(state.error);}
    });
    authObserver.current=observer;
    const revalidate=()=>observer.retry();const timer=setInterval(revalidate,60000);window.addEventListener("focus",revalidate);
    return ()=>{clearInterval(timer);window.removeEventListener("focus",revalidate);observer.stop();authObserver.current=null;};
  },[]);

  const refresh = useCallback(async()=>{
    if(!profile)return;
    const epoch=accessEpoch.current;
    try{
      const [nextOrders,nextCouriers,nextStaff,nextEvents]=await Promise.all([listOrders(profile),listCouriers(),listStaff(profile),listEvents(profile)]);
      if(epoch!==accessEpoch.current)return;
      setOrders(nextOrders);setCouriers(nextCouriers);setStaff(nextStaff);setEvents(nextEvents);setError("");
    }catch(loadError){if(epoch===accessEpoch.current)setError(`No se pudieron sincronizar los datos: ${loadError.message}`);}
  },[profile]);

  useEffect(()=>{if(!profile||(!isDemoMode&&!supabase))return;refresh();const unsubscribe=subscribeToOrders(()=>refresh());return unsubscribe;},[refresh,profile]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(""),4500);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(page==="new"){setEditor(false);setPage("orders");}},[page]);

  const filtered = useMemo(()=>orders.filter(order=>{
    const term=search.trim().toLowerCase();
    const haystack=`${order.order_number} ${order.customer_name} ${order.customer_phone} ${order.delivery_zone} ${(order.items||[]).map(item=>item.name).join(" ")}`.toLowerCase();
    return (branchFilter==="all"||order.branch_id===branchFilter)&&(!term||haystack.includes(term));
  }),[orders,search,branchFilter]);

  async function handleSaveOrder(values,receiptFile=null){
    setError("");
    let savedOrder;
    try{savedOrder=await saveOrder(values,profile);}
    catch(saveError){setError(`No se pudo guardar: ${saveError.message}`);return false;}
    if(receiptFile){
      try{await uploadPaymentReceipt(savedOrder,receiptFile,profile);}
      catch(receiptError){setEditor(null);setDetail(null);await refresh();setError(`El pedido quedó guardado, pero el comprobante no pudo adjuntarse: ${receiptError.message}. Puedes volver a subirlo desde el detalle del pedido.`);return true;}
    }
    setEditor(null);setDetail(null);await refresh();setToast(receiptFile?(values.id?"Pedido y comprobante actualizados correctamente.":"Pedido creado con su comprobante."):(values.id?"Pedido actualizado y registrado en la trazabilidad.":"Pedido creado correctamente."));return true;
  }
  async function handleTransition(order,action,staffId=null){
    setError("");
    try{await transitionOrder(order.id,action,profile,staffId);setDetail(null);setHandoff(null);await refresh();setToast(["dispatch","pickup"].includes(action)?"Entrega registrada con fecha, hora y responsable.":"Movimiento registrado con fecha y hora.");return true;}
    catch(moveError){setError(`No se pudo realizar el movimiento: ${moveError.message}`);}
  }
  async function handleAssign({values,saveFrequent}){
    try{
      let nextValues=values;
      if(saveFrequent){const savedCourier=await saveCourier({name:values.courier_name,plate:values.courier_plate,phone:values.courier_phone,provider:values.courier_provider,active:true});nextValues={...values,courier_id:savedCourier.id};}
      const saved=await handleSaveOrder(nextValues);if(saved){setAssignment(null);setToast(saveFrequent?"Domiciliario guardado y asignado.":"Servicio ocasional asignado solo a este pedido.");}return saved;
    }catch(assignError){setError(`No se pudo asignar: ${assignError.message}`);return false;}
  }
  async function handleCourier(values){try{await saveCourier(values);await refresh();setToast("Domiciliario guardado.");return true;}catch(courierError){setError(`No se pudo guardar: ${courierError.message}`);return false;}}
  async function handleStaff(values){try{await saveStaff(values);await refresh();setToast("Personal de caja actualizado.");return true;}catch(staffError){setError(`No se pudo guardar: ${staffError.message}`);return false;}}
  async function handleReceipt(order,file){try{await uploadPaymentReceipt(order,file,profile);await refresh();setToast("Comprobante adjuntado y registrado en la trazabilidad.");return true;}catch(receiptError){setError(`No se pudo adjuntar: ${receiptError.message}`);return false;}}
  async function handleOpenReceipt(path,bucket){const popup=window.open("about:blank","_blank");try{const url=await getPaymentReceiptUrl(path,bucket);if(popup)popup.location.href=url;else window.open(url,"_blank","noopener,noreferrer");}catch(receiptError){if(popup)popup.close();setError(`No se pudo abrir: ${receiptError.message}`);}}
  async function logout(){await signOut();setProfile(null);setOrders([]);setPage("orders");}

  if(passwordSetup) return <PasswordSetup onComplete={()=>setPasswordSetup(false)}/>;
  if(loading) return <div className="loading"><span>▦</span><p>Cargando operación…</p></div>;
  if(!profile) return <Login onDemoLogin={value=>{accessEpoch.current++;setProfile(value);}} accessError={accessError} onRetry={()=>authObserver.current?.retry()}/>;
  const effectiveOrders=page==="ready"
    ? filtered.filter(order=>order.status==="ready")
    : page==="history"
      ? filtered.filter(order=>["dispatched","delivered","cancelled"].includes(order.status))
      : filtered.filter(order=>statusFilter==="all"||(statusFilter==="active"?["preparing","ready","dispatched"].includes(order.status):order.status===statusFilter));
  return <div className={`app-shell ${profile.role==="cashier"?"cashier-shell":"admin-shell"}`}><Sidebar profile={profile} page={page} setPage={setPage} onLogout={logout} chatUnread={chat.unread}/><main className="main"><Header profile={profile} onLogout={logout} page={page}/>{isDemoMode&&<p className="demo-banner">Vista de demostración · los cambios se guardan solo en esta pestaña.</p>}{error&&<div className="error-banner"><span>{error}</span><button onClick={()=>setError("")}>×</button></div>}
    {page==="orders"||page==="ready"||page==="history"?<><Summary orders={orders}/><section className="orders-section"><div className="section-title"><div><p className="eyebrow">{profile.role==="admin"?"TODAS LAS SEDES":"COLA EN TIEMPO REAL"}</p><h2>{page==="history"?"Historial":page==="ready"?"Pendientes por despacho":"Pedidos"} <span>{effectiveOrders.length}</span></h2></div>{profile.role==="admin"&&<button className="primary" onClick={()=>setEditor(false)}>+ Nuevo pedido</button>}</div><div className="filters"><label className="search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pedido, cliente o producto"/></label>{profile.role==="admin"&&<select value={branchFilter} onChange={e=>setBranchFilter(e.target.value)}><option value="all">Todas las sedes</option>{BRANCHES.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}{page==="orders"&&<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="active">Activos</option><option value="all">Todos los estados</option>{Object.entries(STATUS).map(([value,item])=><option key={value} value={value}>{item.label}</option>)}</select>}</div>{profile.role==="cashier"?<CashierOrders orders={effectiveOrders} couriers={couriers} onOpen={setDetail} onTransition={handleTransition} onHandoff={(order,action)=>setHandoff({order,action})}/>:<OrdersTable orders={effectiveOrders} couriers={couriers} profile={profile} onOpen={setDetail} onEdit={setEditor} onAssign={setAssignment} onTransition={handleTransition}/>}</section></>:null}
    {page==="internalChat"&&<BranchChat profile={profile} branch={profile.role==="cashier"?profile.branch_id:internalBranch} onBranch={setInternalBranch} chat={chat}/>} {page==="commerce"&&profile.role==="admin"&&<CommerceHub profile={profile}/>} {page==="recruitment"&&profile.role==="admin"&&<RecruitmentHub profile={profile}/>} {page==="team"&&profile.role==="admin"&&<TeamHub profile={profile}/>} {page==="pqrs"&&profile.role==="admin"&&<PqrsHub profile={profile}/>} {page==="staff"&&profile.role==="admin"&&<StaffManager staff={staff} onSave={handleStaff}/>} {page==="couriers"&&profile.role==="admin"&&<CourierManager couriers={couriers} onSave={handleCourier}/>} {page==="audit"&&profile.role==="admin"&&<AuditLog events={events} orders={orders} couriers={couriers} onOpenReceipt={handleOpenReceipt}/>}<footer><span>Polaris Studio · Importados</span><span>{isDemoMode?"Modo demostración":"Datos protegidos y sincronizados"}</span></footer></main>
    {detail&&<OrderDetail error={error} order={orders.find(item=>item.id===detail.id)||detail} couriers={couriers} profile={profile} onClose={()=>setDetail(null)} onEdit={order=>{setDetail(null);setEditor(order);}} onAssign={order=>{setDetail(null);setAssignment(order);}} onTransition={handleTransition} onHandoff={(order,action)=>{setDetail(null);setHandoff({order,action});}} onReceipt={handleReceipt} onOpenReceipt={handleOpenReceipt}/>} {editor!==null&&<OrderEditor error={error} order={editor||null} onClose={()=>{setEditor(null);setError("");}} onSave={handleSaveOrder}/>} {assignment&&<AssignmentModal error={error} order={assignment} couriers={couriers} onClose={()=>{setAssignment(null);setError("");}} onSave={handleAssign}/>} {handoff&&<HandoffModal error={error} order={handoff.order} action={handoff.action} staff={staff} onClose={()=>{setHandoff(null);setError("");}} onConfirm={handleTransition}/>} {toast&&<div className="toast">✓ {toast}</div>}
  </div>;
}

export default App;
