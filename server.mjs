import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { DatabaseSync } from "node:sqlite";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");

const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!match || match[1].startsWith("#") || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const PORT = Number(process.env.PORT || 4173);
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY?.trim() || "";

mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, "libreria.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '',
    isbn TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    publication_year INTEGER,
    language TEXT NOT NULL DEFAULT 'Italiano',
    location TEXT NOT NULL DEFAULT '',
    reading_status TEXT NOT NULL DEFAULT 'Da sistemare',
    loaned_to TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
  CREATE INDEX IF NOT EXISTS idx_books_authors ON books(authors);
  CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);

  CREATE TABLE IF NOT EXISTS isbn_cache (
    isbn TEXT PRIMARY KEY,
    metadata TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const fields = [
  "title", "authors", "isbn", "publisher", "publication_year", "language",
  "location", "reading_status", "loaned_to", "tags", "notes", "cover_url"
];

const searchableFields = {
  title: "title",
  authors: "authors",
  isbn: "isbn",
  publisher: "publisher",
  publication_year: "CAST(publication_year AS TEXT)",
  language: "language",
  location: "location",
  reading_status: "reading_status",
  loaned_to: "loaned_to",
  tags: "tags",
  notes: "notes",
  cover_url: "cover_url"
};
const searchableColumns = Object.values(searchableFields);
const listBooks = db.prepare(`
  SELECT * FROM books
  WHERE ${searchableColumns.map((column) => `${column} LIKE ?`).join(" OR ")}
  ORDER BY title COLLATE NOCASE, authors COLLATE NOCASE
`);
const listBooksByField = Object.fromEntries(
  Object.entries(searchableFields).map(([field, column]) => [
    field,
    db.prepare(`
      SELECT * FROM books
      WHERE ${column} LIKE ?
      ORDER BY title COLLATE NOCASE, authors COLLATE NOCASE
    `)
  ])
);
const getBook = db.prepare("SELECT * FROM books WHERE id = ?");
const insertBook = db.prepare(`
  INSERT INTO books (${fields.join(", ")})
  VALUES (${fields.map(() => "?").join(", ")})
`);
const updateBook = db.prepare(`
  UPDATE books SET ${fields.map((field) => `${field} = ?`).join(", ")},
  updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);
const deleteBook = db.prepare("DELETE FROM books WHERE id = ?");
const getCachedIsbn = db.prepare("SELECT metadata FROM isbn_cache WHERE isbn = ?");
const saveCachedIsbn = db.prepare(`
  INSERT INTO isbn_cache (isbn, metadata, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(isbn) DO UPDATE SET
    metadata = excluded.metadata,
    updated_at = CURRENT_TIMESTAMP
`);

function normalizeBook(input = {}) {
  const book = {};
  for (const field of fields) {
    if (field === "publication_year") {
      const year = Number(input[field]);
      book[field] = Number.isInteger(year) && year > 0 ? year : null;
    } else if (field === "isbn") {
      book[field] = cleanIsbn(input[field]);
    } else {
      book[field] = String(input[field] ?? "").trim();
    }
  }
  book.language ||= "Italiano";
  book.reading_status = isKnownLocation(book.location) ? "Sistemato" : "Da sistemare";
  return book;
}

const shelfLimits = {
  Camera: { Sinistra: 9, Centro: 3, Destra: 9 },
  Sgabuzzino: { Sinistra: 2, Destra: 9 },
  Ingresso: { Sinistra: 9, Centro: 9, Destra: 3 }
};

function isKnownLocation(value) {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(
    /^(Camera|Sgabuzzino|Ingresso)\s*·\s*(Sinistra|Centro|Destra)\s+(\d+)$/
  );
  const legacyCameraMatch = normalized.match(/^(Sinistra|Centro|Destra)\s+(\d+)$/);
  const [, library, group, shelfNumber] = match
    || (legacyCameraMatch && [legacyCameraMatch[0], "Camera", legacyCameraMatch[1], legacyCameraMatch[2]])
    || [];
  if (!library) return false;
  const limit = shelfLimits[library]?.[group] || 0;
  return Number(shelfNumber) >= 1 && Number(shelfNumber) <= limit;
}

const updatePlacementStatus = db.prepare(
  "UPDATE books SET reading_status = ? WHERE id = ?"
);
for (const book of db.prepare("SELECT id, location, reading_status FROM books").all()) {
  const status = isKnownLocation(book.location) ? "Sistemato" : "Da sistemare";
  if (book.reading_status !== status) updatePlacementStatus.run(status, book.id);
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function cleanIsbn(value) {
  return String(value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

function isValidIsbn(isbn) {
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce(
      (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0
    );
    return sum % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce(
      (total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index),
      0
    );
    return sum % 11 === 0;
  }
  return false;
}

const languageNames = {
  ita: "Italiano",
  it: "Italiano",
  eng: "Inglese",
  en: "Inglese",
  fre: "Francese",
  fra: "Francese",
  fr: "Francese",
  spa: "Spagnolo",
  es: "Spagnolo",
  ger: "Tedesco",
  deu: "Tedesco",
  de: "Tedesco",
  por: "Portoghese",
  pt: "Portoghese",
  cat: "Catalano",
  ca: "Catalano"
};

async function lookupIsbn(isbn) {
  const cached = getCachedIsbn.get(isbn);
  if (cached) return JSON.parse(cached.metadata);

  const fields = [
    "key", "title", "author_name", "publisher", "first_publish_year",
    "language", "subject", "cover_i"
  ].join(",");
  const endpoint = new URL("https://openlibrary.org/search.json");
  endpoint.searchParams.set("isbn", isbn);
  endpoint.searchParams.set("fields", fields);
  endpoint.searchParams.set("limit", "1");

  let result;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const apiResponse = await fetch(endpoint, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "LibreriaCasa/0.1 (personal home library)"
        },
        signal: AbortSignal.timeout(12_000)
      });
      if (!apiResponse.ok) throw new Error(`Open Library: ${apiResponse.status}`);
      result = await apiResponse.json();
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }
  const item = result?.docs?.[0];
  if (item) {
    const metadata = {
      title: item.title || "",
      authors: item.author_name?.join(", ") || "",
      isbn,
      publisher: item.publisher?.[0] || "",
      publication_year: item.first_publish_year || null,
      language: languageNames[item.language?.[0]] || item.language?.[0] || "",
      tags: item.subject?.slice(0, 8).join(", ") || "",
      cover_url: item.cover_i
        ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg`
        : "",
      source_url: item.key ? `https://openlibrary.org${item.key}` : "",
      metadata_source: "Open Library"
    };
    saveCachedIsbn.run(isbn, JSON.stringify(metadata));
    return metadata;
  }

  if (GOOGLE_BOOKS_API_KEY) {
    try {
      const metadata = await lookupGoogleBooks(isbn);
      if (metadata) {
        saveCachedIsbn.run(isbn, JSON.stringify(metadata));
        return metadata;
      }
    } catch (error) {
      console.warn(`Google Books non disponibile per ${isbn}: ${error.message}`);
    }
  }

  try {
    const metadata = await lookupSbn(isbn);
    if (metadata) {
      saveCachedIsbn.run(isbn, JSON.stringify(metadata));
      return metadata;
    }
    return null;
  } catch (sbnError) {
    if (result) return null;
    if (lastError?.name === "TimeoutError" || sbnError?.name === "TimeoutError") {
      throw new Error("La ricerca sta impiegando troppo tempo. Controlla Internet e riprova");
    }
    throw new Error("Non riesco a contattare i servizi dei metadati. Riprova tra qualche secondo");
  }
}

