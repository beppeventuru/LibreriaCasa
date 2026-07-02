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

    const endpoint = new URL("https://www.googleapis.com/books/v1/volumes");
    endpoint.searchParams.set("q", `isbn:${isbn}`);
    endpoint.searchParams.set("maxResults", "1");
    endpoint.searchParams.set("projection", "full");
    const googleBooksApiKey = Deno.env.get("GOOGLE_BOOKS_API_KEY");
    if (googleBooksApiKey) endpoint.searchParams.set("key", googleBooksApiKey);

    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        return Response.json(
          { error: `Google Books non disponibile (${response.status})` },
          { status: 502 }
        );
      }
      const result = await response.json();
      const info = result.items?.[0]?.volumeInfo;
      if (!info) {
        return Response.json(
          { error: "Nessun libro trovato con questo ISBN" },
          { status: 404 }
        );
      }

      const year = String(info.publishedDate || "").match(/\d{4}/)?.[0] || null;
      const cover = info.imageLinks?.large
        || info.imageLinks?.medium
        || info.imageLinks?.thumbnail
        || info.imageLinks?.smallThumbnail
        || "";

      return Response.json({
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
      });
    } catch {
      return Response.json(
        { error: "Non riesco a contattare Google Books" },
        { status: 502 }
      );
    }
  })
};
