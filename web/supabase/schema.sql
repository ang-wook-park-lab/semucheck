-- 세무체크: Supabase SQL Editor에서 한 번 실행하세요.
-- 각 컨설턴트는 자기 데이터(owner = auth.uid())만 읽고 쓸 수 있습니다.

create table if not exists public.clients (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  profile jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.diagnoses (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  domain text not null,
  answers jsonb not null default '{}'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diagnoses_owner_idx on public.diagnoses(owner, updated_at desc);
create index if not exists diagnoses_client_idx on public.diagnoses(client_id);

alter table public.clients enable row level security;
alter table public.diagnoses enable row level security;

drop policy if exists "clients owner all" on public.clients;
create policy "clients owner all" on public.clients
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- 진단은 본인 소유이면서, 연결된 고객사도 본인 소유여야 저장됩니다.
drop policy if exists "diagnoses owner all" on public.diagnoses;
create policy "diagnoses owner all" on public.diagnoses
  for all to authenticated
  using (owner = auth.uid())
  with check (
    owner = auth.uid()
    and exists (select 1 from public.clients c where c.id = client_id and c.owner = auth.uid())
  );
