import { isDemoMode, supabase } from "./supabase.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

function client() {
  if (isDemoMode || !supabase) throw new Error("Esta acción requiere la conexión real. En demostración no se guardan datos.");
  return supabase;
}

function check(result) {
  if (result.error) {
    if (["42501", "PGRST301"].includes(result.error.code)) throw new Error("Tu acceso no permite esta acción. Vuelve a iniciar sesión o consulta a administración.");
    throw new Error(result.error.message || "No pudimos completar la operación. Intenta de nuevo.");
  }
  return result.data;
}

function text(value, max, label, required = false, min = required ? 1 : 0) {
  const clean = String(value ?? "").trim();
  if (clean.length < min || clean.length > max) throw new Error(`${label}: usa entre ${min} y ${max} caracteres.`);
  return clean;
}

export async function listCommerce() {
  if (isDemoMode) return { products: [], inventory: [], knowledge: [] };
  const results = await Promise.all([
    client().from("products").select("*").order("name"),
    client().from("branch_inventory").select("*"),
    client().from("branch_knowledge").select("*").order("topic")
  ]);
  return { products: check(results[0]) || [], inventory: check(results[1]) || [], knowledge: check(results[2]) || [] };
}

export async function saveProduct(product) {
  const price = Number(product.price);
  if (!Number.isSafeInteger(price) || price < 0 || price > 999999999) throw new Error("El precio debe ser un valor entero en pesos mayor o igual a cero.");
  const row = {
    name: text(product.name, 160, "Nombre", true, 2),
    sku: text(product.sku, 80, "Referencia") || null,
    category: text(product.category, 100, "Categoría") || "General",
    description: text(product.description, 3000, "Descripción"),
    price,
    active: Boolean(product.active),
    storage_path: product.storage_path || null
  };
  const query = product.id ? client().from("products").update(row).eq("id", product.id) : client().from("products").insert(row);
  return check(await query.select().single());
}

export async function uploadProductImage(file) {
  const extension = IMAGE_TYPES.get(file?.type);
  if (!extension || !file.size || file.size > MAX_IMAGE_BYTES) throw new Error("Selecciona una imagen JPG, PNG o WebP de máximo 5 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(extension === "jpg" ? jpeg : extension === "png" ? png : webp)) throw new Error("El archivo no corresponde al formato de imagen indicado. Selecciona una imagen JPG, PNG o WebP válida.");
  const path = `${crypto.randomUUID()}.${extension}`;
  check(await client().storage.from("product-images").upload(path, file, { contentType: file.type, upsert: false }));
  return path;
}

export async function getProductImageUrl(path) {
  if (!path || isDemoMode) return "";
  const data = check(await client().storage.from("product-images").createSignedUrl(path, 300));
  return data.signedUrl;
}

export async function setInventory(branchId, productId, quantity) {
  const parsed = Number(quantity);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 100000000) throw new Error("Las existencias deben ser un número entero mayor o igual a cero.");
  return check(await client().rpc("set_branch_inventory", { p_branch_id: branchId, p_product_id: productId, p_quantity: parsed }));
}

export async function listInventoryEvents(productId, branchId) {
  if (isDemoMode) return [];
  return check(await client().from("inventory_events").select("*").eq("product_id", productId).eq("branch_id", branchId).order("created_at", { ascending: false }).limit(25)) || [];
}

export async function saveKnowledge(item) {
  const row = { branch_id: item.branch_id || null, topic: text(item.topic, 160, "Tema", true, 2), content: text(item.content, 6000, "Contenido", true), active: Boolean(item.active) };
  const query = item.id ? client().from("branch_knowledge").update(row).eq("id", item.id) : client().from("branch_knowledge").insert(row);
  return check(await query.select().single());
}

export async function listVacancies() {
  if (isDemoMode) return [];
  return check(await client().from("vacancies").select("*").order("created_at", { ascending: false })) || [];
}

