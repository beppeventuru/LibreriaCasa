import {
  filterBooks,
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
const quickFilterButtons = [...document.querySelectorAll("[data-quick-filter]")];
const dialog = document.querySelector("#bookDialog");
const form = document.querySelector("#bookForm");
const formSubmitButton = form.querySelector('button[type="submit"]');
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
const startScannerButton = document.querySelector("#startScannerButton");
const stopScannerButton = document.querySelector("#stopScannerButton");
const focusScannerButton = document.querySelector("#focusScannerButton");
const barcodeScanner = document.querySelector("#barcodeScanner");
const barcodeVideo = document.querySelector("#barcodeVideo");
const scannerStatus = document.querySelector("#scannerStatus");
const bulkEntryCount = document.querySelector("#bulkEntryCount");
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
const backupDialog = document.querySelector("#backupDialog");
const backupButton = document.querySelector("#backupButton");
const closeBackupButton = document.querySelector("#closeBackupButton");
const dismissBackupButton = document.querySelector("#dismissBackupButton");
const exportBackupButton = document.querySelector("#exportBackupButton");
const importBackupButton = document.querySelector("#importBackupButton");
const backupFileInput = document.querySelector("#backupFileInput");
const backupStatus = document.querySelector("#backupStatus");
const duplicateDialog = document.querySelector("#duplicateDialog");
const duplicateMessage = document.querySelector("#duplicateMessage");
const rejectDuplicateButton = document.querySelector("#rejectDuplicateButton");
const acceptDuplicateButton = document.querySelector("#acceptDuplicateButton");

const BOOK_DATA_FIELDS = [
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

let catalogBooks = [];
let books = [];
let searchTimer;
let activeQuickFilter = "all";
let bulkRunning = false;
let backupRunning = false;
let scannerControls = null;
let scannerTrack = null;
let scannerLibraryPromise = null;
let scannerSession = 0;
let lastScannedCode = "";
let lastScanTime = 0;
let dialogMode = "create";
let currentLibrarySelection = "";
let currentShelfSelection = "";
let duplicateDecisionResolver = null;

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

function matchesQuickFilter(book, filter = activeQuickFilter) {
  if (filter === "all") return true;
  if (filter === "unplaced") {
    return !parseLibraryLocation(book.location).library
      || String(book.reading_status ?? "") === "Da sistemare";
  }
  if (filter === "loaned") return Boolean(String(book.loaned_to ?? "").trim());
  if (libraryNames.includes(filter)) {
    return parseLibraryLocation(book.location).library === filter;
  }
  return true;
}

function renderQuickFilters() {
  quickFilterButtons.forEach((button) => {
    const filter = button.dataset.quickFilter;
    const total = catalogBooks.filter((book) => matchesQuickFilter(book, filter)).length;
    button.querySelector("[data-quick-count]").textContent = total;
    button.setAttribute("aria-pressed", String(filter === activeQuickFilter));
  });
}

function applyCatalogView(query = searchInput.value, field = searchField.value) {
  const searchedBooks = filterBooks(catalogBooks, query, field);
  books = searchedBooks.filter((book) => matchesQuickFilter(book));
  renderQuickFilters();
  renderBooks();
}

async function loadBooks(query = "", field = searchField.value) {
  catalogBooks = await listBooks();
  applyCatalogView(query, field);
}

function renderBooks() {
  grid.replaceChildren();
  const filtered = activeQuickFilter !== "all" || Boolean(searchInput.value.trim());
  count.textContent = filtered
    ? `${books.length} di ${catalogBooks.length} libri`
    : `${books.length} ${books.length === 1 ? "libro" : "libri"}`;
  emptyState.hidden = catalogBooks.length > 0;
  const localAddress = location.hostname === "localhost"
    || location.hostname === "127.0.0.1"
    || location.hostname.startsWith("192.168.");
  importLocalButton.hidden = !(
    isCloudMode
    && localAddress
    && catalogBooks.length === 0
    && !searchInput.value
  );

  if (!books.length && catalogBooks.length) {
    const message = document.createElement("p");
    message.className = "no-results";
    message.textContent = searchInput.value.trim()
      ? "Nessun libro corrisponde alla ricerca in questo filtro."
      : "Nessun libro presente in questo filtro.";
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

function isValidIsbn(value) {
  const isbn = cleanIsbn(value);

  if (isbn.length === 13 && /^(978|979)\d{10}$/.test(isbn)) {
    const sum = [...isbn.slice(0, 12)].reduce(
      (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0
    );
    return (10 - (sum % 10)) % 10 === Number(isbn[12]);
  }

  if (isbn.length === 10 && /^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce(
      (total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index),
      0
    );
    return sum % 11 === 0;
  }

  return false;
}

function bookPayloadFrom(source = {}) {
  const payload = Object.fromEntries(BOOK_DATA_FIELDS.map((field) => [
    field,
    field === "publication_year" ? source[field] ?? null : String(source[field] ?? "")
  ]));
  const year = Number(payload.publication_year);
  payload.publication_year = Number.isInteger(year) && year > 0 ? year : null;
  payload.title = payload.title.trim();
  return payload;
}

function bookFingerprint(source) {
  const payload = bookPayloadFrom(source);
  return JSON.stringify(BOOK_DATA_FIELDS.map((field) => (
    field === "publication_year"
      ? payload[field]
      : String(payload[field] ?? "").trim()
  )));
}

function settleDuplicateDecision(accepted) {
  const resolve = duplicateDecisionResolver;
  duplicateDecisionResolver = null;
  if (duplicateDialog.open) duplicateDialog.close();
  if (resolve) resolve(accepted);
}

function confirmAdditionalCopy({ title, isbn, existingCount }) {
  if (duplicateDecisionResolver) settleDuplicateDecision(false);
  const copies = existingCount === 1 ? "una copia" : `${existingCount} copie`;
  duplicateMessage.textContent =
    `Il catalogo contiene già ${copies} di “${title || "questo libro"}” con ISBN ${isbn}.`;
  acceptDuplicateButton.textContent = `Aggiungi la ${existingCount + 1}ª copia`;
  duplicateDialog.showModal();
  return new Promise((resolve) => {
    duplicateDecisionResolver = resolve;
  });
}

function setBackupStatus(message, error = false) {
  backupStatus.textContent = message;
  backupStatus.className = `backup-status${error ? " is-error" : ""}`;
}

function setBackupBusy(busy) {
  backupRunning = busy;
  exportBackupButton.disabled = busy;
  importBackupButton.disabled = busy;
  closeBackupButton.disabled = busy;
  dismissBackupButton.disabled = busy;
}

function openBackupDialog() {
  backupFileInput.value = "";
  setBackupStatus("");
  backupDialog.showModal();
}

function closeBackupDialog() {
  if (!backupRunning) backupDialog.close();
}

async function exportBackup() {
  setBackupBusy(true);
  setBackupStatus("Preparo il backup…");

  try {
    const catalog = await listBooks();
    const backup = {
      format: "libreria-casa-backup",
      version: 1,
      exported_at: new Date().toISOString(),
      books: catalog.map((book) => ({
        source_id: String(book.id ?? ""),
        ...bookPayloadFrom(book)
      }))
    };
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `libreria-casa-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupStatus(`Backup creato: ${catalog.length} ${catalog.length === 1 ? "libro" : "libri"}.`);
  } catch (error) {
    setBackupStatus(`Esportazione non riuscita: ${error.message}`, true);
  } finally {
    setBackupBusy(false);
  }
}

async function importBackupFile(file) {
  setBackupBusy(true);
  setBackupStatus("Controllo il file…");

  try {
    const backup = JSON.parse(await file.text());
    if (
      backup?.format !== "libreria-casa-backup"
      || backup?.version !== 1
      || !Array.isArray(backup.books)
    ) {
      throw new Error("Il file non è un backup valido di Libreria Casa.");
    }

    const currentBooks = await listBooks();
    const existingSourceIds = new Set(
      currentBooks.map((book) => String(book.id ?? "")).filter(Boolean)
    );
    const remainingFingerprints = new Map();
    currentBooks.forEach((book) => {
      const fingerprint = bookFingerprint(book);
      remainingFingerprints.set(fingerprint, (remainingFingerprints.get(fingerprint) || 0) + 1);
    });

    let imported = 0;
    let alreadyPresent = 0;
    let failed = 0;

    for (let index = 0; index < backup.books.length; index += 1) {
      const record = backup.books[index];
      const sourceId = String(record?.source_id ?? "");
      setBackupStatus(`Importazione ${index + 1} di ${backup.books.length}…`);

      if (sourceId && existingSourceIds.has(sourceId)) {
        alreadyPresent += 1;
        continue;
      }

      const payload = bookPayloadFrom(record);
      if (!payload.title) {
        failed += 1;
        continue;
      }

      const fingerprint = bookFingerprint(payload);
      const matchingCopies = remainingFingerprints.get(fingerprint) || 0;
      if (matchingCopies > 0) {
        remainingFingerprints.set(fingerprint, matchingCopies - 1);
        alreadyPresent += 1;
        continue;
      }

      try {
        await saveBook(payload);
        imported += 1;
      } catch {
        failed += 1;
      }
    }

    await loadBooks(searchInput.value);
    setBackupStatus(
      `Importazione completata: ${imported} aggiunti, ${alreadyPresent} già presenti`
      + `${failed ? `, ${failed} non riusciti` : ""}.`,
      failed > 0
    );
  } catch (error) {
    setBackupStatus(`Importazione non riuscita: ${error.message}`, true);
  } finally {
    backupFileInput.value = "";
    setBackupBusy(false);
  }
}

function enteredIsbns() {
  return bulkIsbnInput.value
    .split(/\r?\n/)
    .map(cleanIsbn)
    .filter(Boolean);
}

function updateBulkEntryCount() {
  const codes = enteredIsbns();
  bulkEntryCount.textContent = `${codes.length} ${codes.length === 1 ? "codice" : "codici"}`;
}

function setScannerStatus(message, state = "") {
  scannerStatus.textContent = message;
  scannerStatus.className = "scanner-status";
  if (state) scannerStatus.classList.add(`is-${state}`);
}

function loadScannerLibrary() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  if (scannerLibraryPromise) return scannerLibraryPromise;

  scannerLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@zxing/browser@0.2.0/umd/zxing-browser.min.js";
    script.async = true;
    script.dataset.barcodeScanner = "true";
    script.addEventListener("load", () => resolve(window.ZXingBrowser));
    script.addEventListener("error", () => reject(new Error("Impossibile caricare lo scanner.")));
    document.head.append(script);
  }).catch((error) => {
    scannerLibraryPromise = null;
    throw error;
  });

  return scannerLibraryPromise;
}

function waitForScannerVideo(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("video-timeout")), 4000);

    function finish(error) {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", handleLoaded);
      video.removeEventListener("error", handleError);
      if (error) reject(error);
      else resolve();
    }

    function handleLoaded() {
      finish();
    }

    function handleError() {
      finish(new Error("video-error"));
    }

    video.addEventListener("loadeddata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

async function createNativeBarcodeControls(video, onResult) {
  const NativeBarcodeDetector = window.BarcodeDetector;
  if (typeof NativeBarcodeDetector !== "function") return null;

  try {
    if (typeof NativeBarcodeDetector.getSupportedFormats === "function") {
      const supportedFormats = await NativeBarcodeDetector.getSupportedFormats();
      if (!supportedFormats.includes("ean_13")) return null;
    }

    const detector = new NativeBarcodeDetector({ formats: ["ean_13"] });
    await waitForScannerVideo(video);
    await video.play();

    let stopped = false;
    let timer = 0;
    let videoFrameRequest = 0;

    const processDetections = (detections) => {
      detections.forEach((detection) => {
        if (detection.rawValue) onResult(detection.rawValue);
      });
    };

    // La prima lettura conferma che il browser accetti davvero il flusso video.
    processDetections(await detector.detect(video));

    const scheduleNextFrame = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        videoFrameRequest = video.requestVideoFrameCallback(scanFrame);
      } else {
        timer = window.setTimeout(scanFrame, 140);
      }
    };

    const scanFrame = async () => {
      if (stopped) return;
      try {
        processDetections(await detector.detect(video));
      } catch {
        // Un singolo fotogramma non leggibile non deve interrompere la scansione.
      }
      scheduleNextFrame();
    };

    scheduleNextFrame();

    return {
      stop() {
        stopped = true;
        window.clearTimeout(timer);
        if (videoFrameRequest && typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(videoFrameRequest);
        }
      }
    };
  } catch {
    return null;
  }
}

function addScannedIsbn(rawValue) {
  const isbn = cleanIsbn(rawValue);
  const now = Date.now();
  if (isbn === lastScannedCode && now - lastScanTime < 2000) return;
  lastScannedCode = isbn;
  lastScanTime = now;

  if (!isValidIsbn(isbn)) {
    setScannerStatus(`Codice ${isbn || "non leggibile"}: non è un ISBN valido.`, "error");
    return;
  }

  if (enteredIsbns().includes(isbn)) {
    setScannerStatus(`${isbn} è già presente nell’elenco.`, "duplicate");
    return;
  }

  const currentValue = bulkIsbnInput.value.trimEnd();
  bulkIsbnInput.value = `${currentValue}${currentValue ? "\n" : ""}${isbn}\n`;
  updateBulkEntryCount();
  bulkIsbnInput.scrollTop = bulkIsbnInput.scrollHeight;
  setScannerStatus(`Acquisito: ${isbn} · ${bulkEntryCount.textContent}.`, "success");
  if (navigator.vibrate) navigator.vibrate(80);
}

function releaseScannerCamera() {
  if (scannerControls) {
    scannerControls.stop();
    scannerControls = null;
  }
  const stream = barcodeVideo.srcObject;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  barcodeVideo.srcObject = null;
  scannerTrack = null;
  focusScannerButton.disabled = true;
}

async function getRearCameraStream() {
  const preferredVideo = {
    facingMode: { exact: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 }
  };

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: preferredVideo });
  } catch (error) {
    if (error?.name !== "OverconstrainedError" && error?.name !== "NotFoundError") throw error;
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      }
    });
  }
}

function scannerFocusModes() {
  try {
    return scannerTrack?.getCapabilities?.().focusMode || [];
  } catch {
    return [];
  }
}

async function enableContinuousFocus() {
  if (!scannerTrack) return false;
  const focusModes = scannerFocusModes();
  if (!focusModes.includes("continuous")) return false;
  await scannerTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
  return true;
}

async function refocusScannerCamera() {
  if (!scannerTrack) return;
  focusScannerButton.disabled = true;
  setScannerStatus("Regolo la messa a fuoco…");

  try {
    const focusModes = scannerFocusModes();
    if (focusModes.includes("single-shot")) {
      await scannerTrack.applyConstraints({ advanced: [{ focusMode: "single-shot" }] });
    } else if (focusModes.includes("continuous")) {
      await scannerTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    } else {
      throw new Error("focus-not-supported");
    }
    setScannerStatus("Messa a fuoco aggiornata. Inquadra il codice nel riquadro.");
  } catch {
    setScannerStatus("Allontana leggermente il telefono e tienilo fermo sul codice.", "duplicate");
  } finally {
    focusScannerButton.disabled = false;
  }
}

function stopBarcodeScanner({ hide = true } = {}) {
  scannerSession += 1;
  releaseScannerCamera();
  startScannerButton.disabled = bulkRunning;
  startScannerButton.hidden = false;
  startScannerButton.textContent = "Avvia fotocamera";
  if (hide) {
    barcodeScanner.hidden = true;
    setScannerStatus("Inquadra il codice a barre sul retro del libro.");
    if (bulkDialog.open) bulkIsbnInput.focus();
  }
}

function scannerErrorMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "Permesso fotocamera negato. Abilitalo nelle impostazioni del browser e riprova.";
  }
  if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError") {
    return "Non è stata trovata una fotocamera posteriore disponibile.";
  }
  if (error?.name === "NotReadableError") {
    return "La fotocamera è già utilizzata da un’altra applicazione.";
  }
  return error?.message || "Non riesco ad avviare la fotocamera.";
}

async function startBarcodeScanner() {
  if (bulkRunning || scannerControls) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    barcodeScanner.hidden = false;
    setScannerStatus("Questo browser non consente l’uso della fotocamera. Puoi continuare con la pistola scanner.", "error");
    return;
  }

  barcodeScanner.hidden = false;
  startScannerButton.disabled = true;
  startScannerButton.hidden = true;
  startScannerButton.textContent = "Avvio fotocamera…";
  setScannerStatus("Sto preparando la fotocamera…");
  lastScannedCode = "";
  lastScanTime = 0;
  const session = ++scannerSession;
  let stream = null;

  try {
    stream = await getRearCameraStream();
    if (session !== scannerSession || !bulkDialog.open) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    barcodeVideo.srcObject = stream;
    scannerTrack = stream.getVideoTracks()[0] || null;
    focusScannerButton.disabled = !scannerTrack;
    await enableContinuousFocus().catch(() => false);

    let controls = await createNativeBarcodeControls(barcodeVideo, (rawValue) => {
      if (session === scannerSession) addScannedIsbn(rawValue);
    });
    const usingNativeDetector = Boolean(controls);

    if (!controls) {
      const ZXingBrowser = await loadScannerLibrary();
      if (session !== scannerSession || !bulkDialog.open) return;
      if (
        !ZXingBrowser?.BrowserMultiFormatOneDReader
        && !ZXingBrowser?.BrowserMultiFormatReader
      ) {
        throw new Error("Scanner non disponibile.");
      }

      const Reader = ZXingBrowser.BrowserMultiFormatOneDReader
        || ZXingBrowser.BrowserMultiFormatReader;
      const reader = new Reader();
      controls = await reader.decodeFromStream(
        stream,
        barcodeVideo,
        (result) => {
          if (result && session === scannerSession) addScannedIsbn(result.getText());
        }
      );
    }

    if (session !== scannerSession || !bulkDialog.open) {
      controls.stop();
      return;
    }
    scannerControls = controls;
    startScannerButton.textContent = "Fotocamera attiva";
    setScannerStatus(
      usingNativeDetector
        ? "Lettore Android attivo: inquadra l’ISBN."
        : "Fotocamera pronta: l’ISBN verrà aggiunto appena riconosciuto."
    );
  } catch (error) {
    if (stream && barcodeVideo.srcObject !== stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    releaseScannerCamera();
    if (session !== scannerSession) return;
    startScannerButton.disabled = false;
    startScannerButton.hidden = false;
    startScannerButton.textContent = "Riprova fotocamera";
    setScannerStatus(scannerErrorMessage(error), "error");
  }
}

function openBulkDialog() {
  stopBarcodeScanner();
  bulkIsbnInput.value = "";
  bulkProgress.textContent = "";
  bulkResults.replaceChildren();
  startBulkButton.disabled = false;
  startBulkButton.textContent = "Importa libri";
  updateBulkEntryCount();
  bulkDialog.showModal();
  if (!window.matchMedia("(pointer: coarse)").matches) {
    bulkIsbnInput.focus();
  }
}

function closeBulkDialog() {
  if (!bulkRunning) {
    stopBarcodeScanner();
    bulkDialog.close();
  }
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
  const isbns = enteredIsbns();

  bulkResults.replaceChildren();
  if (!isbns.length) {
    bulkProgress.textContent = "Inserisci almeno un ISBN.";
    bulkIsbnInput.focus();
    return;
  }

  stopBarcodeScanner();
  bulkRunning = true;
  startBulkButton.disabled = true;
  closeBulkButton.disabled = true;
  cancelBulkButton.disabled = true;
  startScannerButton.disabled = true;
  let imported = 0;
  let notImported = 0;
  let failed = 0;

  try {
    const allBooks = await listBooks();
    const existingByIsbn = new Map();
    allBooks.forEach((book) => {
      const isbn = cleanIsbn(book.isbn);
      if (!isbn) return;
      const matchingBooks = existingByIsbn.get(isbn) || [];
      matchingBooks.push(book);
      existingByIsbn.set(isbn, matchingBooks);
    });

    for (let index = 0; index < isbns.length; index += 1) {
      const isbn = isbns[index];
      bulkProgress.textContent = `Elaborazione ${index + 1} di ${isbns.length}: ${isbn}`;

      const matchingBooks = existingByIsbn.get(isbn) || [];
      if (matchingBooks.length) {
        const accepted = await confirmAdditionalCopy({
          title: matchingBooks[0].title,
          isbn,
          existingCount: matchingBooks.length
        });
        if (!accepted) {
          notImported += 1;
          addBulkResult(isbn, "skipped", "Non importato: possibile doppione");
          continue;
        }
      }

      try {
        const metadata = await lookupBookByIsbn(isbn);
        await saveBook(metadata);
        imported += 1;
        const copies = existingByIsbn.get(isbn) || [];
        copies.push(metadata);
        existingByIsbn.set(isbn, copies);
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
      `Completato: ${imported} importati, ${notImported} non importati, ${failed} non riusciti.`;
    await loadBooks(searchInput.value);
  } catch (error) {
    bulkProgress.textContent = `Importazione interrotta: ${error.message}`;
  } finally {
    bulkRunning = false;
    startBulkButton.disabled = false;
    closeBulkButton.disabled = false;
    cancelBulkButton.disabled = false;
    startScannerButton.disabled = false;
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
  formSubmitButton.disabled = true;
  try {
    const isbn = cleanIsbn(payload.isbn);
    if (isbn) {
      const allBooks = await listBooks();
      const originalBook = id
        ? allBooks.find((book) => String(book.id) === String(id))
        : null;
      const isbnChanged = !originalBook || cleanIsbn(originalBook.isbn) !== isbn;
      const matchingBooks = isbnChanged
        ? allBooks.filter((book) => String(book.id) !== String(id) && cleanIsbn(book.isbn) === isbn)
        : [];

      if (matchingBooks.length) {
        const accepted = await confirmAdditionalCopy({
          title: matchingBooks[0].title || payload.title,
          isbn,
          existingCount: matchingBooks.length
        });
        if (!accepted) {
          formError.textContent = "Salvataggio annullato: il libro era già presente.";
          return;
        }
      }
    }

    await saveBook(payload, id);
    closeDialog();
    await loadBooks(searchInput.value);
  } catch (error) {
    formError.textContent = error.message;
  } finally {
    formSubmitButton.disabled = false;
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
  searchTimer = setTimeout(() => applyCatalogView(), 120);
});

searchField.addEventListener("change", () => {
  clearTimeout(searchTimer);
  applyCatalogView();
});

quickFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeQuickFilter = button.dataset.quickFilter;
    applyCatalogView();
  });
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
  catalogBooks = [];
  books = [];
  activeQuickFilter = "all";
  renderQuickFilters();
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
    for (const localBook of localBooks) {
      await saveBook(bookPayloadFrom(localBook));
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
backupButton.addEventListener("click", openBackupDialog);
closeBackupButton.addEventListener("click", closeBackupDialog);
dismissBackupButton.addEventListener("click", closeBackupDialog);
exportBackupButton.addEventListener("click", exportBackup);
importBackupButton.addEventListener("click", () => backupFileInput.click());
backupFileInput.addEventListener("change", () => {
  const [file] = backupFileInput.files;
  if (file) importBackupFile(file);
});
rejectDuplicateButton.addEventListener("click", () => settleDuplicateDecision(false));
acceptDuplicateButton.addEventListener("click", () => settleDuplicateDecision(true));
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
startScannerButton.addEventListener("click", startBarcodeScanner);
stopScannerButton.addEventListener("click", () => stopBarcodeScanner());
focusScannerButton.addEventListener("click", refocusScannerCamera);
barcodeVideo.addEventListener("click", refocusScannerCamera);
bulkIsbnInput.addEventListener("input", updateBulkEntryCount);
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
  if (bulkRunning) {
    event.preventDefault();
  } else {
    stopBarcodeScanner();
  }
});
bulkDialog.addEventListener("close", () => stopBarcodeScanner());
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
backupDialog.addEventListener("cancel", (event) => {
  if (backupRunning) event.preventDefault();
});
backupDialog.addEventListener("click", (event) => {
  if (event.target === backupDialog) closeBackupDialog();
});
duplicateDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  settleDuplicateDecision(false);
});
duplicateDialog.addEventListener("click", (event) => {
  if (event.target === duplicateDialog) settleDuplicateDecision(false);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && scannerControls) stopBarcodeScanner();
});

initializeApp().catch((error) => {
  grid.textContent = `Impossibile caricare il catalogo: ${error.message}`;
  if (isCloudMode) {
    showAuthDialog();
    authError.textContent = error.message;
  }
});
