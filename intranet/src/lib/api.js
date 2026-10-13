import {supabase,isDemoMode} from './supabase.js';
import {demoStore} from './demoStore.js';
async function allRows(table,select,order){const rows=[];for(let start=0;;start+=1000){const next=unwrap(await supabase.from(table).select(select).order(order,{ascending:false}).range(start,start+999));rows.push(...next);if(next.length<1000)return rows;}}
const orderSelect='*, branch:branches(id,name), courier:couriers(id,name,plate,phone,provider,active)';
function unwrap(result){if(result.error)throw result.error;return result.data;}
export async function signIn(email,password){if(isDemoMode)throw Error('Usa los accesos de demostración.');return unwrap(await supabase.auth.signInWithPassword({email,password}));}
export async function signOut(){if(!isDemoMode){const {error}=await supabase.auth.signOut();if(error)throw error;}}
export async function getProfile(id,signal){let q=supabase.from('profiles').select('*, branch:branches!profiles_branch_id_fkey(id,name)').eq('id',id).single();if(signal)q=q.abortSignal(signal);return unwrap(await q);}
export async function listOrders(profile){return isDemoMode?demoStore.listOrders(profile):allRows('orders',orderSelect,'created_at');}
export async function listCouriers(){return isDemoMode?demoStore.listCouriers():unwrap(await supabase.from('couriers').select('*').order('active',{ascending:false}).order('name'));}
export async function listStaff(profile){return isDemoMode?demoStore.listStaff(profile):unwrap(await supabase.from('staff_members').select('*,branch:branches(id,name)').order('full_name'));}
export async function listEvents(profile){return isDemoMode?demoStore.listEvents(profile):allRows('order_events','*,order:orders(order_number,branch_id)','created_at');}
export async function saveOrder(values,profile){
 if(isDemoMode)return demoStore.saveOrder(values,profile);
 const keys=['branch_id','fulfillment_type','customer_name','customer_phone','delivery_address','delivery_zone','items','payment_method','payment_reference','source','customer_notes','internal_notes','courier_id','courier_name','courier_plate','courier_phone','courier_provider','delivery_fee','eta_minutes','promised_at'];
 const payload=Object.fromEntries(keys.filter(k=>values[k]!==undefined).map(k=>[k,values[k]]));
 if(values.id){let q=supabase.from('orders').update(payload).eq('id',values.id);if(Number.isInteger(values.version))q=q.eq('version',values.version);const data=unwrap(await q.select(orderSelect).maybeSingle());if(!data)throw Error('El pedido cambió en otra sesión. Actualiza antes de editarlo.');return data;}
 return unwrap(await supabase.from('orders').insert(payload).select(orderSelect).single());
}
export async function transitionOrder(id,action,profile,staffId=null){return isDemoMode?demoStore.transition(id,action,profile,staffId):unwrap(await supabase.rpc('transition_order',{p_order_id:id,p_action:action,p_staff_id:staffId}));}
export async function saveStaff(values){if(isDemoMode)return demoStore.saveStaff(values);const payload={full_name:values.full_name,branch_id:values.branch_id,active:values.active};const q=values.id?supabase.from('staff_members').update(payload).eq('id',values.id):supabase.from('staff_members').insert(payload);return unwrap(await q.select('*,branch:branches(id,name)').single());}
export async function saveCourier(values){if(isDemoMode)return demoStore.saveCourier(values);const payload={name:values.name,plate:values.plate,phone:values.phone,provider:values.provider||'Independiente',active:values.active};const q=values.id?supabase.from('couriers').update(payload).eq('id',values.id):supabase.from('couriers').insert(payload);return unwrap(await q.select().single());}
export async function uploadPaymentReceipt(order,file){
 if(isDemoMode)throw Error('La carga de archivos requiere una sesión real.');
 if(!file?.size||file.size>5242880||!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw Error('Usa JPG, PNG, WEBP o PDF de máximo 5 MB.');
 const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.type];const path=`${order.branch_id}/${order.id}/${crypto.randomUUID()}.${ext}`;
 unwrap(await supabase.storage.from('payment-receipts').upload(path,file,{contentType:file.type,upsert:false}));
 return unwrap(await supabase.rpc('attach_payment_receipt',{p_order_id:order.id,p_path:path,p_name:file.name,p_mime_type:file.type,p_size:file.size}));
}
export async function getPaymentReceiptUrl(path,bucket='payment-receipts'){if(isDemoMode||bucket!=='payment-receipts')throw Error('Archivo no disponible.');return unwrap(await supabase.storage.from(bucket).createSignedUrl(path,300)).signedUrl;}
export function subscribeToOrders(onChange){
 if(isDemoMode){demoStore.watch(onChange);return()=>demoStore.unwatch(onChange);}
 const channel=supabase.channel('orders-'+crypto.randomUUID()).on('postgres_changes',{event:'*',schema:'public',table:'orders'},onChange).on('postgres_changes',{event:'*',schema:'public',table:'staff_members'},onChange).on('postgres_changes',{event:'*',schema:'public',table:'couriers'},onChange).subscribe();
 const timer=setInterval(onChange,15000);return()=>{clearInterval(timer);supabase.removeChannel(channel);};
}
export async function teamRequest(body){if(isDemoMode)throw Error('La gestión de accesos requiere una sesión real.');const {data:{session}}=await supabase.auth.getSession();if(!session)throw Error('Inicia sesión nuevamente.');const r=await fetch('/api/team',{method:body?'POST':'GET',headers:{authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await r.json();if(!r.ok)throw Error(result.message||'No pudimos gestionar el acceso.');return result;}
