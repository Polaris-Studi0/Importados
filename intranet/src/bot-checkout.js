// Read unambiguous checkout replies from the customer's own words. The model
// handles free prose and ambiguous requests. Explicit labelled lists can be
// persisted together without a model call or losing the other fields.
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function personName(value){
  const name=value.trim().replace(/[,\s]+(?:porfa|por favor|gracias)[.!]*$/i,'').replace(/[.!]+$/,'').trim();
  if(!/^[\p{L}][\p{L}\p{M}'’ -]{0,79}$/u.test(name)||name.split(/\s+/).length>7)return null;
  if(/\by\b/.test(normalize(name)))return null; // Two possible people need interpretation.
  if(/\b(?:soy|tengo|voy|estoy|ya|te|yo|un|una|eso|ese|esta|es|para|pero|mejor|otro|otra|pregunta|duda|momento|envio|entrega|sede|stock|producto|imagen|foto)\b/.test(normalize(name)))return null;
  if(/\b(?:hola|si|no|gracias|listo|bueno|domicilio|recoger|recibo|recibe|telefono|celular|direccion|barrio|aqui|alli|mismo|precio|cuanto|quiero|tienen|cancel\w*|pagar|disfraz|pedido|prefiero|necesito|ayuda|continu\w*)\b/.test(normalize(name))||/^(?:de acuerdo|por supuesto|esta bien|buenos dias|buenas tardes)$/.test(normalize(name)))return null;
  return name;
}
function contactPhone(value){
  if(!/^\+?[\d ()-]+$/.test(value.trim()))return null;
  const digits=value.replace(/\D/g,'');
  return /^\d{10,15}$/.test(digits)?digits:null;
}
function labelledFields(value,cart,lastAssistant){
  const label='(?:nombre(?: para la compra(?: y de quien recibe)?| del comprador| del destinatario| de quien recibe| del que recibe)?|comprador|cliente|a nombre de|recibe|destinatario|tel[eé]fono(?: de contacto)?|n[uú]mero(?: de contacto)?|celular|direcci[oó]n(?: completa| de entrega)?|barrio(?: o sector)?|sector|modalidad|entrega)';
  const parts=value.split(new RegExp('\\r?\\n|;|,\\s*(?='+label+'\\s*:)','i'));
  const patch={};let sawLabel=false;
  for(let part of parts){
    part=part.trim().replace(/^(?:[-•*]|\d+[.)])\s*/,'');
    if(!part||/^(?:gracias|porfa|por favor)[.!]*$/i.test(part))continue;
    const match=/^([^:]{1,65}):\s*(.*)$/.exec(part);
    // Any free prose or unlabelled line must go through the model, so a
    // partial direct parse cannot swallow a product change or another field.
    if(!match)return null;
    const key=normalize(match[1]),raw=match[2].trim();let fields=[];
    if(['nombre','nombre para la compra y de quien recibe'].includes(key)){
      const combined=key!=='nombre'||/basta un nombre/i.test(lastAssistant);
      fields=combined&&cart.fulfillment_type==='delivery'?['customer_name','recipient_name']:['customer_name'];
      if(key==='nombre'&&cart.customer_name&&!cart.recipient_name&&/nombre de quien recibe/i.test(lastAssistant))fields=['recipient_name'];
      if(combined&&cart.fulfillment_type==='delivery'&&cart.customer_name&&!cart.recipient_name)fields=['recipient_name'];
      if(combined&&cart.fulfillment_type==='delivery'&&cart.recipient_name&&!cart.customer_name)fields=['customer_name'];
    }else if(['nombre para la compra','nombre del comprador','comprador','cliente','a nombre de'].includes(key))fields=['customer_name'];
    else if(['nombre del destinatario','nombre de quien recibe','nombre del que recibe','recibe','destinatario'].includes(key))fields=['recipient_name'];
    else if(['telefono','telefono de contacto','numero','numero de contacto','celular'].includes(key))fields=['recipient_phone'];
    else if(['direccion','direccion completa','direccion de entrega'].includes(key))fields=['delivery_address'];
    else if(['barrio','barrio o sector','sector'].includes(key))fields=['delivery_zone'];
    else if(['modalidad','entrega'].includes(key))fields=['fulfillment_type'];
    else return null;
    sawLabel=true;if(!raw)continue;
    let parsed=raw;
    if(fields.some(f=>f.endsWith('_name'))){parsed=personName(raw);if(!parsed)return null;}
    else if(fields[0]==='recipient_phone')parsed=contactPhone(raw);
    else if(fields[0]==='fulfillment_type')parsed=/^(?:a )?domicilio$/i.test(raw)?'delivery':/^(?:recoger|recogida|pickup)(?: en (?:la )?sede)?$/i.test(raw)?'pickup':null;
    else if(raw.length>300||/\?|\b(?:no se|no tengo|luego|despues)\b/.test(normalize(raw)))parsed=null;
    if(!parsed)continue;
    for(const field of fields){if(patch[field]&&patch[field]!==parsed)return null;patch[field]=parsed;}
  }
  return sawLabel?patch:null;
}
function explicitFields(message,cart={},lastAssistant=''){
  if(message.kind!=='text')return {};
  const value=message.text?.trim()||'',n=normalize(value),patch={};
  const labelled=labelledFields(value,cart,lastAssistant);
  if(labelled!==null)return labelled;
  if(/^(?:a domicilio|domicilio|lo quiero a domicilio|envio a domicilio)[.!]?$/.test(n))patch.fulfillment_type='delivery';
  if(/^(?:lo recojo(?: en la sede)?|recogida(?: en sede)?|recoger(?: en la sede)?)[.!]?$/.test(n))patch.fulfillment_type='pickup';
  const buyer=/^(?:a nombre de|mi nombre es|me llamo)\s+(.+)$/i.exec(value);
  if(buyer){const name=personName(buyer[1]);if(name)patch.customer_name=name;}
  const recipient=/^(?:recibe|lo recibe|quien recibe es)\s+(.+)$/i.exec(value);
  if(recipient){const name=personName(recipient[1]);if(name)patch.recipient_name=name;}
  if(/^(?:recibo yo|lo recibo yo|yo recibo)[.!]?$/.test(n)&&cart.customer_name)patch.recipient_name=cart.customer_name;
  const phone=value.replace(/^(?:(?:mi|el) (?:tel[eé]fono|n[uú]mero)(?: (?:de contacto|para el env[ií]o))?(?: es)?\s*:?\s*)/i,'');
  const digits=contactPhone(phone);if(digits)patch.recipient_phone=digits;
  return patch;
}
export function recoveredCheckoutFields(context){
  const s=context.snapshot,cart=s.checkout||{};
  if(!['collecting','stock_review'].includes(cart.stage)||!(cart.pending_selection||cart.cart?.length))return {};
  const patch={};
  // Recover only explicit missing fields in the current quotation's customer
  // messages. Never read the profile name or an older/foreign purchase.
  for(const m of s.checkout_inputs||[]){
    if(m.id===s.message.id)continue;
    for(const [key,value] of Object.entries(explicitFields(m)))if(!cart[key])patch[key]=value;
  }
  return patch;
}
export function checkoutReply(context){
  const s=context.snapshot,cart=s.checkout||{};
  if(!['collecting','stock_review'].includes(cart.stage)||!(cart.pending_selection||cart.cart?.length))return null;
  const patch=recoveredCheckoutFields(context);
  const lastAssistant=[...(s.history||[])].reverse().find(m=>m.role==='assistant')?.text||'';
  const current=explicitFields(s.message,cart,lastAssistant);
  if(!Object.keys(current).length&&s.message.kind==='text'){
    const expected=/a nombre de qui[eé]n|cu[aá]l es tu nombre|c[oó]mo te llamas|nombre para la compra/i.test(lastAssistant)&&!cart.customer_name?'customer_name':/qui[eé]n recibe|nombre de quien recibe/i.test(lastAssistant)?'recipient_name':null;
    const name=expected&&personName(s.message.text||'');
    const combined=/basta un nombre/i.test(lastAssistant)&&cart.fulfillment_type==='delivery'&&!cart.customer_name&&!cart.recipient_name;
    const combinedName=combined&&personName(s.message.text||'');
    if(combinedName&&normalize(combinedName).replace(/\s/g,'')!==normalize(cart.pending_selection?.name).replace(/\s/g,'')){current.customer_name=combinedName;current.recipient_name=combinedName;}
    else if(name&&normalize(name).replace(/\s/g,'')!==normalize(cart.pending_selection?.name).replace(/\s/g,''))current[expected]=name;
  }
  if(!Object.keys(current).length&&!(Object.keys(patch).length&&/^(?:contin[uú]a|continuar|continuemos|sigamos|listo)[.!]?$/i.test(s.message.text?.trim()||'')))return null;
  Object.assign(patch,current);
  return {intent:'checkout',reply_text:'Continuemos con los datos de tu compra.',checkout:patch,confirmed_item:null,actions:[],accept_summary:false,cancel_cart:false};
}
