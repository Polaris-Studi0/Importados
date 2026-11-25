import {supabase} from './supabase.js';
export async function calendarRequest(path,{body,signal,shared=false}={}){
 const headers=body?{'Content-Type':'application/json'}:{};
 if(!shared){if(!supabase)throw new Error('El calendario requiere una sesión real de administración.');const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Inicia sesión para consultar el calendario.');headers.Authorization='Bearer '+session.access_token;}
 const r=await fetch('/api/marketing/'+path,{method:body?'POST':'GET',headers,signal,body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>null);if(!r.ok||!data)throw new Error(data?.message||'No pudimos consultar el calendario. Intenta de nuevo.');return data;
}