export async function saveVacancy(item) {
  const row = {
    title: text(item.title, 160, "Nombre del cargo", true, 3), branch_id: item.branch_id || null,
    description: text(item.description, 6000, "Descripción", true, 10), requirements: text(item.requirements, 6000, "Requisitos")
  };
  // Editar contenido no modifica el estado: otro administrador puede haber cerrado la vacante.
  const query = item.id ? client().from("vacancies").update(row).eq("id", item.id) : client().from("vacancies").insert({ ...row, status: "draft" });
  return check(await query.select().single());
}

export async function changeVacancyStatus(id, status) {
  if (!["draft", "published", "closed"].includes(status)) throw new Error("Estado de vacante inválido.");
  return check(await client().from("vacancies").update({ status }).eq("id", id).select().single());
}

function searchFilter(term) {
  // PostgREST requiere comillas para que una coma del usuario no añada otro filtro.
  const value = String(term).trim().slice(0, 160).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `name.ilike."*${value}*",receipt.ilike."*${value}*",email.ilike."*${value}*"`;
}

export async function listApplications({ page = 0, pageSize = 40, status = "all", branch = "all", search = "" } = {}) {
  if (isDemoMode) return { items: [], total: 0 };
  let query = client().from("job_applications").select("id,receipt,name,email,phone,branch,object_path,created_at,updated_at,review_status,internal_notes,vacancy_id", { count: "exact" }).eq("status", "received").order("created_at", { ascending: false }).order("id");
  if (status !== "all") query = query.eq("review_status", status);
  if (branch !== "all") query = query.eq("branch", branch);
  if (search.trim()) query = query.or(searchFilter(search));
  const result = await query.range(page * pageSize, page * pageSize + pageSize - 1);
  return { items: check(result) || [], total: result.count || 0 };
}

export async function reviewApplication(id, status, notes) {
  if (!["new", "reviewing", "contacted", "archived"].includes(status)) throw new Error("Estado de revisión inválido.");
  return check(await client().rpc("review_application", { p_id: id, p_status: status, p_notes: text(notes, 6000, "Notas internas") }));
}

export async function listApplicationEvents(id) {
  if (isDemoMode) return [];
  return check(await client().from("application_events").select("id,actor_name,status_before,status_after,internal_notes,created_at").eq("application_id", id).order("created_at", { ascending: false }).limit(25)) || [];
}

export async function getApplicationPdfUrl(path) {
  if (!path) throw new Error("Esta postulación no tiene un archivo disponible.");
  const data = check(await client().storage.from("hojas-de-vida").createSignedUrl(path, 300));
  return data.signedUrl;
}

export async function listPqrsCases() {
  if (isDemoMode) return [];
  return check(await client().from("pqrs_cases").select("id,case_number,type,branch_id,customer_name,customer_email,customer_phone,subject,description,status,internal_notes,response_message,created_at,updated_at,branch:branches(name)").order("created_at", { ascending: false })) || [];
}

export async function listPqrsEvents(id) {
  if (isDemoMode) return [];
  return check(await client().from("pqrs_case_events").select("*").eq("case_id", id).order("created_at", { ascending: false })) || [];
}

export async function updatePqrsCase(id, values) {
  const row = check(await client().rpc("update_pqrs_case", {
    p_id: id, p_status: values.status, p_notes: text(values.internal_notes, 6000, "Notas internas"),
    p_response: text(values.response_message, 10000, "Respuesta")
  }));
  return { case: Array.isArray(row) ? row[0] : row, email_sent: false };
}

export function subscribeModules(tables, onChange) {
  if (isDemoMode || !supabase) return () => {};
  let active = true;
  const refresh = () => { if (active) onChange(); };
  let channel = supabase.channel(`modules-${crypto.randomUUID()}`);
  for (const table of tables) channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
  channel.subscribe();
  // Respaldo de lectura: también funciona si Realtime no entrega un cambio.
  const timer = setInterval(refresh, 10000);
  return () => { active = false; clearInterval(timer); void supabase.removeChannel(channel); };
}
