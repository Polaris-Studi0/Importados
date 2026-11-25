const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function intakeControl(text){
 const n=normalize(text);
 if(/^(?:si|si acepto|yo acepto|si yo acepto|acepto|si acepto gracias|acepto gracias|si gracias|hola|buenas|buenos dias|buenas tardes|buenas noches|1|2)$/.test(n))return true;
 if(/\b(?:niquia|santa lucia)\b/.test(n)&&!n.replace(/\b(?:niquia|santa lucia|en|la|de|sede|para|porfa|por|favor|quiero|esa|me|atienda|atiendan)\b/g,'').trim())return true;
 return false;
}
export function intakeRequest(history,current){
 const isMenu=text=>/\bsedes\b/.test(normalize(text))&&/muestr|cuales|que sedes|todas/.test(normalize(text));
 if(current?.trim()&&!intakeControl(current))return isMenu(current)?'':current.trim().slice(0,2000);
 for(const m of [...history].reverse()){
  if(m.role!=='customer'){
   if(/asistente virtual|GRUPO EMPRESARIAL ORIENTE|autoriza.*datos|Para continuar, responde|¿En qu[eé] sede|Nuestro horario de atenci[oó]n|Atendemos de 9:00|Ya estamos atendiendo/i.test(m.text||''))continue;
   return '';
  }
  if(!m.text?.trim()||intakeControl(m.text))continue;
  if(isMenu(m.text))return '';
  return m.text.trim().slice(0,2000);
 }
 return '';
}
