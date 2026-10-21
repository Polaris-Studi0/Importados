const c = $('Validar turno y contexto').first().json.context;
if (Date.parse(c.expires_at) <= Date.now()) return JSON.stringify({status:'stale_context'});
let q={};
try { const arg=typeof query!=='undefined'?query:$input.first().json; q=typeof arg==='string'?JSON.parse(arg||'{}'):(arg||{}); } catch { return JSON.stringify({status:'invalid_arguments',hint:'Usa un objeto JSON como texto.'}); }
if (!q || typeof q!=='object' || Array.isArray(q)) return JSON.stringify({status:'invalid_arguments'});
const available = p => p.active && p.stock_verified && p.available_quantity>0 && Date.parse(p.stock_valid_until)>Date.now() && (!p.offer_starts_at||Date.parse(p.offer_starts_at)<=Date.now()) && (!p.offer_ends_at||Date.parse(p.offer_ends_at)>Date.now());
const reasons=['human_request','missing_information','stock_check','payment_review','pqrs'];
if(!reasons.includes(q.reason)||typeof q.question!=='string'||!q.question.trim()) return JSON.stringify({status:'invalid_arguments'});
return JSON.stringify({status:'handoff_proposal',reason:q.reason,question:q.question.trim().slice(0,800),related_message_id:c.message.id,registered:false,notified:false});

