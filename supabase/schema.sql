create extension if not exists pgcrypto;

create or replace function public.is_known_location(value text)
returns boolean
language sql
immutable
as $$
  select
    coalesce(value, '') ~ '^(Camera · (Sinistra [1-9]|Centro [1-3]|Destra [1-9])|Sgabuzzino · (Sinistra [1-2]|Destra [1-9])|Ingresso · (Sinistra [1-9]|Centro [1-9]|Destra [1-3])|(Sinistra [1-9]|Centro [1-3]|Destra [1-9]))$';
$$;

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  authors text not null default '',
  isbn text not null default '',
  publisher text not null default '',
  publication_year integer,
  language text not null default 'Italiano',
  location text not null default '',
  reading_status text not null default 'Da sistemare',
  loaned_to text not null default '',
  tags text not null default '',
  notes text not null default '',
  cover_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.prepare_book()
returns trigger
language plpgsql
as $$
begin
  new.title := trim(new.title);
  new.authors := trim(coalesce(new.authors, ''));
  new.isbn := regexp_replace(upper(coalesce(new.isbn, '')), '[^0-9X]', '', 'g');
  new.location := trim(coalesce(new.location, ''));
  new.reading_status := case
    when public.is_known_location(new.location) then 'Sistemato'
    else 'Da sistemare'
  end;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prepare_book_before_write on public.books;
create trigger prepare_book_before_write
before insert or update on public.books
for each row execute function public.prepare_book();

create index if not exists books_owner_title_idx
  on public.books(owner_id, lower(title));
create index if not exists books_owner_isbn_idx
  on public.books(owner_id, isbn);

alter table public.books enable row level security;

drop policy if exists "Leggi i propri libri" on public.books;
create policy "Leggi i propri libri"
on public.books for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Aggiungi i propri libri" on public.books;
create policy "Aggiungi i propri libri"
on public.books for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "Modifica i propri libri" on public.books;
create policy "Modifica i propri libri"
on public.books for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Elimina i propri libri" on public.books;
create policy "Elimina i propri libri"
on public.books for delete
to authenticated
using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.books to authenticated;
