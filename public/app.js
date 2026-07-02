import {
  getSession,
  isCloudMode,
  listBooks,
  lookupBookByIsbn,
  removeBook,
  saveBook,
  signIn,
  signOut,
  signUp
} from "./data-service.js";

const grid = document.querySelector("#bookGrid");
const emptyState = document.querySelector("#emptyState");
const count = document.querySelector("#bookCount");
const searchInput = document.querySelector("#searchInput");
const searchField = document.querySelector("#searchField");
const dialog = document.querySelector("#bookDialog");
const form = document.querySelector("#bookForm");
const formError = document.querySelector("#formError");
const bookId = document.querySelector("#bookId");
const dialogTitle = document.querySelector("#dialogTitle");
const deleteButton = document.querySelector("#deleteBookButton");
const editBookButton = document.querySelector("#editBookButton");
const cardTemplate = document.querySelector("#bookCardTemplate");
const isbnInput = document.querySelector("#isbnInput");
const lookupIsbnButton = document.querySelector("#lookupIsbnButton");
const isbnStatus = document.querySelector("#isbnStatus");
const bulkDialog = document.querySelector("#bulkDialog");
const bulkIsbnInput = document.querySelector("#bulkIsbnInput");
const bulkProgress = document.querySelector("#bulkProgress");
const bulkResults = document.querySelector("#bulkResults");
const startBulkButton = document.querySelector("#startBulkButton");
const closeBulkButton = document.querySelector("#closeBulkButton");
const cancelBulkButton = document.querySelector("#cancelBulkButton");
const shelfDialog = document.querySelector("#shelfDialog");
const shelfMapContainer = document.querySelector("#shelfMapContainer");
const shelfSelectionText = document.querySelector("#shelfSelectionText");
const applyShelfButton = document.querySelector("#applyShelfButton");
const shelfPickerBody = document.querySelector("#shelfPickerBody");
const shelfPendingMessage = document.querySelector("#shelfPendingMessage");
const shelfLegend = document.querySelector("#shelfLegend");
const libraryButtons = [...document.querySelectorAll("[data-library]")];
const authDialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const authError = document.querySelector("#authError");
const authMessage = document.querySelector("#authMessage");
const signUpButton = document.querySelector("#signUpButton");
const signOutButton = document.querySelector("#signOutButton");
const importLocalButton = document.querySelector("#importLocalButton");

let books = [];
let searchTimer;
let bulkRunning = false;
let dialogMode = "create";
let currentLibrarySelection = "";
let currentShelfSelection = "";

function makeShelfPositions(group, count, x, width, y = 40, step = 92, height = 72) {
  return Array.from({ length: count }, (_, index) => ({
    name: `${group} ${index + 1}`,
    x,
    y: y + index * step,
    width,
    height
  }));
}

const shelfProfiles = {
  Camera: {
    frames: [{ x: 40, y: 20, width: 520, height: 860, rx: 10 }],
    openings: [{ x: 170, y: 316, width: 260, height: 564 }],
    groups: [
      { label: "Sinistra", count: 9 },
      { label: "Centro", count: 3 },
      { label: "Destra", count: 9 }
    ],
    positions: [
      ...makeShelfPositions("Sinistra", 9, 60, 80),
      ...makeShelfPositions("Centro", 3, 170, 260),
      ...makeShelfPositions("Destra", 9, 460, 80)
    ]
  },
  Sgabuzzino: {
    frames: [
      { x: 40, y: 20, width: 520, height: 245, rx: 10 },
      { x: 390, y: 20, width: 170, height: 860, rx: 10 }
    ],
    openings: [],
    groups: [
      { label: "Sinistra", count: 2 },
      { label: "Destra", count: 9 }
    ],
    positions: [
      ...makeShelfPositions("Sinistra", 2, 60, 310, 40, 105, 80),
      ...makeShelfPositions("Destra", 9, 410, 130)
    ]
  },
  Ingresso: {
    frames: [
      { x: 40, y: 20, width: 340, height: 860, rx: 10 },
      { x: 360, y: 20, width: 200, height: 296, rx: 10 }
    ],
    openings: [],
    groups: [
      { label: "Sinistra", count: 9 },
      { label: "Centro", count: 9 },
      { label: "Destra", count: 3 }
    ],
    positions: [
      ...makeShelfPositions("Sinistra", 9, 60, 135),
      ...makeShelfPositions("Centro", 9, 215, 135),
      ...makeShelfPositions("Destra", 3, 385, 155)
    ]
  }
};

const libraryNames = Object.keys(shelfProfiles);

async function loadBooks(query = "", field = searchField.value) {
  books = await listBooks(query, field);
  renderBooks();
}

