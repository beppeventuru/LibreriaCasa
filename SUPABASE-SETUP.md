# Collegare Libreria Casa a Supabase

## 1. Crea il progetto

Apri il pannello Supabase, crea un nuovo progetto e conserva la password del
database nel tuo gestore di password. Non inserirla nella webapp.

## 2. Crea l'archivio

Nel pannello Supabase apri **SQL Editor**, incolla il contenuto di
`supabase/schema.sql` ed eseguilo. Lo schema attiva le regole RLS: ogni account
può leggere e modificare soltanto i propri libri.

## 3. Collega la webapp

In **Project Settings > API** copia:

- Project URL
- Publishable key

Inseriscili in `public/config.js`. Non usare mai la chiave `service_role` nel
browser o nel repository.

## 4. Configura l'accesso

In **Authentication > URL Configuration** imposta come Site URL l'indirizzo
GitHub Pages della libreria. Lascia attivo l'accesso con email e password.

## 5. Attiva la ricerca ISBN

Distribuisci la funzione `supabase/functions/isbn-lookup` e salva la chiave di
Google Books tra i segreti della funzione con il nome
`GOOGLE_BOOKS_API_KEY`. La chiave non deve essere scritta nei file pubblici.

## 6. Pubblica

Carica il progetto in un repository GitHub, abilita **Pages > GitHub Actions**
e invia il ramo `main`. Il workflow `.github/workflows/pages.yml` pubblicherà
automaticamente la cartella `public`.