async function lookupGoogleBooks(isbn) {
  const endpoint = new URL("https://www.googleapis.com/books/v1/volumes");
  endpoint.searchParams.set("q", `isbn:${isbn}`);
  endpoint.searchParams.set("maxResults", "1");
  endpoint.searchParams.set("projection", "full");
  endpoint.searchParams.set("key", GOOGLE_BOOKS_API_KEY);

  const response = await fetch(endpoint, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "LibreriaCasa/0.1 (personal home library)"
    },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Google Books: ${response.status}`);

  const result = await response.json();
  const item = result.items?.[0];
  if (!item?.volumeInfo) return null;

  const info = item.volumeInfo;
  const year = String(info.publishedDate || "").match(/\d{4}/)?.[0] || null;
  const cover = info.imageLinks?.large
    || info.imageLinks?.medium
    || info.imageLinks?.thumbnail
    || info.imageLinks?.smallThumbnail
    || "";

  return {
    title: info.subtitle ? `${info.title}: ${info.subtitle}` : info.title || "",
    authors: info.authors?.join(", ") || "",
    isbn,
    publisher: info.publisher || "",
    publication_year: year,
    language: languageNames[info.language] || info.language || "",
    tags: info.categories?.slice(0, 8).join(", ") || "",
    notes: info.description || "",
    cover_url: cover.replace(/^http:/, "https:"),
    source_url: info.infoLink || "",
    metadata_source: "Google Books"
  };
}

function cleanSbnText(value) {
  return String(value ?? "")
    .replace(/[\u0080-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatSbnAuthor(value) {
  const withoutDates = cleanSbnText(value).replace(/\s*<[^>]*>\s*$/, "");
  const [surname, ...givenParts] = withoutDates.split(",");
  return givenParts.length
    ? `${givenParts.join(",").trim()} ${surname.trim()}`.trim()
    : withoutDates;
}

async function lookupSbn(isbn) {
  const endpoint = new URL("http://opac.sbn.it/opacmobilegw/search.json");
  endpoint.searchParams.set("isbn", isbn);

  const response = await fetch(endpoint, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "LibreriaCasa/0.1 (personal home library)"
    },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`SBN: ${response.status}`);

  const result = await response.json();
  const item = result.briefRecords?.[0];
  if (!item) return null;

  const publication = cleanSbnText(item.pubblicazione);
  const publisher = publication.match(/:\s*([^,]+?)(?:,\s*\d{4}|$)/)?.[1]?.trim() || "";
  const year = publication.match(/(?:,|\s)(\d{4})(?:\D|$)/)?.[1] || null;
  const languageFacet = result.facetRecords?.find((facet) => facet.facetName === "lingua");
  const language = languageFacet?.facetValues?.[0]?.[0] || "Italiano";
  const title = cleanSbnText(item.titolo).split(/\s+\/\s+/)[0];

  return {
    title,
    authors: formatSbnAuthor(item.autorePrincipale),
    isbn,
    publisher,
    publication_year: year,
    language: language.charAt(0).toUpperCase() + language.slice(1).toLowerCase(),
    tags: "",
    cover_url: item.copertina?.replace(/^http:/, "https:") || "",
    source_url: "https://opac.sbn.it/",
    metadata_source: "Catalogo SBN"
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Richiesta troppo grande");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleApi(request, response, url) {
  const isbnMatch = url.pathname.match(/^\/api\/isbn\/([^/]+)$/);
  if (isbnMatch && request.method === "GET") {
    const isbn = cleanIsbn(decodeURIComponent(isbnMatch[1]));
    if (!isValidIsbn(isbn)) {
      return sendJson(response, 400, { error: "Inserisci un ISBN-10 o ISBN-13 valido" });
    }
    const book = await lookupIsbn(isbn);
    return book
      ? sendJson(response, 200, book)
      : sendJson(response, 404, { error: "Nessun libro trovato con questo ISBN" });
  }

  if (url.pathname === "/api/books" && request.method === "GET") {
    const query = `%${url.searchParams.get("q")?.trim() || ""}%`;
    const field = url.searchParams.get("field") || "all";
    const statement = listBooksByField[field];
    const books = statement
      ? statement.all(query)
      : listBooks.all(...searchableColumns.map(() => query));
    return sendJson(response, 200, books);
  }

  if (url.pathname === "/api/books" && request.method === "POST") {
    const book = normalizeBook(await readJson(request));
    if (!book.title) return sendJson(response, 400, { error: "Il titolo è obbligatorio" });
    const result = insertBook.run(...fields.map((field) => book[field]));
    return sendJson(response, 201, getBook.get(result.lastInsertRowid));
  }

  const match = url.pathname.match(/^\/api\/books\/(\d+)$/);
  if (!match) return sendJson(response, 404, { error: "Risorsa non trovata" });
  const id = Number(match[1]);

  if (request.method === "GET") {
    const book = getBook.get(id);
    return book
      ? sendJson(response, 200, book)
      : sendJson(response, 404, { error: "Libro non trovato" });
  }

  if (request.method === "PUT") {
    if (!getBook.get(id)) return sendJson(response, 404, { error: "Libro non trovato" });
    const book = normalizeBook(await readJson(request));
    if (!book.title) return sendJson(response, 400, { error: "Il titolo è obbligatorio" });
    updateBook.run(...fields.map((field) => book[field]), id);
    return sendJson(response, 200, getBook.get(id));
  }

  if (request.method === "DELETE") {
    const result = deleteBook.run(id);
    return result.changes
      ? sendJson(response, 200, { ok: true })
      : sendJson(response, 404, { error: "Libro non trovato" });
  }

  return sendJson(response, 405, { error: "Metodo non consentito" });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.[\\/])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    return sendJson(response, 404, { error: "Pagina non trovata" });
  }
  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-cache"
  });
  response.end(content);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      await serveStatic(response, decodeURIComponent(url.pathname));
    }
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: error.message || "Errore interno" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Libreria Casa avviata su http://localhost:${PORT}`);
  console.log(`Google Books: ${GOOGLE_BOOKS_API_KEY ? "configurato" : "chiave non configurata"}`);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        console.log(`Da telefono: http://${entry.address}:${PORT}`);
      }
    }
  }
});
