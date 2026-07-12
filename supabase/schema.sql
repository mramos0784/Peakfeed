-- PeakFeed MVP schema
-- Run this whole file once in the Supabase SQL editor (Project > SQL Editor > New query).

create extension if not exists "pgcrypto";

-- One row per signed-up user, extends Supabase's built-in auth.users
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  city text default 'Tampa',
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- What kind of thing an entry is
create type entry_type as enum ('song', 'restaurant', 'venue', 'movie', 'event', 'issue', 'custom');

-- A canonical item that can live on one or more lists.
-- external_id holds whatever real identifier we could extract (Spotify track id,
-- Google place id/cid, etc). It's nullable: not every source hands us a clean id,
-- and that's fine, but we prefer it over free-text matching whenever we have it.
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  type entry_type not null,
  title text not null,
  subtitle text,
  image_url text,
  source_url text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Dedup on the real identifier when we have one. Partial index so entries
-- without an external_id (the AI-parsed, no-clean-id cases) don't collide.
create unique index if not exists entries_type_external_id_key
  on entries (type, external_id)
  where external_id is not null;

-- The five system lists (plus room for personal/group lists later)
create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  type entry_type not null,
  list_kind text not null default 'system', -- system | personal | group
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

insert into lists (slug, name, type) values
  ('songs', 'Songs', 'song'),
  ('restaurants', 'Restaurants', 'restaurant'),
  ('venues', 'Venues', 'venue'),
  ('movies', 'Movies', 'movie'),
  ('events', 'Events', 'event')
on conflict (slug) do nothing;

-- An entry's membership in a list (the shared queue before/while it's ranked)
create table if not exists list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  added_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (list_id, entry_id)
);

-- One user's ranked position for one item, for one voting week.
-- week_of is the Monday that starts the voting week this vote counts toward.
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  list_item_id uuid not null references list_items(id) on delete cascade,
  rank int not null check (rank > 0),
  week_of date not null,
  created_at timestamptz not null default now(),
  unique (list_id, user_id, list_item_id, week_of),
  unique (list_id, user_id, rank, week_of)
);

-- Row Level Security. Everything is readable by any signed-in user (it's a
-- public leaderboard). Writes are restricted to acting as yourself.
alter table profiles enable row level security;
alter table entries enable row level security;
alter table lists enable row level security;
alter table list_items enable row level security;
alter table votes enable row level security;

drop policy if exists "profiles are publicly readable" on profiles;
create policy "profiles are publicly readable" on profiles for select using (true);
drop policy if exists "users update own profile" on profiles;
create policy "users update own profile" on profiles for update using (auth.uid() = id);

drop policy if exists "lists are publicly readable" on lists;
create policy "lists are publicly readable" on lists for select using (true);

drop policy if exists "entries are publicly readable" on entries;
create policy "entries are publicly readable" on entries for select using (true);
drop policy if exists "signed-in users can add entries" on entries;
create policy "signed-in users can add entries" on entries for insert with check (auth.uid() = created_by);

drop policy if exists "list_items are publicly readable" on list_items;
create policy "list_items are publicly readable" on list_items for select using (true);
drop policy if exists "signed-in users can add list_items" on list_items;
create policy "signed-in users can add list_items" on list_items for insert with check (auth.uid() = added_by);

drop policy if exists "votes are publicly readable" on votes;
create policy "votes are publicly readable" on votes for select using (true);
drop policy if exists "users manage own votes" on votes;
create policy "users manage own votes" on votes for insert with check (auth.uid() = user_id);
drop policy if exists "users update own votes" on votes;
create policy "users update own votes" on votes for update using (auth.uid() = user_id);
drop policy if exists "users delete own votes" on votes;
create policy "users delete own votes" on votes for delete using (auth.uid() = user_id);
