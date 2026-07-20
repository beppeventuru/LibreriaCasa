import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const languageNames: Record<string, string> = {
  it: "Italiano",
  ita: "Italiano",
  en: "Inglese",
  eng: "Inglese",
  fr: "Francese",
  fre: "Francese",
  fra: "Francese",
  es: "Spagnolo",
  spa: "Spagnolo",
  de: "Tedesco",
  deu: "Tedesco",
  ger: "Tedesco"
};

type BookMetadata = {
  title: string;
  authors: string;
  isbn: string;
  publisher: string;
  publication_year: string | null;
  language: string;
  location: string;
  reading_status: string;
  loaned_to: string;
  tags: string;
  notes: string;
  cover_url: string;
};

export default {
  fetch: withSupabase({ auth: "user" }, async (request) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Metodo non consentito" }, { status: 405 });
    }

    const { isbn: rawIsbn } = await request.json();
    const isbn = String(rawIsbn || "").toUpperCase().replace(/[^0-9X]/g, "");
    if (![10, 13].includes(isbn.length)) {
      return Response.json(
        { error: "Inserisci un ISBN-10 o ISBN-13 valido" },
        { status: 400 }
      );
    }

    const attempts: string[] = [];

    try {
      const ibsBook = await lookupIbs(isbn);
      if (ibsBook) return Response.json(ibsBook);
      attempts.push("IBS: nessun risultato");
    } catch (error) {
      attempts.push(`IBS: ${messageFrom(error)}`);
    }

    let googleBook: BookMetadata | null = null;
    try {
      googleBook = await lookupGoogleBooks(isbn);
      if (googleBook?.cover_url) return Response.json(googleBook);
      if (googleBook) {
        attempts.push("Google Books: copertina non disponibile");
      } else {
        attempts.push("Google Books: nessun risultato");
      }
    } catch (error) {
      attempts.push(`Google Books: ${messageFrom(error)}`);
    }

    try {
      const openLibraryCoverUrl = await lookupOpenLibraryCover(isbn);
      if (openLibraryCoverUrl && googleBook) {
        return Response.json({ ...googleBook, cover_url: openLibraryCoverUrl });
      }
    } catch (error) {
      attempts.push(`Copertina Open Library: ${messageFrom(error)}`);
    }

    try {
      const openLibraryBook = await lookupOpenLibrary(isbn);
      if (openLibraryBook) {
        return Response.json({
          ...(googleBook || openLibraryBook),
          cover_url: openLibraryBook.cover_url
        });
      }
      attempts.push("Open Library: nessun risultato");
    } catch (error) {
      attempts.push(`Open Library: ${messageFrom(error)}`);
    }

    if (googleBook) return Response.json(googleBook);

    return Response.json({
      error: `Nessun libro trovato con questo ISBN. ${attempts.join(" - ")}`
    });
  })
};

async function lookupIbs(isbn: string): Promise<BookMetadata | null> {
  const response = await fetch(`https://www.ibs.it/search/?query=${encodeURIComponent(isbn)}`, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; LibreriaCasa/1.0)",
      "accept-language": "it-IT,it;q=0.9"
    }
  });

  if (!response.ok) {
    throw new Error(`servizio non disponibile (${response.status})`);
  }

  const html = await response.text();
  const escapedIsbn = isbn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const record = html.match(new RegExp(`\\{[^{}]*"item_id"\\s*:\\s*"${escapedIsbn}"[^{}]*\\}`))?.[0];
  if (!record) return null;

  const title = jsonValue(record, "item_name");
  if (!title) return null;

  const coverUrl = html.match(new RegExp(`https://www\\.ibs\\.it/images/${escapedIsbn}_[^"'<>\\s]+`))?.[0] || "";
  const publicationYear = jsonValue(record, "year_edition").match(/\\d{4}/)?.[0] || null;

  return {
    title,
    authors: jsonValue(record, "item_author"),
    isbn,
    publisher: jsonValue(record, "item_brand"),
    publication_year: publicationYear,
    language: "Italiano",
    location: "",
    reading_status: "Da sistemare",
    loaned_to: "",
    tags: "",
    notes: "",
    cover_url: coverUrl
  };
}

function jsonValue(text: string, key: string) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

async function lookupGoogleBooks(isbn: string): Promise<BookMetadata | null> {
  const endpoint = new URL("https://www.googleapis.com/books/v1/volumes");
  endpoint.searchParams.set("q", `isbn:${isbn}`);
  endpoint.searchParams.set("maxResults", "1");
  endpoint.searchParams.set("projection", "full");
  const googleBooksApiKey = Deno.env.get("GOOGLE_BOOKS_API_KEY");
  if (googleBooksApiKey) endpoint.searchParams.set("key", googleBooksApiKey);

  const response = await fetchWithRetry(endpoint, {
    attempts: 4,
    retryStatuses: [429, 500, 502, 503, 504],
    delays: [700, 1600, 3200]
  });
  if (!response.ok) {
    throw new Error(`servizio non disponibile (${response.status})`);
  }

  const result = await response.json();
  const info = result.items?.[0]?.volumeInfo;
  if (!info) return null;

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
    location: "",
    reading_status: "Da sistemare",
    loaned_to: "",
    tags: info.categories?.slice(0, 8).join(", ") || "",
    notes: info.description || "",
    cover_url: cover.replace(/^http:/, "https:")
  };
}

async function lookupOpenLibrary(isbn: string): Promise<BookMetadata | null> {
  const response = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`servizio non disponibile (${response.status})`);
  }

  const info = await response.json();
  const authors = await openLibraryAuthorNames(info.authors);
  const language = openLibraryLanguage(info.languages?.[0]?.key);
  const year = String(info.publish_date || "").match(/\d{4}/)?.[0] || null;

  return {
    title: info.subtitle ? `${info.title}: ${info.subtitle}` : info.title || "",
    authors,
    isbn,
    publisher: info.publishers?.[0] || "",
    publication_year: year,
    language,
    location: "",
    reading_status: "Da sistemare",
    loaned_to: "",
    tags: info.subjects?.slice(0, 8).join(", ") || "",
    notes: typeof info.description === "string" ? info.description : info.description?.value || "",
    cover_url: await lookupOpenLibraryCover(isbn)
  };
}

async function lookupOpenLibraryCover(isbn: string) {
  const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
  const response = await fetch(url, { method: "HEAD" });
  return response.ok ? url : "";
}

async function openLibraryAuthorNames(authors: Array<{ key?: string }> | undefined) {
  if (!authors?.length) return "";

  const names = await Promise.all(
    authors.slice(0, 4).map(async (author) => {
      if (!author.key) return "";
      try {
        const response = await fetch(`https://openlibrary.org${author.key}.json`);
        if (!response.ok) return "";
        const details = await response.json();
        return details.name || details.personal_name || "";
      } catch {
        return "";
      }
    })
  );

  return names.filter(Boolean).join(", ");
}

function openLibraryLanguage(key = "") {
  const code = key.split("/").pop() || "";
  return languageNames[code] || code || "";
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "errore sconosciuto";
}

async function fetchWithRetry(
  url: URL | string,
  options: { attempts: number; retryStatuses: number[]; delays: number[] }
) {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      lastResponse = response;
      if (!options.retryStatuses.includes(response.status)) return response;
    } catch (error) {
      if (attempt === options.attempts - 1) throw error;
    }

    if (attempt < options.attempts - 1) {
      await wait(options.delays[attempt] || 1000);
    }
  }

  return lastResponse ?? fetch(url);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
