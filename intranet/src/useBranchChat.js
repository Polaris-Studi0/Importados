import {useCallback,useEffect,useRef,useState} from 'react';
import {isDemoMode} from './lib/supabase.js';
import {chatOverview,chatMessages,sendChatMessage,markChatRead,watchChat,mergeChatMessages} from './lib/internal-chat.js';
export default function useBranchChat(profile,branch,open,onOpen){
 const [overview,setOverview]=useState([]),[messages,setMessages]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [permission,setPermission]=useState(()=>typeof Notification==='undefined'?'unsupported':Notification.permission);
 const context=useRef({}),lastSeen=useRef(new Map()),notified=useRef(new Set()),running=useRef(false),resync=useRef(false),loaded=useRef(false);
 context.current={branch,open,onOpen,profile,overview};
 const announce=useCallback((m,branches)=>{
  const c=context.current;if(!c.profile||!m||m.sender_id===c.profile?.id||notified.current.has(String(m.id)))return;
  notified.current.add(String(m.id));if(notified.current.size>1000)notified.current.delete(notified.current.values().next().value);
  if(c.open&&c.branch===m.branch_id&&document.visibilityState==='visible'&&document.hasFocus())return;
  if(typeof Notification==='undefined'||Notification.permission!=='granted')return;
  try{const n=new Notification(branches.find(b=>b.branch_id===m.branch_id)?.name||'Chat de sedes',{body:`${m.sender_name||'Equipo'} envió un mensaje. Abre la intranet para leerlo.`,icon:'/logo.png',tag:'internal-chat-'+m.id});n.onclick=()=>{window.focus();c.onOpen(m.branch_id);n.close();};}catch{/* The unread counter remains available on unsupported devices. */}
 },[]);
 const refresh=useCallback(async()=>{
  if(!profile||isDemoMode)return;if(running.current){resync.current=true;return;}running.current=true;
  try{
   const items=await chatOverview();if(context.current.profile?.id!==profile.id)return;
   for(const b of items){const prior=lastSeen.current.get(b.branch_id)||0;if(loaded.current&&b.last_message?.id>prior)announce({...b.last_message,branch_id:b.branch_id},items);lastSeen.current.set(b.branch_id,b.last_message?.id||0);}
   loaded.current=true;setOverview(items);
   const c=context.current;if(c.open&&c.branch){
    const next=await chatMessages(c.branch);if(context.current.profile?.id!==profile.id||context.current.branch!==c.branch||!context.current.open)return;
    setMessages(old=>mergeChatMessages(old.filter(m=>m.branch_id===c.branch),next));
    const through=next.at(-1)?.id;
    if(through&&document.visibilityState==='visible'&&document.hasFocus()&&items.find(b=>b.branch_id===c.branch)?.unread>0){await markChatRead(c.branch,through);const updated=await chatOverview();if(context.current.profile?.id===profile.id)setOverview(updated);}
   }
   setError('');
  }catch{if(context.current.profile?.id===profile.id)setError('No se pudo sincronizar el chat. Volveremos a intentar en unos segundos.');}
  finally{running.current=false;if(resync.current){resync.current=false;setTimeout(()=>refresh(),0);}}
 },[profile,announce]);
 useEffect(()=>{
  lastSeen.current=new Map();notified.current=new Set();loaded.current=false;setOverview([]);setMessages([]);
  if(!profile||isDemoMode)return;
  refresh();const stop=watchChat(profile,m=>{if(context.current.profile?.id!==profile.id)return;if(m)announce(m,context.current.overview);refresh();});
  const focus=()=>{if(typeof Notification!=='undefined')setPermission(Notification.permission);refresh();};
  const timer=setInterval(refresh,10000);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',refresh);
  return()=>{stop();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',refresh);};
 },[profile,refresh,announce]);
 useEffect(()=>{setMessages([]);refresh();},[branch,open,refresh]);
 async function send(body,requestId){
  const selected=context.current.branch;if(!selected||isDemoMode)throw Error('Conecta la intranet para enviar mensajes.');setBusy(true);
  try{const saved=await sendChatMessage(selected,body,requestId);if(context.current.branch===selected)setMessages(old=>mergeChatMessages(old,[saved]));await refresh();return saved;}
  finally{setBusy(false);}
 }
 async function older(){if(!messages.length)return;const selected=branch;const next=await chatMessages(selected,messages[0].id);if(context.current.branch===selected)setMessages(old=>mergeChatMessages(next,old));return next.length;}
 async function enableNotifications(){if(typeof Notification==='undefined')return;try{setPermission(await Notification.requestPermission());}catch{setPermission('unsupported');}}
 return {overview,messages,error,busy,send,older,permission,enableNotifications,unread:overview.reduce((sum,b)=>sum+Number(b.unread||0),0)};
}