function renderBooks() {
  grid.replaceChildren();
  count.textContent = `${books.length} ${books.length === 1 ? "libro" : "libri"}`;
  emptyState.hidden = books.length > 0 || Boolean(searchInput.value);
  const localAddress = location.hostname === "localhost"
    || location.hostname === "127.0.0.1"
    || location.hostname.startsWith("192.168.");
  importLocalButton.hidden = !(
    isCloudMode
    && localAddress
    && books.length === 0
    && !searchInput.value
  );

  if (!books.length && searchInput.value) {
    const message = document.createElement("p");
    message.className = "no-results";
    message.textContent = "Nessun libro corrisponde alla ricerca.";
    grid.append(message);
    return;
  }

  for (const book of books) {
    const card = cardTemplate.content.cloneNode(true);
    const button = card.querySelector(".card-button");
    const image = card.querySelector("img");
    const placeholder = card.querySelector(".cover-placeholder");
    card.querySelector(".book-title").textContent = book.title;
    card.querySelector(".book-author").textContent = book.authors || "Autore non indicato";
    const location = card.querySelector(".book-location");
    if (book.location) {
      const parsedLocation = parseLibraryLocation(book.location);
      const knownShelf = Boolean(parsedLocation.library && parsedLocation.shelf);
      const displayLocation = parsedLocation.library
        ? `${parsedLocation.library} · ${parsedLocation.shelf}`
        : book.location;
      location.append(
        knownShelf
          ? createShelfMap(parsedLocation.library, parsedLocation.shelf)
          : document.createTextNode("⌂"),
        document.createTextNode(displayLocation)
      );
    } else {
      location.hidden = true;
    }

    const badges = card.querySelector(".book-badges");
    badges.append(createBadge(book.reading_status, "status"));
    if (book.loaned_to) badges.append(createBadge(`Prestato a ${book.loaned_to}`, "loan"));

    if (book.cover_url) {
      image.src = book.cover_url;
      image.alt = `Copertina di ${book.title}`;
      image.hidden = false;
      placeholder.hidden = true;
      image.addEventListener("error", () => {
        image.hidden = true;
        placeholder.hidden = false;
      });
    }
    button.addEventListener("click", () => openDialog(book));
    grid.append(card);
  }
}

function createBadge(text, kind) {
  const badge = document.createElement("span");
  badge.className = `badge ${kind}`;
  if (kind === "status" && text === "Da sistemare") {
    badge.classList.add("needs-placement");
  }
  badge.textContent = text;
  return badge;
}

function createShelfMap(library = "Camera", selectedLocation = "", interactive = false) {
  const profile = shelfProfiles[library] || shelfProfiles.Camera;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 600 900");
  svg.setAttribute("class", interactive ? "shelf-map shelf-picker-map" : "shelf-map shelf-map-mini");
  svg.setAttribute("aria-label", interactive ? `Mappa degli scaffali: ${library}` : "");
  svg.setAttribute("aria-hidden", interactive ? "false" : "true");

  for (const frameData of profile.frames) {
    const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [key, value] of Object.entries(frameData)) frame.setAttribute(key, value);
    frame.setAttribute("class", "shelf-frame");
    svg.append(frame);
  }

  for (const openingData of profile.openings) {
    const opening = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    for (const [key, value] of Object.entries(openingData)) opening.setAttribute(key, value);
    opening.setAttribute("class", "shelf-doorway");
    svg.append(opening);
  }

  for (const position of profile.positions) {
    const slot = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    slot.setAttribute("x", position.x);
    slot.setAttribute("y", position.y);
    slot.setAttribute("width", position.width);
    slot.setAttribute("height", position.height);
    slot.setAttribute("rx", "4");
    slot.dataset.location = position.name;
    slot.setAttribute("class", `shelf-slot${position.name === selectedLocation ? " selected" : ""}`);

    if (interactive) {
      slot.setAttribute("role", "button");
      slot.setAttribute("tabindex", "0");
      slot.setAttribute("aria-label", `Seleziona ${position.name}`);
      slot.addEventListener("click", () => selectShelfPosition(position.name));
      slot.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectShelfPosition(position.name);
        }
      });
    }
    svg.append(slot);
  }
  return svg;
}

function parseLibraryLocation(value) {
  const normalized = String(value ?? "").trim();
  const separatorIndex = normalized.indexOf("·");
  if (separatorIndex > 0) {
    const library = normalized.slice(0, separatorIndex).trim();
    const shelf = normalized.slice(separatorIndex + 1).trim();
    if (
      libraryNames.includes(library)
      && shelfProfiles[library].positions.some((position) => position.name === shelf)
    ) {
      return { library, shelf };
    }
  }

  if (shelfProfiles.Camera.positions.some((position) => position.name === normalized)) {
    return { library: "Camera", shelf: normalized };
  }
  return { library: "", shelf: "" };
}

