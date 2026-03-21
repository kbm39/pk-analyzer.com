-- Create categories table
create table public.categories (
  id bigint primary key generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_default boolean default false,
  created_at timestamp with time zone default now(),
  unique(user_id, name)
);

-- Create transactions table
create table public.transactions (
  id bigint primary key generated always as identity,
  user_id uuid not null references auth.users(id) on delete cascade,
  tx_date text not null,
  description text not null,
  amount decimal(12, 2) not null,
  category_name text not null,
  source_file text,
  created_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

-- Create policies for categories
create policy "Users can see their own categories"
  on public.categories for select
  using (auth.uid() = user_id);

create policy "Users can insert their own categories"
  on public.categories for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own categories"
  on public.categories for delete
  using (auth.uid() = user_id);

-- Create policies for transactions
create policy "Users can see their own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own transactions"
  on public.transactions for update
  using (auth.uid() = user_id);

create policy "Users can delete their own transactions"
  on public.transactions for delete
  using (auth.uid() = user_id);

-- Create indexes for performance
create index idx_categories_user_id on public.categories(user_id);
create index idx_transactions_user_id on public.transactions(user_id);
create index idx_transactions_date on public.transactions(tx_date desc);
