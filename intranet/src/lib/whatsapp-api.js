import { isDemoMode, supabase } from "./supabase.js";

async function request(path, { body, signal, form, binary = false } = {}) {
  if (isDemoMode || !supabase) throw new Error("WhatsApp requiere una sesión real. La demostración no contiene conversaciones.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Tu sesión terminó. Vuelve a ingresar.");
  const response = await fetch(`/api/whatsapp${path}`, {
    method: body || form ? "POST" : "GET", signal,
    headers: { authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(form ? { body: form } : body ? { body: JSON.stringify(body) } : {})
  });
  if (binary && response.ok) return response.blob();
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401 ? "Tu sesión terminó. Vuelve a ingresar." : response.status === 403 ? "Tu acceso no permite esta acción o esta conversación ya pertenece a otra sede." : response.status === 409 ? result?.message || "La conversación cambió en otra sesión. Actualiza antes de continuar." : result?.message || (response.status === 404 ? "El módulo de WhatsApp aún no está disponible. Actualiza o consulta a administración." : "No pudimos completar la operación. Intenta de nuevo.");
    const error = new Error(message);
    error.status = response.status;
    error.confirmedRejection = response.status >= 400 && response.status < 500 && response.status !== 408;
    throw error;
  }
  if (!result || typeof result !== "object") throw new Error("No pudimos leer la respuesta. Actualiza para intentar de nuevo.");
  if (result.ok === false) { const error = new Error(result.message || "No pudimos completar la operación. Intenta de nuevo."); error.confirmedRejection = true; throw error; }
  return result;
}

export function getWhatsAppStatus(signal) { return request("/status", { signal }); }
export async function listWhatsAppConversations(signal) {
  const result = await request("/conversations", { signal });
  if (!Array.isArray(result.conversations)) throw new Error("No pudimos leer las conversaciones. Actualiza para intentar de nuevo.");
  return result;
}
export async function listWhatsAppTasks(signal) {
  const result = await request("/tasks", { signal });
  if (!Array.isArray(result.tasks)) throw new Error("No pudimos leer las solicitudes. Actualiza para intentar de nuevo.");
  return result;
}
export async function getWhatsAppConversation(id, signal) {
  const result = await request(`/conversations/${encodeURIComponent(id)}`, { signal });
  if (!result.conversation || !Array.isArray(result.messages) || !Array.isArray(result.tasks)) throw new Error("No pudimos leer esta conversación. Actualiza para intentar de nuevo.");
  return result;
}
export function actOnWhatsAppConversation(conversation, values, signal) {
  return request(`/conversations/${encodeURIComponent(conversation.id)}/actions`, {
    signal, body: { ...values, request_id: values.request_id || crypto.randomUUID(), expected_control_version: conversation.control_version }
  });
}
export function previewWhatsApp(text, branchId, signal) {
  return request("/preview", { signal, body: { text, ...(branchId ? { branch_id: branchId } : {}) } });
}

export function uploadWhatsAppPhoto(conversationId,file,requestId,signal) {
 const form=new FormData();form.set("file",file);form.set("request_id",requestId);
 return request(`/conversations/${encodeURIComponent(conversationId)}/media`,{form,signal});
}
export function getWhatsAppPhoto(conversationId,mediaId,signal) {
 return request(`/conversations/${encodeURIComponent(conversationId)}/media/${encodeURIComponent(mediaId)}`,{binary:true,signal});
}
