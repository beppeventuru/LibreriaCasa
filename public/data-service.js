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
const searchIndex = new WeakMap();

function normalizeSearchValue(value) {
  return String(value ?? "").toLocaleLowerCase("it");
}

function searchableBook(book) {
  let indexed = searchIndex.get(book);
  if (!indexed) {
    indexed = Object.fromEntries(
      searchableFields.map((name) => [name, normalizeSearchValue(book[name])])
    );
    indexed.all = searchableFields.map((name) => indexed[name]).join("\n");
    searchIndex.set(book, indexed);
  }
  return indexed;
}

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
  const needle = normalizeSearchValue(query).trim();
  if (!needle) return books;
  const selectedField = searchableFields.includes(field) ? field : "all";
  return books.filter((book) => searchableBook(book)[selectedField].includes(needle));
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

export async function requestPasswordReset(email) {
  const supabase = await getSupabase();
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(password) {
  const supabase = await getSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function listBookLoans(bookId) {
  if (!isCloudMode) return [];
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("book_loans")
    .select("id, borrower, loaned_at, returned_at")
    .eq("book_id", bookId)
    .order("loaned_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listAllBookLoans() {
  if (!isCloudMode) return [];
  const supabase = await getSupabase();
  const pageSize = 500;
  const loans = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("book_loans")
      .select("id, book_id, borrower, loaned_at, returned_at")
      .order("loaned_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    loans.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return loans;
}

export async function importBookLoans(records) {
  if (!isCloudMode || !records.length) return { imported: 0, alreadyPresent: 0, failed: 0 };
  const supabase = await getSupabase();
  const existing = await listAllBookLoans();
  const fingerprint = (loan) => [
    String(loan.book_id ?? ""),
    String(loan.borrower ?? "").trim().toLocaleLowerCase("it"),
    String(loan.loaned_at ?? ""),
    String(loan.returned_at ?? "")
  ].join("|");
  const known = new Set(existing.map(fingerprint));
  let imported = 0;
  let alreadyPresent = 0;
  let failed = 0;

  for (const record of records) {
    const normalized = {
      book_id: record.book_id,
      borrower: String(record.borrower ?? "").trim(),
      loaned_at: record.loaned_at,
      returned_at: record.returned_at || null
    };
    const key = fingerprint(normalized);
    if (known.has(key)) {
      alreadyPresent += 1;
      continue;
    }
    const { error } = await supabase.from("book_loans").insert(normalized);
    if (error) {
      failed += 1;
      continue;
    }
    known.add(key);
    imported += 1;
  }

  return { imported, alreadyPresent, failed };
}

export async function lendBook(bookId, borrower, loanedAt) {
  if (!isCloudMode) throw new Error("La gestione prestiti richiede l’archivio online.");
  const supabase = await getSupabase();
  const { error } = await supabase.rpc("lend_book", {
    p_book_id: bookId,
    p_borrower: borrower,
    p_loaned_at: loanedAt
  });
  if (error) throw error;
}

export async function returnBook(bookId) {
  if (!isCloudMode) throw new Error("La gestione prestiti richiede l’archivio online.");
  const supabase = await getSupabase();
  const { data: activeLoans, error: historyError } = await supabase
    .from("book_loans")
    .select("id, loaned_at")
    .eq("book_id", bookId)
    .is("returned_at", null);
  if (historyError) throw historyError;

  for (const loan of activeLoans || []) {
    const { error: returnError } = await supabase
      .from("book_loans")
      .update({ returned_at: loan.loaned_at })
      .eq("id", loan.id);
    if (returnError) throw returnError;
  }

  const { error: updateError } = await supabase
    .from("books")
    .update({ loaned_to: "" })
    .eq("id", bookId);
  if (updateError) throw updateError;
}

export async function listenForPasswordRecovery(callback) {
  if (!isCloudMode) return;
  const supabase = await getSupabase();
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") callback();
  });
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

export async function clearCatalog() {
  if (!isCloudMode) {
    const books = await listBooks();
    await Promise.all(books.map((book) => removeBook(book.id)));
    return books.length;
  }

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("books")
    .delete()
    .not("id", "is", null)
    .select("id");
  if (error) throw error;
  return data?.length || 0;
}

export async function lookupBookByIsbn(isbn) {
  if (!isCloudMode) {
    return localRequest(`/api/isbn/${encodeURIComponent(isbn)}`);
  }
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("isbn-lookup", {
    body: { isbn }
  });
  if (error) {
    const detail = await readableFunctionError(error);
    throw new Error(detail || error.message || "Errore durante la ricerca ISBN");
  }
  if (!data?.title) throw new Error(data?.error || "Nessun libro trovato con questo ISBN");
  return data;
}

async function readableFunctionError(error) {
  const response = error?.context;
  if (!response?.clone) return "";

  try {
    const payload = await response.clone().json();
    return payload?.error || payload?.message || "";
  } catch {
    try {
      return await response.clone().text();
    } catch {
      return "";
    }
  }
}
