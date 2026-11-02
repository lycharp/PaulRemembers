-- Journal app: cloud storage, sign-in and sharing.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- It is safe to run more than once.

-- ─── Tables ────────────────────────────────────────────────────────────────

create table if not exists public.journals (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  owner_email text default (auth.jwt() ->> 'email'),
  data        jsonb not null default '{}',   -- name, color, createdAt …
  updated_at  bigint not null,               -- client clock (ms), last writer wins
  deleted     boolean not null default false,
  synced_at   timestamptz not null default clock_timestamp()
);

create table if not exists public.entries (
  id          text primary key,
  journal_id  text,
  author_id   uuid not null default auth.uid() references auth.users on delete cascade,
  data        jsonb not null default '{}',   -- title, body, date, mood, place …
  updated_at  bigint not null,
  deleted     boolean not null default false,
  synced_at   timestamptz not null default clock_timestamp()
);
create index if not exists entries_journal on public.entries (journal_id);
create index if not exists entries_synced on public.entries (synced_at);

create table if not exists public.media (
  id          text primary key,
  entry_id    text not null,
  data        jsonb not null default '{}',   -- kind, caption, takenAt, type …
  path        text,                          -- object in the "media" storage bucket
  updated_at  bigint not null,
  deleted     boolean not null default false,
  synced_at   timestamptz not null default clock_timestamp()
);
create index if not exists media_entry on public.media (entry_id);
create index if not exists media_synced on public.media (synced_at);

-- People a journal is shared with (they sign in with this email address).
create table if not exists public.journal_members (
  journal_id text not null references public.journals on delete cascade,
  email      text not null,
  role       text not null default 'viewer' check (role in ('viewer', 'editor')),
  added_at   timestamptz not null default now(),
  primary key (journal_id, email)
);

-- Private links to a single entry: anyone with the link can read it.
create table if not exists public.entry_shares (
  token      text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  entry_id   text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists entry_shares_entry on public.entry_shares (entry_id);

-- Keep synced_at moving so other devices can ask "what changed since …".
create or replace function public.touch_synced_at() returns trigger language plpgsql as $$
begin new.synced_at := clock_timestamp(); return new; end $$;
drop trigger if exists touch on public.journals;
drop trigger if exists touch on public.entries;
drop trigger if exists touch on public.media;
create trigger touch before update on public.journals for each row execute function public.touch_synced_at();
create trigger touch before update on public.entries  for each row execute function public.touch_synced_at();
create trigger touch before update on public.media    for each row execute function public.touch_synced_at();

-- ─── Who may see what ──────────────────────────────────────────────────────

-- 'owner', 'editor', 'viewer' or null for the signed-in person.
create or replace function public.journal_role(j text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from journals where id = j and owner_id = auth.uid()) then 'owner'
    else (select role from journal_members
          where journal_id = j and lower(email) = lower(auth.jwt() ->> 'email'))
  end
$$;

create or replace function public.entry_role(e text) returns text
language sql stable security definer set search_path = public as $$
  select journal_role((select journal_id from entries where id = e))
$$;

create or replace function public.entry_is_shared(e text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from entry_shares s join entries x on x.id = s.entry_id
                 where s.entry_id = e and not x.deleted)
$$;

alter table public.journals        enable row level security;
alter table public.entries         enable row level security;
alter table public.media           enable row level security;
alter table public.journal_members enable row level security;
alter table public.entry_shares    enable row level security;

drop policy if exists "read" on public.journals;
drop policy if exists "create" on public.journals;
drop policy if exists "change" on public.journals;
-- owner_id check first: a brand-new row is not yet visible to journal_role(), and
-- upserts (INSERT … ON CONFLICT) must also pass this policy for the new row.
create policy "read"   on public.journals for select to authenticated using (owner_id = auth.uid() or journal_role(id) is not null);
create policy "create" on public.journals for insert to authenticated with check (owner_id = auth.uid());
create policy "change" on public.journals for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "read" on public.entries;
drop policy if exists "create" on public.entries;
drop policy if exists "change" on public.entries;
create policy "read"   on public.entries for select to authenticated using (journal_role(journal_id) is not null);
create policy "create" on public.entries for insert to authenticated
  with check (author_id = auth.uid() and journal_role(journal_id) in ('owner', 'editor'));
create policy "change" on public.entries for update to authenticated
  using (journal_role(journal_id) in ('owner', 'editor'))
  with check (journal_role(journal_id) in ('owner', 'editor'));

drop policy if exists "read" on public.media;
drop policy if exists "create" on public.media;
drop policy if exists "change" on public.media;
create policy "read"   on public.media for select to authenticated using (entry_role(entry_id) is not null);
create policy "create" on public.media for insert to authenticated with check (entry_role(entry_id) in ('owner', 'editor'));
create policy "change" on public.media for update to authenticated
  using (entry_role(entry_id) in ('owner', 'editor')) with check (entry_role(entry_id) in ('owner', 'editor'));

drop policy if exists "owner manages" on public.journal_members;
drop policy if exists "member sees self" on public.journal_members;
create policy "owner manages" on public.journal_members for all to authenticated
  using (journal_role(journal_id) = 'owner') with check (journal_role(journal_id) = 'owner');
create policy "member sees self" on public.journal_members for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "owner manages" on public.entry_shares;
create policy "owner manages" on public.entry_shares for all to authenticated
  using (entry_role(entry_id) = 'owner') with check (entry_role(entry_id) = 'owner' and created_by = auth.uid());

-- Read one shared entry by its link token, without signing in.
create or replace function public.get_shared_entry(t text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', e.id,
    'entry', e.data,
    'media', coalesce((select json_agg(json_build_object('id', m.id, 'data', m.data, 'path', m.path))
                       from media m where m.entry_id = e.id and not m.deleted), '[]'::json))
  from entry_shares s join entries e on e.id = s.entry_id
  where s.token = t and not e.deleted
$$;
grant execute on function public.get_shared_entry(text) to anon, authenticated;

-- ─── Photo and video storage ───────────────────────────────────────────────
-- Files live at media/<entry id>/<media id>.

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "journal media read" on storage.objects;
drop policy if exists "journal media write" on storage.objects;
drop policy if exists "journal media update" on storage.objects;
drop policy if exists "journal media delete" on storage.objects;
create policy "journal media read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'media' and (
    public.entry_role((storage.foldername(name))[1]) is not null
    or public.entry_is_shared((storage.foldername(name))[1])));
create policy "journal media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.entry_role((storage.foldername(name))[1]) in ('owner', 'editor'));
create policy "journal media update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.entry_role((storage.foldername(name))[1]) in ('owner', 'editor'));
create policy "journal media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.entry_role((storage.foldername(name))[1]) in ('owner', 'editor'));
