const config = window.LIBRERIA_CONFIG || {};

export const isCloudMode = Boolean(
  config.supabaseUrl?.trim() && config.supabasePublishableKey?.trim()
);

const searchableFields = [
  "title",
  "authors",
  "isbn",
  "publisher",
  "publication_year",
  "language",
  "location",
  "reading_status",
  "loaned_to",
  "tags",
  "notes",
  "cover_url"
];

let supabasePromise;

async function localRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Qualcosa è andato storto");
  return data;
}

function loadSupabaseLibrary() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-supabase-client]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.supabase), { once: true });
      existing.addEventListener("error", () => reject(new Error("Impossibile caricare Supabase")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.dataset.supabaseClient = "true";
    script.onload = () => resolve(window.supabase);
    script.onerror = () => reject(new Error("Impossibile caricare Supabase"));
    document.head.append(script);
  });
}

async function getSupabase() {
  if (!isCloudMode) throw new Error("Supabase non è ancora configurato");
  if (!supabasePromise) {
    supabasePromise = loadSupabaseLibrary().then(({ createClient }) => createClient(
      config.supabaseUrl.trim(),
      config.supabasePublishableKey.trim()
    ));
  }
  return supabasePromise;
}

export function filterBooks(books, query, field) {
  const needle = String(query || "").trim().toLocaleLowerCase("it");
  if (!needle) return books;
  const fields = field === "all" || !searchableFields.includes(field)
    ? searchableFields
    : [field];
  return books.filter((book) => fields.some((name) =>
    String(book[name] ?? "").toLocaleLowerCase("it").includes(needle)
  ));
}

export async function getSession() {
  if (!isCloudMode) return { user: { id: "local", email: "" } };
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signUp(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!isCloudMode) return;
  const supabase = await getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function listBooks(query = "", field = "all") {
  if (!isCloudMode) {
    return localRequest(`/api/books?q=${encodeURIComponent(query)}&field=${encodeURIComponent(field)}`);
  }
  const supabase = await getSupabase();
  const pageSize = 500;
  const books = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("books")
      .select("*")
      .order("title", { ascending: true })
      .order("authors", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    books.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return filterBooks(books, query, field);
}

export async function saveBook(payload, id = "") {
  if (!isCloudMode) {
    return localRequest(id ? `/api/books/${id}` : "/api/books", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
  }
  const supabase = await getSupabase();
  const query = id
    ? supabase.from("books").update(payload).eq("id", id)
    : supabase.from("books").insert(payload);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function removeBook(id) {
  if (!isCloudMode) {
    return localRequest(`/api/books/${id}`, { method: "DELETE" });
  }
  const supabase = await getSupabase();
  const { error } = await supabase.from("books").delete().eq("id", id);
  if (error) throw error;
}

export async function lookupBookByIsbn(isbn) {
  if (!isCloudMode) {
    return localRequest(`/api/isbn/${encodeURIComponent(isbn)}`);
  }
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("isbn-lookup", {
    body: { isbn }
  });
  if (error) throw error;
  if (!data?.title) throw new Error(data?.error || "Nessun libro trovato con questo ISBN");
  return data;
}
