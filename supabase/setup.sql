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

-- Invite-only: the one person who runs the app (see make_admin at the end) …
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users on delete cascade
);
-- … and the email addresses they invited. Only these can create an account.
create table if not exists public.invites (
  email    text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

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

-- Is the signed-in person the app's admin (the only one who may invite)?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
$$;
grant execute on function public.is_admin() to authenticated;

-- May the signed-in person share a journal with this email? The admin always
-- may (sharing invites them too). Anyone else only with people who already
-- have an account or were invited by the admin, so sharing is never a way in.
create or replace function public.can_share_with(e text) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select is_admin()
      or exists (select 1 from invites where email = lower(e))
      or exists (select 1 from auth.users where lower(email) = lower(e))
$$;

alter table public.journals        enable row level security;
alter table public.entries         enable row level security;
alter table public.media           enable row level security;
alter table public.journal_members enable row level security;
alter table public.entry_shares    enable row level security;
alter table public.app_admins      enable row level security;
alter table public.invites         enable row level security;

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
  using (journal_role(journal_id) = 'owner')
  with check (journal_role(journal_id) = 'owner' and can_share_with(email));
create policy "member sees self" on public.journal_members for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "owner manages" on public.entry_shares;
create policy "owner manages" on public.entry_shares for all to authenticated
  using (entry_role(entry_id) = 'owner') with check (entry_role(entry_id) = 'owner' and created_by = auth.uid());

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

-- ─── Invite-only sign-up ───────────────────────────────────────────────────

-- Only the admin sees and changes the invite list (no policy on app_admins:
-- nobody can read or change it from the app, only here in the SQL Editor).
drop policy if exists "admin manages" on public.invites;
create policy "admin manages" on public.invites for all to authenticated
  using (is_admin()) with check (is_admin());
grant select, insert, update, delete on public.invites to authenticated;
revoke all on public.app_admins from anon, authenticated;

-- The invite list for Settings, with whether each person has signed up yet.
create or replace function public.list_invites()
returns table (email text, added_at timestamptz, joined boolean)
language sql stable security definer set search_path = public, auth as $$
  select i.email, i.added_at, exists (select 1 from auth.users u where lower(u.email) = i.email)
  from invites i where is_admin() order by i.added_at
$$;
grant execute on function public.list_invites() to authenticated;

-- When the admin shares a journal with someone, that invites them too.
create or replace function public.invite_shared() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then
    insert into invites (email) values (lower(new.email)) on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists invite_shared on public.journal_members;
create trigger invite_shared after insert or update on public.journal_members
  for each row execute function public.invite_shared();

-- The gate: Supabase refuses any new account (email or Google) whose email is
-- not on the invite list. Existing accounts are not affected.
create or replace function public.only_invited() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or not exists (select 1 from public.invites where email = lower(new.email)) then
    raise exception 'Paul Remembers is invite-only: % was not invited', coalesce(new.email, 'this account');
  end if;
  return new;
end $$;
drop trigger if exists only_invited on auth.users;
create trigger only_invited before insert on auth.users
  for each row execute function public.only_invited();

-- Run once, as its own query, with the email you sign in with:
--   select make_admin('you@example.com');
-- It makes that account the admin and invites everyone it already shares with.
create or replace function public.make_admin(admin_email text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(admin_email));
  if uid is null then
    raise exception 'No account uses %. Check the spelling, or sign in to the app once first.', admin_email;
  end if;
  insert into app_admins (user_id) values (uid) on conflict do nothing;
  insert into invites (email)
    select distinct lower(m.email) from journal_members m join journals j on j.id = m.journal_id
    where j.owner_id = uid
  on conflict do nothing;
  return 'Done: ' || admin_email || ' can now invite people.';
end $$;
revoke execute on function public.make_admin(text) from public, anon, authenticated;

-- ─── Who wrote what (Version 3) ────────────────────────────────────────────

-- Everyone who wrote or changed an entry, in the order they joined in: the
-- person who wrote it first, then each new person who edits it. The server
-- keeps this list, so nobody's device can leave someone out.
alter table public.entries add column if not exists contributors uuid[] not null default '{}';
update public.entries set contributors = array[author_id] where contributors = '{}';

create or replace function public.add_contributor() returns trigger
language plpgsql as $$
declare
  me uuid := coalesce(auth.uid(), new.author_id);
  changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    new.contributors := old.contributors;
    -- Only a real change counts: not a bookmark, and not the same entry sent again.
    changed := (old.data - 'bookmarked' - 'updatedAt' - 'contributors')
               is distinct from (new.data - 'bookmarked' - 'updatedAt' - 'contributors');
  end if;
  new.contributors := coalesce(new.contributors, '{}');
  if not new.deleted and changed and not (me = any(new.contributors)) then
    new.contributors := new.contributors || me;
  end if;
  return new;
end $$;
drop trigger if exists contributors on public.entries;
create trigger contributors before insert or update on public.entries
  for each row execute function public.add_contributor();

-- Each person's name and icon (an emoji, or a coloured circle with their initial).
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  name       text,
  icon       text,
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.profiles to authenticated;

-- Read one shared entry by its link token, without signing in. 'by' is the
-- person who made the link (email, name and icon), shown as "Shared by".
-- It reads profiles, so it comes after that table.
create or replace function public.get_shared_entry(t text) returns json
language sql stable security definer set search_path = public, auth as $$
  select json_build_object(
    'id', e.id,
    'entry', e.data,
    'media', coalesce((select json_agg(json_build_object('id', m.id, 'data', m.data, 'path', m.path))
                       from media m where m.entry_id = e.id and not m.deleted), '[]'::json),
    'by', (select json_build_object('id', u.id, 'email', u.email, 'name', p.name, 'icon', p.icon)
           from auth.users u left join profiles p on p.user_id = u.id where u.id = s.created_by))
  from entry_shares s join entries e on e.id = s.entry_id
  where s.token = t and not e.deleted
$$;
grant execute on function public.get_shared_entry(text) to anon, authenticated;

-- The people the signed-in person shares journals with (and themselves):
-- journal owners, the people a journal is shared with, and anyone who wrote
-- in an entry they can read.
create or replace function public.list_people()
returns table (user_id uuid, email text, name text, icon text)
language sql stable security definer set search_path = public, auth as $$
  with mine as (
    select id, owner_id from journals where not deleted and journal_role(id) is not null
  ), ids as (
    select auth.uid() as uid
    union select owner_id from mine
    union select u.id from journal_members m join mine on mine.id = m.journal_id
                         join auth.users u on lower(u.email) = lower(m.email)
    union select unnest(e.contributors) from entries e join mine on mine.id = e.journal_id
  )
  select u.id, u.email::text, p.name, p.icon
  from ids join auth.users u on u.id = ids.uid
  left join profiles p on p.user_id = u.id
  where auth.uid() is not null
$$;
grant execute on function public.list_people() to authenticated;

-- ─── Admin page and invite requests ──────────────────────────
-- Admins see who uses the app, who shares what, and how much is stored.
-- Counts and dates only: nothing here reads what anyone wrote.

-- Someone asks the admin to invite a person they want to share a journal with.
create table if not exists public.invite_requests (
  journal_id   text not null references public.journals on delete cascade,
  email        text not null check (email = lower(email)),
  role         text not null default 'viewer' check (role in ('viewer', 'editor')),
  requested_by uuid not null default auth.uid() references auth.users on delete cascade,
  status       text not null default 'waiting' check (status in ('waiting', 'declined')),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  primary key (journal_id, email)
);
alter table public.invite_requests enable row level security;
-- The person who asked sees (and can cancel or clear) their own requests; admins see all.
drop policy if exists "asker or admin reads" on public.invite_requests;
drop policy if exists "asker or admin removes" on public.invite_requests;
create policy "asker or admin reads" on public.invite_requests for select to authenticated
  using (requested_by = auth.uid() or is_admin());
create policy "asker or admin removes" on public.invite_requests for delete to authenticated
  using (requested_by = auth.uid() or is_admin());
grant select, delete on public.invite_requests to authenticated;

-- Ask the admin to invite this person and share one of your journals with them.
create or replace function public.request_invite(j text, e text, r text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if journal_role(j) is distinct from 'owner' then
    raise exception 'Only the journal''s owner can share it.';
  end if;
  insert into invite_requests (journal_id, email, role, requested_by)
  values (j, lower(trim(e)), r, auth.uid())
  on conflict (journal_id, email) do update
    set role = excluded.role, requested_by = excluded.requested_by,
        status = 'waiting', created_at = now(), decided_at = null;
end $$;
grant execute on function public.request_invite(text, text, text) to authenticated;

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only admins can do this.'; end if;
end $$;

-- Approve: invite them and share the journal, in one step.
create or replace function public.approve_request(j text, e text) returns void
language plpgsql security definer set search_path = public as $$
declare req invite_requests;
begin
  perform require_admin();
  select * into req from invite_requests where journal_id = j and email = lower(e);
  if req is null then raise exception 'That request is gone. Someone may have cancelled it.'; end if;
  insert into invites (email) values (req.email) on conflict do nothing;
  insert into journal_members (journal_id, email, role) values (req.journal_id, req.email, req.role)
    on conflict (journal_id, email) do update set role = excluded.role;
  delete from invite_requests where journal_id = j and email = req.email;
end $$;
grant execute on function public.approve_request(text, text) to authenticated;

-- Decline: the person who asked sees "Declined" until they clear it.
create or replace function public.decline_request(j text, e text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update invite_requests set status = 'declined', decided_at = now()
  where journal_id = j and email = lower(e);
end $$;
grant execute on function public.decline_request(text, text) to authenticated;

-- Requests for the Admin page, with the journal's name and who asked.
create or replace function public.admin_requests()
returns table (journal_id text, journal_name text, journal_color text, email text, role text,
               requested_by uuid, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.journal_id, j.data ->> 'name', j.data ->> 'color', r.email, r.role, r.requested_by, r.status, r.created_at
  from invite_requests r join journals j on j.id = r.journal_id
  where is_admin() and not j.deleted
  order by r.created_at
$$;
grant execute on function public.admin_requests() to authenticated;

-- Everyone with an account, plus invites nobody has used yet.
create or replace function public.admin_people()
returns table (user_id uuid, email text, name text, icon text, joined_at timestamptz,
               last_active timestamptz, admin boolean, blocked boolean, invited_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, p.name, p.icon, u.created_at,
         greatest(u.last_sign_in_at, (select max(s.updated_at) from auth.sessions s where s.user_id = u.id)),
         exists (select 1 from app_admins a where a.user_id = u.id),
         coalesce(u.banned_until > now(), false),
         (select i.added_at from invites i where i.email = lower(u.email))
  from auth.users u left join profiles p on p.user_id = u.id
  where is_admin()
  union all
  select null, i.email, null, null, null, null, false, false, i.added_at
  from invites i
  where is_admin() and not exists (select 1 from auth.users u where lower(u.email) = i.email)
$$;
grant execute on function public.admin_people() to authenticated;

-- Make someone an admin, or stop them being one (never yourself).
create or replace function public.admin_set_admin(uid uuid, make boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if uid = auth.uid() then raise exception 'You can''t change your own admin rights.'; end if;
  if make then insert into app_admins (user_id) values (uid) on conflict do nothing;
  else delete from app_admins where user_id = uid; end if;
end $$;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;

-- Block someone from signing in (nothing is deleted), or let them back in.
create or replace function public.admin_set_blocked(uid uuid, block boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  perform require_admin();
  if uid = auth.uid() then raise exception 'You can''t block yourself.'; end if;
  if block and exists (select 1 from app_admins where user_id = uid) then
    raise exception 'Remove their admin rights first.';
  end if;
  update auth.users set banned_until = case when block then timestamptz '2999-01-01' else null end where id = uid;
  -- Signed out everywhere, so a block takes effect within the hour.
  if block then delete from auth.sessions where user_id = uid; end if;
end $$;
grant execute on function public.admin_set_blocked(uuid, boolean) to authenticated;

-- Every shared journal and who it is shared with.
create or replace function public.admin_shares()
returns table (journal_id text, journal_name text, journal_color text, owner_id uuid, email text, role text)
language sql stable security definer set search_path = public as $$
  select j.id, j.data ->> 'name', j.data ->> 'color', j.owner_id, m.email, m.role
  from journal_members m join journals j on j.id = m.journal_id
  where is_admin() and not j.deleted
  order by lower(j.data ->> 'name'), m.added_at
$$;
grant execute on function public.admin_shares() to authenticated;

-- Admins can take someone off any shared journal.
create or replace function public.admin_remove_member(j text, e text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  delete from journal_members where journal_id = j and lower(email) = lower(e);
end $$;
grant execute on function public.admin_remove_member(text, text) to authenticated;

-- How much each journal holds: counts, storage and when it last changed.
create or replace function public.admin_usage()
returns table (journal_id text, journal_name text, journal_color text, owner_id uuid,
               entries bigint, photos bigint, videos bigint, voice bigint, bytes bigint, last_updated timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select j.id, j.data ->> 'name', j.data ->> 'color', j.owner_id,
         (select count(*) from entries e where e.journal_id = j.id and not e.deleted),
         coalesce(m.photos, 0), coalesce(m.videos, 0), coalesce(m.voice, 0), coalesce(m.bytes, 0),
         greatest(j.synced_at, (select max(e.synced_at) from entries e where e.journal_id = j.id))
  from journals j
  left join lateral (
    select count(*) filter (where x.data ->> 'kind' = 'photo') photos,
           count(*) filter (where x.data ->> 'kind' = 'video') videos,
           count(*) filter (where x.data ->> 'kind' = 'audio') voice,
           sum(coalesce((o.metadata ->> 'size')::bigint, 0)) bytes
    from entries e join media x on x.entry_id = e.id and not x.deleted
    left join storage.objects o on o.bucket_id = 'media' and o.name = x.path
    where e.journal_id = j.id and not e.deleted
  ) m on true
  where is_admin() and not j.deleted
  order by 10 desc nulls last
$$;
grant execute on function public.admin_usage() to authenticated;

-- Totals for the whole app, and space used against the free plan.
create or replace function public.admin_totals()
returns table (people bigint, journals bigint, entries bigint, entries_this_week bigint, file_bytes bigint, db_bytes bigint)
language sql stable security definer set search_path = public, auth, storage as $$
  select (select count(*) from auth.users),
         (select count(*) from journals where not deleted),
         (select count(*) from entries where not deleted),
         (select count(*) from entries where not deleted and synced_at > now() - interval '7 days'
            and (data ->> 'createdAt') ~ '^[0-9]+$' and (data ->> 'createdAt')::bigint > (extract(epoch from now() - interval '7 days') * 1000)::bigint),
         (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'media'),
         pg_database_size(current_database())
  where is_admin()
$$;
grant execute on function public.admin_totals() to authenticated;

-- ─── Invite emails sent by the app (Version 4) ──────────────────────────────
-- The send-invite function (supabase/functions/send-invite) asks here before
-- every email: is the signed-in person allowed to invite this address, and
-- have they sent fewer than 20 today? Each send is written down.
create table if not exists public.invite_sends (
  id         bigint generated always as identity primary key,
  sender     uuid not null references auth.users on delete cascade,
  email      text not null,
  journal_id text,
  sent_at    timestamptz not null default now()
);
create index if not exists invite_sends_sender on public.invite_sends (sender, sent_at);
alter table public.invite_sends enable row level security;
revoke all on public.invite_sends from anon, authenticated;

-- j = the journal being shared (its owner may invite its members), or null for
-- an invite to the app itself (admins only, to someone on the invite list).
-- Returns the sender's own email, for the copy and for replies.
create or replace function public.claim_invite_send(e text, j text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  me text;
begin
  select email into me from auth.users where id = auth.uid();
  if me is null then raise exception 'Please sign in again, then send the invite.'; end if;
  if j is not null then
    if coalesce(journal_role(j), '') <> 'owner'
       or not exists (select 1 from journal_members where journal_id = j and lower(email) = lower(e)) then
      raise exception 'You can only send invites for your own journals, to people you shared them with.';
    end if;
  elsif not is_admin() or not exists (select 1 from invites where email = lower(e)) then
    raise exception 'Only an admin can invite someone to the app.';
  end if;
  if (select count(*) from invite_sends where sender = auth.uid() and sent_at > now() - interval '1 day') >= 20 then
    raise exception 'You can send up to 20 invites a day. Please try again tomorrow.';
  end if;
  insert into invite_sends (sender, email, journal_id) values (auth.uid(), lower(e), j);
  return me;
end $$;
revoke execute on function public.claim_invite_send(text, text) from public, anon;
grant execute on function public.claim_invite_send(text, text) to authenticated;

-- ─── Reactions ─────────────────────────────────────────────────────────────
-- Emoji reactions on entries in shared journals. Everyone who can read the
-- journal (Can read or Can edit) may add and remove their own reactions.
create table if not exists public.reactions (
  entry_id   text not null,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  emoji      text not null check (emoji in ('❤️', '😂', '😮', '😢', '👍', '👎')),
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id, emoji)
);
alter table public.reactions enable row level security;
drop policy if exists "read" on public.reactions;
drop policy if exists "add own" on public.reactions;
drop policy if exists "remove own" on public.reactions;
create policy "read" on public.reactions for select to authenticated
  using (entry_role(entry_id) is not null);
create policy "add own" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and entry_role(entry_id) is not null);
create policy "remove own" on public.reactions for delete to authenticated
  using (user_id = auth.uid());
grant select, insert, delete on public.reactions to authenticated;

-- When a journal is no longer shared with anyone, its reactions go too.
create or replace function public.clear_reactions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from journal_members where journal_id = old.journal_id) then
    delete from reactions where entry_id in (select id from entries where journal_id = old.journal_id);
  end if;
  return null;
end $$;
drop trigger if exists clear_reactions on public.journal_members;
create trigger clear_reactions after delete on public.journal_members
  for each row execute function public.clear_reactions();

-- ─── Comments ──────────────────────────────────────────────────────────────
-- Comments on entries in shared journals. Everyone who can read the journal
-- (Can read or Can edit) may write comments, and change or delete their own.
-- The journal's owner may also delete anyone's comment.
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  entry_id   text not null,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index if not exists comments_entry on public.comments (entry_id, created_at);
alter table public.comments enable row level security;
drop policy if exists "read" on public.comments;
drop policy if exists "add own" on public.comments;
drop policy if exists "change own" on public.comments;
drop policy if exists "remove own or as owner" on public.comments;
create policy "read" on public.comments for select to authenticated
  using (entry_role(entry_id) is not null);
create policy "add own" on public.comments for insert to authenticated
  with check (user_id = auth.uid() and entry_role(entry_id) is not null);
create policy "change own" on public.comments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and entry_role(entry_id) is not null);
create policy "remove own or as owner" on public.comments for delete to authenticated
  using (user_id = auth.uid() or entry_role(entry_id) = 'owner');
-- Only the words can be changed; the database notes when.
revoke update on public.comments from authenticated;
grant select, insert, delete on public.comments to authenticated;
grant update (body) on public.comments to authenticated;

create or replace function public.comment_edited() returns trigger
language plpgsql as $$
begin
  if new.body is distinct from old.body then new.edited_at := now(); end if;
  return new;
end $$;
drop trigger if exists comment_edited on public.comments;
create trigger comment_edited before update on public.comments
  for each row execute function public.comment_edited();

-- When a journal is no longer shared with anyone, its comments go too (like reactions).
create or replace function public.clear_comments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from journal_members where journal_id = old.journal_id) then
    delete from comments where entry_id in (select id from entries where journal_id = old.journal_id);
  end if;
  return null;
end $$;
drop trigger if exists clear_comments on public.journal_members;
create trigger clear_comments after delete on public.journal_members
  for each row execute function public.clear_comments();
