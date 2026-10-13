import {useEffect,useRef,useState} from 'react';
import {isDemoMode} from './lib/supabase.js';
const time=value=>new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short'}).format(new Date(value));
export default function BranchChat({profile,branch,onBranch,chat}){
 const [draft,setDraft]=useState(''),[sendError,setSendError]=useState(''),[loadingOlder,setLoadingOlder]=useState(false),[hasOlder,setHasOlder]=useState(true);
 const attempt=useRef(null),bottom=useRef(null),lastId=chat.messages.at(-1)?.id;
 useEffect(()=>{setDraft('');setSendError('');setHasOlder(true);attempt.current=null;},[branch]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'});},[lastId,branch]);
 async function submit(e){e?.preventDefault();const text=draft.trim();if(!text||chat.busy)return;setSendError('');
  const old=attempt.current;if(!old||old.body!==text||old.branch!==branch)attempt.current={id:crypto.randomUUID(),body:text,branch};
  try{await chat.send(text,attempt.current.id);setDraft('');attempt.current=null;}catch{setSendError('No pudimos confirmar el envío. Reintenta el mismo mensaje; no se enviará dos veces.');}
 }
 async function older(){setLoadingOlder(true);try{const n=await chat.older();setHasOlder(n===50);}catch{setSendError('No se pudo cargar el historial anterior.');}finally{setLoadingOlder(false);}}
 const selected=chat.overview.find(b=>b.branch_id===branch);
 return <section className="branch-chat"><div className="section-title"><div><p className="eyebrow">COMUNICACIÓN INTERNA</p><h2>{profile.role==='admin'?'Chat con sedes':'Chat con administración'}</h2></div><div>
 {chat.permission==='granted'?<small>Avisos de escritorio activados</small>:chat.permission==='denied'?<small>Los avisos están bloqueados. Puedes habilitarlos en los permisos del navegador.</small>:chat.permission==='unsupported'?<small>Este navegador no admite avisos de escritorio. Revisa el contador de mensajes.</small>:<button className="secondary" onClick={chat.enableNotifications}>Activar avisos de escritorio</button>}
 </div></div><p className="form-note">Los avisos funcionan mientras la intranet esté abierta. Pulsa un aviso para abrir el chat.</p>
 {isDemoMode&&<p className="operator-error">Conecta Supabase para usar el chat entre usuarios reales.</p>}{chat.error&&<p role="alert" className="operator-error">{chat.error}</p>}
 <div className="branch-chat-layout"><nav className="branch-chat-sedes" aria-label="Conversaciones por sede">{chat.overview.map(b=><button key={b.branch_id} className={branch===b.branch_id?'selected':''} disabled={chat.busy} onClick={()=>onBranch(b.branch_id)}><strong>{profile.role==='admin'?b.name:'Administración'}</strong>{Number(b.unread)>0&&<span className="chat-unread">{b.unread}</span>}<small>{b.last_message?.body||'Iniciar conversación'}</small></button>)}</nav>
 <div className="branch-chat-room"><header><h3>{selected?profile.role==='admin'?selected.name:`Administración · ${selected.name}`:'Selecciona una sede'}</h3><small>Conversación privada del equipo de esta sede</small></header>
 <div className="branch-chat-messages" aria-label="Mensajes de la conversación">{branch&&chat.messages.length>=50&&hasOlder&&<button className="secondary" onClick={older} disabled={loadingOlder}>{loadingOlder?'Cargando…':'Ver mensajes anteriores'}</button>}{branch&&!chat.messages.length&&<p className="empty">Escribe el primer mensaje para coordinar con el equipo.</p>}
 {chat.messages.map(m=><article key={m.id} className={`branch-chat-bubble ${m.sender_id===profile.id?'own':''}`}><small><b>{m.sender_name}</b> · {m.sender_role==='admin'?'Administración':'Sede'}</small><p>{m.body}</p><time dateTime={m.created_at}>{time(m.created_at)}</time></article>)}<div ref={bottom}/></div>
 <form className="branch-chat-compose" onSubmit={submit}><label className="sr-only" htmlFor="internalMessage">Escribe un mensaje</label><textarea id="internalMessage" value={draft} maxLength={4000} placeholder="Escribe un mensaje…" disabled={!branch||chat.busy||isDemoMode} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit();}}}/><button className="primary" disabled={!branch||!draft.trim()||chat.busy||isDemoMode}>{chat.busy?'Enviando…':'Enviar'}</button><small>Enter para enviar · Mayús + Enter para cambiar de línea</small></form>
 {sendError&&<p role="alert" className="operator-error">{sendError}</p>}</div></div></section>;
}
