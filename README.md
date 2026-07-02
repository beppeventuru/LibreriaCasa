# Libreria Casa

Prima versione della webapp locale per catalogare la propria biblioteca e usarla
anche da telefono sulla rete Wi-Fi domestica.

I libri possono essere inseriti manualmente oppure cercati per ISBN. La ricerca
recupera i metadati disponibili da Open Library; prima del salvataggio è sempre
possibile correggerli o completarli. Il comando `Importa più ISBN` consente di
incollare un elenco con un codice per riga e mostra l'esito di ogni inserimento.
La ricerca consulta prima Open Library e poi il catalogo italiano SBN; quando
nessuna fonte contiene il volume, il risultato permette di compilare la scheda
manualmente conservando l'ISBN.

## Google Books

Per abilitare Google Books, creare nella cartella del progetto un file `.env`
contenente:

```text
GOOGLE_BOOKS_API_KEY=la_tua_chiave_google
```

La chiave rimane sul server locale e non viene inviata al browser. Quando è
configurata, l'ordine di ricerca diventa Open Library, Google Books e SBN.

## Avvio

Da PowerShell:

```powershell
cd C:\Users\Utente\Documents\Playground\LibreriaCasa
& C:\Users\Utente\Documents\Playground\tools\node\node.exe server.mjs
```

Il terminale mostra due indirizzi:

- `http://localhost:4173` per il computer;
- `http://INDIRIZZO-IP:4173` per il telefono connesso alla stessa rete Wi-Fi.

Il catalogo è salvato nel file `data\libreria.db`. Per fare un backup, arrestare
la webapp e copiare l'intera cartella `data`.

## Sicurezza

Questa prima versione non ha autenticazione. Va usata soltanto sulla propria rete
domestica e non deve essere esposta direttamente su Internet.