function updatePlacementStatus() {
  const location = parseLibraryLocation(form.elements.location.value);
  form.elements.reading_status.value = location.library ? "Sistemato" : "Da sistemare";
}

function selectShelfPosition(location) {
  currentShelfSelection = location;
  shelfMapContainer.querySelectorAll(".shelf-slot").forEach((slot) => {
    slot.classList.toggle("selected", slot.dataset.location === location);
  });
  shelfSelectionText.textContent =
    `Posizione selezionata: ${currentLibrarySelection} · ${location}`;
  applyShelfButton.disabled = false;
}

function showSelectedLibrary(library, shelf = "") {
  currentLibrarySelection = library;
  currentShelfSelection = shelf;
  libraryButtons.forEach((button) => {
    const selected = button.dataset.library === library;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  const profile = shelfProfiles[library];
  if (!profile) {
    shelfPickerBody.hidden = true;
    shelfPendingMessage.hidden = false;
    shelfPendingMessage.textContent = `La mappa della libreria ${library} non è disponibile.`;
    applyShelfButton.disabled = true;
    return;
  }

  shelfPendingMessage.hidden = true;
  shelfPickerBody.hidden = false;
  shelfMapContainer.replaceChildren(createShelfMap(library, shelf, true));
  shelfLegend.replaceChildren();
  for (const group of profile.groups) {
    const item = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = `${group.label}: `;
    item.append(label, document.createTextNode(`1–${group.count}`));
    shelfLegend.append(item);
  }
  shelfSelectionText.textContent = shelf
    ? `Posizione selezionata: ${library} · ${shelf}`
    : `Ora scegli uno scaffale della libreria ${library}`;
  applyShelfButton.disabled = !shelf;
}

function openShelfPicker() {
  const parsed = parseLibraryLocation(form.elements.location.value);
  currentLibrarySelection = "";
  currentShelfSelection = "";
  libraryButtons.forEach((button) => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
  shelfPickerBody.hidden = true;
  shelfPendingMessage.hidden = false;
  shelfPendingMessage.textContent = "Scegli prima una libreria.";
  applyShelfButton.disabled = true;
  if (parsed.library) showSelectedLibrary(parsed.library, parsed.shelf);
  shelfDialog.showModal();
}

function closeShelfPicker() {
  shelfDialog.close();
}

function showAuthDialog() {
  authError.textContent = "";
  authMessage.textContent = "";
  if (!authDialog.open) authDialog.showModal();
  authEmail.focus();
}

function closeAuthDialog() {
  if (authDialog.open) authDialog.close();
}

function setAuthBusy(busy) {
  authForm.querySelectorAll("button, input").forEach((control) => {
    control.disabled = busy;
  });
}

async function initializeApp() {
  const session = await getSession();
  signOutButton.hidden = !isCloudMode;
  if (isCloudMode && !session) {
    showAuthDialog();
    return;
  }
  closeAuthDialog();
  await loadBooks();
}

function setDialogMode(mode) {
  dialogMode = mode;
  const viewing = mode === "view";
  const editing = mode === "edit";
  form.classList.toggle("view-mode", viewing);
  dialogTitle.textContent = viewing
    ? "Dettagli libro"
    : editing
      ? "Modifica libro"
      : "Aggiungi libro";
  editBookButton.hidden = !viewing;
  deleteButton.hidden = !editing;

  form.querySelectorAll("input:not([type='hidden']), textarea").forEach((field) => {
    field.readOnly = viewing;
  });
  form.elements.reading_status.readOnly = true;
  form.querySelectorAll("select").forEach((field) => {
    field.disabled = viewing;
  });
}

function openDialog(book = null) {
  form.reset();
  formError.textContent = "";
  isbnStatus.textContent = "";
  isbnStatus.className = "isbn-status";
  bookId.value = book?.id || "";

  if (book) {
    for (const element of form.elements) {
      if (element.name && Object.hasOwn(book, element.name)) {
        element.value = book[element.name] ?? "";
      }
    }
  } else {
    form.elements.language.value = "Italiano";
  }
  updatePlacementStatus();
  setDialogMode(book ? "view" : "create");
  dialog.showModal();
  if (!book) isbnInput.focus();
}

function closeDialog() {
  dialog.close();
}

function cleanIsbn(value) {
  return String(value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

function openBulkDialog() {
  bulkIsbnInput.value = "";
  bulkProgress.textContent = "";
  bulkResults.replaceChildren();
  startBulkButton.disabled = false;
  startBulkButton.textContent = "Importa libri";
  bulkDialog.showModal();
  bulkIsbnInput.focus();
}

function closeBulkDialog() {
  if (!bulkRunning) bulkDialog.close();
}

function addBulkResult(isbn, state, message) {
  const item = document.createElement("li");
  item.className = `bulk-result ${state}`;
  const code = document.createElement("strong");
  code.textContent = isbn;
  const detail = document.createElement("span");
  detail.textContent = message;
  item.append(code, detail);
  if (state === "failed") {
    const manualButton = document.createElement("button");
    manualButton.className = "bulk-manual-button";
    manualButton.type = "button";
    manualButton.textContent = "Compila a mano";
    manualButton.disabled = bulkRunning;
    manualButton.addEventListener("click", () => {
      if (bulkRunning) return;
      bulkDialog.close();
      openDialog();
      isbnInput.value = isbn;
      isbnStatus.textContent = "Metadati non disponibili: completa la scheda manualmente.";
      isbnStatus.classList.add("is-error");
      form.elements.title.focus();
    });
    item.append(manualButton);
  }
  bulkResults.append(item);
}

async function importMultipleIsbns() {
  const isbns = [...new Set(
    bulkIsbnInput.value
      .split(/\r?\n/)
      .map(cleanIsbn)
      .filter(Boolean)
  )];

  bulkResults.replaceChildren();
  if (!isbns.length) {
    bulkProgress.textContent = "Inserisci almeno un ISBN.";
    bulkIsbnInput.focus();
    return;
  }

  bulkRunning = true;
  startBulkButton.disabled = true;
  closeBulkButton.disabled = true;
  cancelBulkButton.disabled = true;
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const allBooks = await listBooks();
    const existingIsbns = new Set(allBooks.map((book) => cleanIsbn(book.isbn)).filter(Boolean));

    for (let index = 0; index < isbns.length; index += 1) {
      const isbn = isbns[index];
      bulkProgress.textContent = `Elaborazione ${index + 1} di ${isbns.length}: ${isbn}`;

      if (existingIsbns.has(isbn)) {
        skipped += 1;
        addBulkResult(isbn, "skipped", "Già presente nel catalogo");
        continue;
      }

      try {
        const metadata = await lookupBookByIsbn(isbn);
        await saveBook(metadata);
        imported += 1;
        existingIsbns.add(isbn);
        addBulkResult(isbn, "success", metadata.title);
      } catch (error) {
        failed += 1;
        addBulkResult(isbn, "failed", error.message);
      }

      if (index < isbns.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1050));
      }
    }

    bulkProgress.textContent =
      `Completato: ${imported} importati, ${skipped} già presenti, ${failed} non riusciti.`;
    await loadBooks(searchInput.value);
  } catch (error) {
    bulkProgress.textContent = `Importazione interrotta: ${error.message}`;
  } finally {
    bulkRunning = false;
    startBulkButton.disabled = false;
    closeBulkButton.disabled = false;
    cancelBulkButton.disabled = false;
    bulkResults.querySelectorAll(".bulk-manual-button").forEach((button) => {
      button.disabled = false;
    });
    startBulkButton.textContent = "Importa altri";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (dialogMode === "view") return;
  formError.textContent = "";
  const payload = Object.fromEntries(new FormData(form));
  const id = bookId.value;
  try {
    await saveBook(payload, id);
    closeDialog();
    await loadBooks(searchInput.value);
  } catch (error) {
    formError.textContent = error.message;
  }
});

lookupIsbnButton.addEventListener("click", async () => {
  const isbn = isbnInput.value.trim();
  isbnStatus.className = "isbn-status";
  if (!isbn) {
    isbnStatus.textContent = "Inserisci prima un codice ISBN.";
    isbnStatus.classList.add("is-error");
    isbnInput.focus();
    return;
  }

  lookupIsbnButton.disabled = true;
  lookupIsbnButton.textContent = "Ricerca…";
  isbnStatus.textContent = "Sto cercando titolo, autore e copertina…";
  try {
    const metadata = await lookupBookByIsbn(isbn);
    for (const [name, value] of Object.entries(metadata)) {
      const field = form.elements[name];
      if (field && value !== null && value !== "") field.value = value;
    }
    isbnStatus.textContent = "Libro trovato. Controlla i dati e premi “Salva libro”.";
    isbnStatus.classList.add("is-success");
  } catch (error) {
    isbnStatus.textContent = error.message;
    isbnStatus.classList.add("is-error");
  } finally {
    lookupIsbnButton.disabled = false;
    lookupIsbnButton.textContent = "Cerca libro";
  }
});

isbnInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    lookupIsbnButton.click();
  }
});

