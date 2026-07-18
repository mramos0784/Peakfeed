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

-- What kind of thing an entry is. Wrapped for idempotency the same way
-- resolution_provenance is below - CREATE TYPE has no native IF NOT
-- EXISTS, so re-running this file from scratch (as opposed to running only
-- the newer statements below it) errored here on a database that already
-- had this type, before ever reaching any later, genuinely-new statements.
do $$ begin
  create type entry_type as enum ('song', 'restaurant', 'venue', 'movie', 'event', 'issue', 'custom');
exception when duplicate_object then null;
end $$;

-- Four platform-specific Creator types, added for the four new Creator
-- system lists below - one system list per platform per
-- api-integrations-addendum.md section 2 (not a single combined "Creator"
-- category), so each platform needs its own type: the (type, external_id)
-- dedup index and the Add-to-Lists destination matching both key off type,
-- and the same handle text can legitimately exist as a different person on
-- a different platform.
alter type entry_type add value if not exists 'x_creator';
alter type entry_type add value if not exists 'tiktok_creator';
alter type entry_type add value if not exists 'instagram_creator';
alter type entry_type add value if not exists 'youtube_creator';

-- Postgres requires a value added via ALTER TYPE ... ADD VALUE to be
-- committed before it can be used elsewhere (error 55P04, "unsafe use of
-- new value") - and the Supabase SQL editor runs a pasted script as one
-- implicit transaction, so the Creator-list insert further down would try
-- to use 'x_creator' etc. before they're actually committed. This doesn't
-- apply to entry_type's original seven values (song/restaurant/.../custom)
-- or to resolution_provenance's values below - both come from a single
-- CREATE TYPE statement, which has no such restriction, only values added
-- later via ALTER TYPE ADD VALUE do. Harmless if the editor's actual
-- behavior turns out to autocommit per statement anyway: COMMIT outside an
-- open transaction is just a no-op warning in Postgres, not an error.
commit;

-- How an entry's title/subtitle/external_id were actually resolved, so
-- later features (the "Search more" web-search fallback, Wikidata
-- enrichment, real category-API integrations as they get built) can tell a
-- verified match apart from a broader guess instead of treating every
-- resolved entry as equally trustworthy. See
-- api-integrations-addendum.md section 5. Six tiers, not the three named
-- there, because this maps onto what the resolution pipeline actually
-- produces today (url_id, ai_guess, web_search all exist in
-- src/lib/parseLink.ts already) plus the future tiers that document asks
-- for (direct_api, wikidata_match) plus a manual baseline - not three
-- different real mechanisms artificially conflated into one bucket each.
-- Confidence is implied by the tier itself rather than stored as a
-- separate column: a web_search-resolved entry is lower confidence than a
-- direct_api match by definition, so a second column could only ever
-- disagree with this one, never add real information.
do $$ begin
  create type resolution_provenance as enum (
    'direct_api',     -- a real catalog API confirmed this (Spotify Web
                       -- API, Google Places, etc.) - none exist yet,
                       -- reserved for when they're built for real
    'url_id',          -- a canonical id was already sitting in the shared
                       -- URL/page itself - today's actual Spotify page
                       -- scrape / Google Maps place_id mechanism, no API
                       -- call and no guess, just extraction
    'wikidata_match',  -- exact Wikidata property match (handle-property
                       -- for creators, entity match for issues) - not
                       -- built yet
    'web_search',      -- Claude's web_search tool - broader and lower
                       -- confidence by definition, built for Events
    'ai_guess',        -- Claude reading already-fetched page content, no
                       -- search - today's generic link fallback
    'manual'           -- user typed or edited it with no automated
                       -- resolution at all
  );
exception when duplicate_object then null;
end $$;

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
  provenance resolution_provenance,
  -- Operational, non-descriptive data (Events' date/sources today).
  metadata jsonb not null default '{}'::jsonb,
  -- Descriptive attributes (genre, nationality, release year, etc.) -
  -- kept separate from metadata on purpose: metadata is "how this entry's
  -- resolution behaves," attributes is "what this thing actually is."
  -- Empty by default since nothing populates it yet - the async Wikidata
  -- enrichment job (api-integrations-addendum.md section 1) is a
  -- separate, unbuilt feature.
  attributes jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Adds provenance/attributes to an `entries` table that already exists
-- from an earlier run of this file - `create table if not exists` doesn't
-- add columns to a table that's already there.
alter table entries add column if not exists provenance resolution_provenance;
alter table entries add column if not exists attributes jsonb not null default '{}'::jsonb;

-- Dedup on the real identifier when we have one. Partial index so entries
-- without an external_id (the AI-parsed, no-clean-id cases) don't collide.
create unique index if not exists entries_type_external_id_key
  on entries (type, external_id)
  where external_id is not null;

-- The ten system lists: Songs/Restaurants/Venues/Movies/Events/Issues plus
-- four Creator lists (plus room for personal/group lists later)
create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  type entry_type not null,
  list_kind text not null default 'system', -- system | personal | group
  category text, -- music, food, film, etc. Matches a share to eligible group
                  -- lists once those exist (see share-ingestion-addendum.md).
                  -- Unused today: system lists don't need it, and there are
                  -- no group lists yet to match against. Added now so the
                  -- migration isn't a second surprise later.
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Adds the category column to a `lists` table that already exists from an
-- earlier run of this file — `create table if not exists` doesn't add
-- columns to a table that's already there.
alter table lists add column if not exists category text;

insert into lists (slug, name, type) values
  ('songs', 'Songs', 'song'),
  ('restaurants', 'Restaurants', 'restaurant'),
  ('venues', 'Venues', 'venue'),
  ('movies', 'Movies', 'movie'),
  ('events', 'Events', 'event'),
  ('issues', 'Issues', 'issue')
on conflict (slug) do nothing;

-- Four platform-specific Creator lists (api-integrations-addendum.md
-- section 2) - resolves that doc's own flagged open decision: this
-- expands launch scope beyond lists-architecture.md's original five-list
-- recommendation (Songs/Restaurants/Venues/Events/Issues + one combined
-- Creator category), on purpose, per the founder's explicit instruction.
-- Default shown attributes (Name, @Handle) and the identifier pattern
-- (platform handle + platform tag) aren't a schema concern - the platform
-- tag is the entry's own `type`, and handle/display-name live in the
-- existing title/subtitle columns like every other entry.
insert into lists (slug, name, type) values
  ('x-creator', 'X Creator', 'x_creator'),
  ('tiktok-creator', 'TikTok Creator', 'tiktok_creator'),
  ('instagram-creator', 'Instagram Creator', 'instagram_creator'),
  ('youtube-creator', 'YouTube Creator', 'youtube_creator')
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
