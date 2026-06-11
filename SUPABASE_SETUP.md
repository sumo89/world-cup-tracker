# Supabase Setup Guide

This app syncs user predictions to a Supabase database. Follow these steps to connect your database.

## 1. Supabase Tables

Create two tables in your Supabase project:

### `users` table
```sql
create table users (
  id uuid default gen_random_uuid() primary key,
  name text unique not null,
  created_at timestamp with time zone default now()
);
```

### `predictions` table
```sql
create table predictions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  fixture_id integer not null,
  choice text not null check (choice in ('home', 'draw', 'away')),
  created_at timestamp with time zone default now(),
  unique(user_id, fixture_id)
);
```

## 2. Get Your Keys

1. Go to your Supabase project settings
2. Navigate to the API section
3. Copy:
   - Project URL → `VITE_SUPABASE_URL`
   - Anon Public Key → `VITE_SUPABASE_ANON_KEY`

## 3. Local Development

Create a `.env.local` file in the project root:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

## 4. GitHub Pages Deployment

Add these secrets to your GitHub repo:
- `VITE_SUPABASE_URL`: Your Supabase URL
- `VITE_SUPABASE_ANON_KEY`: Your anon key

The GitHub Actions deploy workflow will use these during the build.

## 5. Security Notes

- The anon key is safe to expose (it's public by default in Supabase)
- Row Level Security (RLS) can be added to the tables for multi-tenant isolation
- For production, consider enabling RLS and creating policies per user