deleteButton.addEventListener("click", async () => {
  const book = books.find((item) => String(item.id) === bookId.value);
  if (!book || !confirm(`Eliminare “${book.title}”?`)) return;
  try {
    await removeBook(book.id);
    closeDialog();
    await loadBooks(searchInput.value);
  } catch (error) {
    formError.textContent = error.message;
  }
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadBooks(searchInput.value), 220);
});

searchField.addEventListener("change", () => {
  clearTimeout(searchTimer);
  loadBooks(searchInput.value);
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  authMessage.textContent = "";
  setAuthBusy(true);
  try {
    await signIn(authEmail.value.trim(), authPassword.value);
    closeAuthDialog();
    authForm.reset();
    await loadBooks();
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    setAuthBusy(false);
  }
});

signUpButton.addEventListener("click", async () => {
  if (!authForm.reportValidity()) return;
  authError.textContent = "";
  authMessage.textContent = "";
  setAuthBusy(true);
  try {
    const result = await signUp(authEmail.value.trim(), authPassword.value);
    if (result.session) {
      closeAuthDialog();
      authForm.reset();
      await loadBooks();
    } else {
      authMessage.textContent = "Account creato. Controlla l’email per confermare l’accesso.";
    }
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    setAuthBusy(false);
  }
});

signOutButton.addEventListener("click", async () => {
  await signOut();
  books = [];
  renderBooks();
  showAuthDialog();
});

