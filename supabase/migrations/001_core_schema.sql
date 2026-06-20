-- Enable pgvector
create extension if not exists vector;

-- user_profiles: extends Supabase's built-in auth.users
create table user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

-- collections: a folder of documents owned by one user
create table collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

-- documents: uploaded PDFs
create table documents (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  status text not null default 'pending',
  created_at timestamptz default now()
);

-- document_chunks: embedded text pieces for retrieval
create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  embedding vector(384),
  chunk_index int not null,
  created_at timestamptz default now()
);

create index document_chunks_embedding_idx
  on document_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- research_sessions: one row per question asked
create table research_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid not null references collections(id) on delete cascade,
  query text not null,
  report text,
  created_at timestamptz default now()
);

-- Lock every table down by default
alter table user_profiles enable row level security;
alter table collections enable row level security;
alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table research_sessions enable row level security;

-- Each user only sees their own rows
create policy "own profile" on user_profiles using (id = auth.uid());
create policy "own collections" on collections using (user_id = auth.uid());
create policy "own documents" on documents using (user_id = auth.uid());
create policy "own chunks" on document_chunks using (user_id = auth.uid());
create policy "own sessions" on research_sessions using (user_id = auth.uid());
