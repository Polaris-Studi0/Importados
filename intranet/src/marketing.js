const PLAN = 'noviembre-2026';
const SHARE_PATH = '/calendario-compartido/';
const ID = /^[PRESA][0-9]{2,4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const STATES = ['planned','production','review','approved','published'];
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const safe = row => ({...row.data, id:row.id, revision:row.revision, updated_at:row.updated_at});
const protectedJson = (h, data, status, origin) => {
 const r=h.json(data,status,origin);r.headers.set('Referrer-Policy','no-referrer');r.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');return r;
};
export function validateCalendarChange(body, previous, reject) {
 if(!Number.isInteger(body.revision)||body.revision<1)reject(400,'Actualiza la pieza antes de editar.');
 const patch=body.changes;
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['date','end_date','time','status','caption','production_notes','checks','outline','script'].includes(k)))reject(400,'Cambio no permitido.');
 const next={...previous,...patch};
 for(const k of ['date','end_date'])if(typeof next[k]!=='string'||!/^202[6-9]-\d{2}-\d{2}$/.test(next[k])||Number.isNaN(Date.parse(next[k]+'T12:00:00Z'))||new Date(next[k]+'T12:00:00Z').toISOString().slice(0,10)!==next[k])reject(400,'Revisa las fechas.');
 if(next.end_date<next.date||next.end_date>new Date(Date.parse(next.date+'T12:00:00Z')+366*86400000).toISOString().slice(0,10))reject(400,'Revisa el rango de fechas.');
 if(typeof next.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)||!STATES.includes(next.status))reject(400,'Revisa la hora o el estado.');
 if(typeof next.caption!=='string'||next.caption.length>7000||typeof next.production_notes!=='string'||next.production_notes.length>5000||!Array.isArray(next.checks)||next.checks.length>20||next.checks.some(x=>typeof x!=='string'||!x.trim()||x.length>1800))reject(400,'Revisa el texto y los pendientes.');
 if(!Array.isArray(next.outline)||next.outline.length>30||next.outline.some(x=>typeof x!=='string'||!x.trim()||x.length>1800)||!Array.isArray(next.script)||next.script.length>20||next.script.some(s=>!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['time','visual','voice','text'].includes(k))||['time','visual','voice','text'].some(k=>typeof s[k]!=='string'||s[k].length>1600)))reject(400,'Revisa las láminas y los planos del guion.');
 if(['approved','published'].includes(next.status)&&next.checks.length)reject(409,'Resuelve los pendientes antes de aprobar o marcar como publicado.');
 return next;
}
export async function handleMarketing(request,env,origin,h){
 const path=new URL(request.url).pathname;
 const out=(data,status=200)=>protectedJson(h,data,status,origin);
 if(path==='/api/marketing/view'){
  if(request.method!=='POST')h.reject(405,'Método no permitido.');
  await h.rate(request,env,'marketing-view');const body=await h.boundedJson(request);
  if(!TOKEN.test(body.token||''))h.reject(404,'Este enlace no está disponible o venció.');
  const r=await h.db(env,`marketing_share_links?token_hash=eq.${await hash(body.token)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=plan_id,label,expires_at&limit=1`);
  if(!r.ok)h.reject(503,'No pudimos consultar el calendario.');const [link]=await r.json();
  if(!link)h.reject(404,'Este enlace no está disponible o venció.');
  return out({...await readPlan(env,h,link.plan_id),shared:{label:link.label,expires_at:link.expires_at}});
 }
 const admin=await h.requireAdmin(request,env);
 if(path==='/api/marketing/calendar'&&request.method==='GET')return out(await readPlan(env,h,PLAN));
 if(path==='/api/marketing/items'&&request.method==='POST'){
  const body=await h.boundedJson(request);if(!ID.test(body.id||''))h.reject(400,'Pieza no válida.');
  const r=await h.db(env,`marketing_calendar_items?id=eq.${body.id}&plan_id=eq.${PLAN}&select=id,data,revision`);if(!r.ok)h.reject(503,'No pudimos cargar la pieza.');const [item]=await r.json();if(!item)h.reject(404,'Pieza no encontrada.');
  if(item.revision!==body.revision)h.reject(409,'Otra persona actualizó esta pieza. Actualiza el calendario antes de guardar.');
  const data=validateCalendarChange(body,item.data,h.reject);
  const save=await h.db(env,`marketing_calendar_items?id=eq.${item.id}&revision=eq.${body.revision}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({data,revision:body.revision+1,updated_by:admin.id,updated_at:new Date().toISOString()})});
  if(!save.ok)h.reject(503,'No pudimos guardar la pieza.');const [saved]=await save.json();if(!saved)h.reject(409,'La pieza cambió mientras editabas. Actualiza antes de guardar.');
  return out({item:safe(saved)});
 }
 if(path==='/api/marketing/shares'){
  if(request.method==='GET'){
   const r=await h.db(env,`marketing_share_links?plan_id=eq.${PLAN}&select=id,label,created_at,expires_at,revoked_at&order=created_at.desc&limit=100`);if(!r.ok)h.reject(503,'No pudimos cargar los enlaces.');return out({links:await r.json()});
  }
  if(request.method!=='POST')h.reject(405,'Método no permitido.');
  const body=await h.boundedJson(request);
  if(body.action==='revoke'){
   if(!UUID.test(body.id||''))h.reject(400,'Enlace no válido.');
   const r=await h.db(env,`marketing_share_links?id=eq.${body.id}&plan_id=eq.${PLAN}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({revoked_at:new Date().toISOString()})});
   if(!r.ok)h.reject(503,'No pudimos revocar el enlace.');if(!(await r.json()).length)h.reject(404,'Enlace no encontrado.');return out({ok:true});
  }
  if(body.action!=='create'||typeof body.label!=='string'||body.label.trim().length<2||body.label.length>100||![7,30,90].includes(body.days))h.reject(400,'Escribe un nombre y elige la vigencia del enlace.');
  const token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const expires_at=new Date(Date.now()+body.days*86400000).toISOString();
  const r=await h.db(env,'marketing_share_links',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({plan_id:PLAN,label:body.label.trim(),token_hash:await hash(token),expires_at,created_by:admin.id})});
  if(!r.ok)h.reject(503,'No pudimos crear el enlace.');const [link]=await r.json();if(!link)h.reject(503,'No pudimos confirmar el enlace.');
  return out({link:{id:link.id,label:link.label,expires_at},url:new URL(SHARE_PATH,request.url).href+'#'+token},201);
 }
 h.reject(404,'Ruta no encontrada.');
}
async function readPlan(env,h,id){
 if(id!==PLAN)h.reject(404,'Calendario no encontrado.');
 const [p,r]=await Promise.all([h.db(env,`marketing_calendar_plans?id=eq.${PLAN}&select=meta&limit=1`),h.db(env,`marketing_calendar_items?plan_id=eq.${PLAN}&select=id,data,revision,updated_at&order=id&limit=250`)]);
 if(!p.ok||!r.ok)h.reject(503,'No pudimos cargar el calendario.');const [plan]=await p.json();if(!plan)h.reject(404,'El calendario todavía no está disponible.');
 // Only this plan's editorial records are returned; no staff, customer, bot or database fields.
 return {meta:plan.meta,items:(await r.json()).map(safe)};
}