importLocalButton.addEventListener("click", async () => {
  importLocalButton.disabled = true;
  importLocalButton.textContent = "Importazione in corso…";
  try {
    const response = await fetch("/api/books?q=&field=all");
    const localBooks = await response.json();
    if (!response.ok) throw new Error(localBooks.error || "Archivio locale non disponibile");
    const fields = [
      "title", "authors", "isbn", "publisher", "publication_year", "language",
      "location", "reading_status", "loaned_to", "tags", "notes", "cover_url"
    ];
    for (const localBook of localBooks) {
      const payload = Object.fromEntries(fields.map((field) => [field, localBook[field] ?? ""]));
      await saveBook(payload);
    }
    await loadBooks();
  } catch (error) {
    grid.textContent = `Importazione non riuscita: ${error.message}`;
  } finally {
    importLocalButton.disabled = false;
    importLocalButton.textContent = "Importa l’archivio locale";
  }
});

document.querySelector("#addBookButton").addEventListener("click", () => openDialog());
document.querySelector("#emptyAddButton").addEventListener("click", () => openDialog());
document.querySelector("#bulkImportButton").addEventListener("click", openBulkDialog);
document.querySelector("#openShelfPickerButton").addEventListener("click", openShelfPicker);
editBookButton.addEventListener("click", () => {
  setDialogMode("edit");
  form.elements.title.focus();
});
document.querySelector("#closeDialogButton").addEventListener("click", closeDialog);
document.querySelector("#cancelButton").addEventListener("click", closeDialog);
closeBulkButton.addEventListener("click", closeBulkDialog);
cancelBulkButton.addEventListener("click", closeBulkDialog);
startBulkButton.addEventListener("click", importMultipleIsbns);
document.querySelector("#closeShelfButton").addEventListener("click", closeShelfPicker);
document.querySelector("#cancelShelfButton").addEventListener("click", closeShelfPicker);
libraryButtons.forEach((button) => {
  button.addEventListener("click", () => showSelectedLibrary(button.dataset.library));
});
applyShelfButton.addEventListener("click", () => {
  if (!currentLibrarySelection || !currentShelfSelection) return;
  form.elements.location.value = `${currentLibrarySelection} · ${currentShelfSelection}`;
  updatePlacementStatus();
  closeShelfPicker();
});
form.elements.location.addEventListener("input", updatePlacementStatus);
bulkDialog.addEventListener("cancel", (event) => {
  if (bulkRunning) event.preventDefault();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});
bulkDialog.addEventListener("click", (event) => {
  if (event.target === bulkDialog) closeBulkDialog();
});
shelfDialog.addEventListener("click", (event) => {
  if (event.target === shelfDialog) closeShelfPicker();
});
authDialog.addEventListener("cancel", (event) => event.preventDefault());

initializeApp().catch((error) => {
  grid.textContent = `Impossibile caricare il catalogo: ${error.message}`;
  if (isCloudMode) {
    showAuthDialog();
    authError.textContent = error.message;
  }
});
