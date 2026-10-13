import {BRANCHES} from './constants.js';
// Datos aislados en memoria: nunca se consultan ni guardan en producción.
const state={orders:[],couriers:[],staff:[],events:[]},listeners=new Set();
const branch=id=>BRANCHES.find(x=>x.id===id),visible=(row,profile)=>profile.role==='admin'||row.branch_id===profile.branch_id;
function changed(){listeners.forEach(fn=>fn());}
function event(order,before,profile){state.events.unshift({id:crypto.randomUUID(),order_id:order.id,action:before?'updated':'created',before_data:before,after_data:structuredClone(order),actor_name:profile?.full_name||'Demostración',created_at:new Date().toISOString()});changed();}
export const demoStore={
 watch:fn=>listeners.add(fn),unwatch:fn=>listeners.delete(fn),
 listOrders:async profile=>state.orders.filter(x=>visible(x,profile)).map(x=>({...x,branch:branch(x.branch_id),courier:state.couriers.find(c=>c.id===x.courier_id)})),
 listCouriers:async()=>state.couriers,
 listStaff:async profile=>state.staff.filter(x=>visible(x,profile)).map(x=>({...x,branch:branch(x.branch_id)})),
 listEvents:async profile=>state.events.filter(x=>state.orders.some(o=>o.id===x.order_id&&visible(o,profile))),
 saveOrder:async(values,profile)=>{const existing=state.orders.find(x=>x.id===values.id);const before=existing?structuredClone(existing):null;const saved={...values,id:existing?.id||crypto.randomUUID(),order_number:existing?.order_number||`IMP-${1001+state.orders.length}`,status:existing?.status||'preparing',total:values.items.reduce((s,x)=>s+Number(x.qty)*Number(x.unit_price),0),created_at:existing?.created_at||new Date().toISOString(),updated_at:new Date().toISOString(),version:(existing?.version||0)+1};if(existing)Object.assign(existing,saved);else state.orders.unshift(saved);event(saved,before,profile);return saved;},
 transition:async(id,action,profile,staffId)=>{const saved=state.orders.find(x=>x.id===id);if(!saved||!visible(saved,profile))throw Error('Pedido no disponible.');const before=structuredClone(saved);const map={ready:'ready',dispatch:'dispatched',pickup:'delivered',delivered:'delivered',cancel:'cancelled'};saved.status=map[action];saved.updated_at=new Date().toISOString();saved.handoff_staff_name=state.staff.find(x=>x.id===staffId)?.full_name;event(saved,before,profile);return saved;},
 saveStaff:async value=>{const saved={...value,id:value.id||crypto.randomUUID()};const old=state.staff.find(x=>x.id===saved.id);if(old)Object.assign(old,saved);else state.staff.push(saved);changed();return saved;},
 saveCourier:async value=>{const saved={...value,id:value.id||crypto.randomUUID()};const old=state.couriers.find(x=>x.id===saved.id);if(old)Object.assign(old,saved);else state.couriers.push(saved);changed();return saved;}
};
