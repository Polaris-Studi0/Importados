const c = $('Validar turno y contexto').first().json.context;
if (Date.parse(c.expires_at) <= Date.now()) return JSON.stringify({status:'stale_context'});
let q={};
try { const arg=typeof query!=='undefined'?query:$input.first().json; q=typeof arg==='string'?JSON.parse(arg||'{}'):(arg||{}); } catch { return JSON.stringify({status:'invalid_arguments',hint:'Usa un objeto JSON como texto.'}); }
if (!q || typeof q!=='object' || Array.isArray(q)) return JSON.stringify({status:'invalid_arguments'});
const available = p => p.active && p.stock_verified && p.available_quantity>0 && Date.parse(p.stock_valid_until)>Date.now() && (!p.offer_starts_at||Date.parse(p.offer_starts_at)<=Date.now()) && (!p.offer_ends_at||Date.parse(p.offer_ends_at)>Date.now());
const norm=x=>String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const term=norm(q.query).trim();
const words=x=>norm(x).split(/[^a-z0-9]+/).filter(Boolean).map(t=>t.length>3?t.replace(/s$/,''):t);
const terms=words(term);
const budget=q.max_price_cop===undefined?null:q.max_price_cop;
if (budget!==null&&(!Number.isSafeInteger(budget)||budget<0)) return JSON.stringify({status:'invalid_budget'});
const matched=c.products.filter(p=>(!term||terms.every(t=>words(p.name+' '+p.description).some(w=>w===t)))&&(budget===null||p.price_cop<=budget));
return JSON.stringify({status:'ok',source:c.source,branch:c.branch,operator_confirmed_answers:c.confirmed_answers||[],pending_selection:c.checkout?.pending_selection||null,available:matched.filter(available).slice(0,5),needs_verification:matched.filter(p=>p.active&&(!p.stock_verified||!(Date.parse(p.stock_valid_until)>Date.now()))&&(!p.offer_ends_at||Date.parse(p.offer_ends_at)>Date.now())).slice(0,5).map(p=>({id:p.id,name:p.name,availability:'not_confirmed'})),unavailable:matched.filter(p=>p.active&&p.stock_verified&&Date.parse(p.stock_valid_until)>Date.now()&&p.available_quantity===0).slice(0,5).map(p=>({id:p.id,name:p.name,availability:'out_of_stock'})),note:'No se ha reservado stock. Conserva el orden de las opciones que presentes.'});

