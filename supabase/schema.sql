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

create table if not exists public.book_loans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  book_id uuid not null
    references public.books(id) on delete cascade,
  borrower text not null,
  loaned_at date not null default current_date,
  returned_at date,
  created_at timestamptz not null default now(),
  constraint borrower_not_empty check (trim(borrower) <> ''),
  constraint valid_return_date check (
    returned_at is null or returned_at >= loaned_at
  )
);

create index if not exists book_loans_owner_book_idx
  on public.book_loans(owner_id, book_id, loaned_at desc);

create unique index if not exists book_loans_one_active_idx
  on public.book_loans(book_id)
  where returned_at is null;

alter table public.book_loans enable row level security;

drop policy if exists "Leggi i propri prestiti" on public.book_loans;
create policy "Leggi i propri prestiti"
on public.book_loans for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Aggiungi i propri prestiti" on public.book_loans;
create policy "Aggiungi i propri prestiti"
on public.book_loans for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "Modifica i propri prestiti" on public.book_loans;
create policy "Modifica i propri prestiti"
on public.book_loans for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Elimina i propri prestiti" on public.book_loans;
create policy "Elimina i propri prestiti"
on public.book_loans for delete
to authenticated
using ((select auth.uid()) = owner_id);

grant select, insert, update, delete
on public.book_loans to authenticated;

create or replace function public.lend_book(
  p_book_id uuid,
  p_borrower text,
  p_loaned_at date default current_date
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if nullif(trim(p_borrower), '') is null then
    raise exception 'Inserisci il nome della persona';
  end if;

  if not exists (
    select 1 from public.books
    where id = p_book_id and owner_id = auth.uid()
  ) then
    raise exception 'Libro non trovato';
  end if;

  update public.book_loans
  set returned_at = p_loaned_at
  where book_id = p_book_id
    and owner_id = auth.uid()
    and returned_at is null;

  insert into public.book_loans (
    owner_id, book_id, borrower, loaned_at
  )
  values (
    auth.uid(), p_book_id, trim(p_borrower), p_loaned_at
  );

  update public.books
  set loaned_to = trim(p_borrower)
  where id = p_book_id and owner_id = auth.uid();
end;
$$;

create or replace function public.return_book(
  p_book_id uuid,
  p_returned_at date default current_date
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.book_loans
  set returned_at = p_returned_at
  where book_id = p_book_id
    and owner_id = auth.uid()
    and returned_at is null;

  update public.books
  set loaned_to = ''
  where id = p_book_id and owner_id = auth.uid();
end;
$$;

grant execute on function public.lend_book(uuid, text, date)
to authenticated;

grant execute on function public.return_book(uuid, date)
to authenticated;
