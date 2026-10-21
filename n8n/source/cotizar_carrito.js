const c = $('Validar turno y contexto').first().json.context;
if (Date.parse(c.expires_at) <= Date.now()) return JSON.stringify({status:'stale_context'});
let q={};
try { const arg=typeof query!=='undefined'?query:$input.first().json; q=typeof arg==='string'?JSON.parse(arg||'{}'):(arg||{}); } catch { return JSON.stringify({status:'invalid_arguments',hint:'Usa un objeto JSON como texto.'}); }
if (!q || typeof q!=='object' || Array.isArray(q)) return JSON.stringify({status:'invalid_arguments'});
const available = p => p.active && p.stock_verified && p.available_quantity>0 && Date.parse(p.stock_valid_until)>Date.now() && (!p.offer_starts_at||Date.parse(p.offer_starts_at)<=Date.now()) && (!p.offer_ends_at||Date.parse(p.offer_ends_at)>Date.now());
if(!Array.isArray(q.items)||q.items.length<1||q.items.length>10) return JSON.stringify({status:'invalid_items'});
const totals=new Map();
for(const i of q.items){
 if(!i||typeof i.product_id!=='string'||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>99) return JSON.stringify({status:'invalid_items'});
 totals.set(i.product_id,(totals.get(i.product_id)||0)+i.quantity);
}
const lines=[];
for(const [id,qty] of totals){
 const p=c.products.find(p=>p.id===id);
 if(!p||!available(p)||qty>p.available_quantity) return JSON.stringify({status:'needs_verification',product_id:id,reserved:false});
 lines.push({product_id:id,name:p.name,quantity:qty,unit_price_cop:p.price_cop,line_total_cop:p.price_cop*qty});
}
const subtotal_cop=lines.reduce((sum,i)=>sum+i.line_total_cop,0);
if(!Number.isSafeInteger(subtotal_cop)) return JSON.stringify({status:'invalid_total'});
return JSON.stringify({status:'quote_preview',source:c.source,items:lines,subtotal_cop,delivery_included:false,reserved:false,order_created:false,payment_approved:false});

