# PK Analyzer Rebuilt

A clean rebuild of pkanalyzer.com with real Supabase auth, statement extraction, and category management.

## Quick Start

### 1. Environment Setup

Copy the env template and add your Supabase credentials:

```bash
cp .env.example .env.local
# Edit .env.local with your Supabase project URL and anon key
```

### 2. Supabase Database Setup

1. In Supabase dashboard, go to SQL Editor.
2. Copy and run the SQL in `supabase/schema.sql`.
3. This creates the tables and Row Level Security (RLS) policies for categories and transactions.

### 3. Supabase Auth Config

In Supabase Auth → Configuration:
- **Site URL**: Set to your deployed domain or `http://localhost:5173` for local dev
- **Redirect URLs**: Add your auth callback URLs:
  - Local: `http://localhost:5173/`
  - Production: `https://pkanalyzer.com/`

### 4. Local Dev

```bash
npm install
npm run dev
# Open http://localhost:5173
```

### 5. Testing Auth & Extraction

1. **Sign Up**: Use a test email + password. Verify email if required in Supabase.
2. **Sign In**: Use the same credentials.
3. **Extract Transactions**:
   - Upload a CSV/TSV statement with columns: `Date`, `Description`, `Amount`
   - Analyzer will auto-extract and categorize transactions.
   - Categories are saved to your profile if Supabase is configured.
4. **Manage Categories**:
   - Add custom categories with the form.
   - Re-categorize transactions in the table.
   - Changes persist immediately to Supabase (if configured).
5. **Sign Out**: Use the button in the top nav.

## Production Deployment

### Option A: Vercel

1. Push to GitHub (already done to `kbm39/pk-analyzer.com`).
2. Go to [vercel.com](https://vercel.com), import the GitHub repo.
3. Add environment variables:
   - `VITE_SUPABASE_URL`: Your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase anon key
4. Deploy. Vercel will run `npm run build` automatically.

### Option B: Cloudflare Pages

1. Connect your GitHub repo at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Add environment variables (same as above).
5. Deploy.

### Option C: Self-Hosted

```bash
npm run build
# dist/ folder is your static app ready to serve
```

### Domain & HTTPS

- **Point DNS**: Set `pkanalyzer.com` to your host's nameservers or IP.
- **SSL**: Vercel/Cloudflare auto-issue HTTPS. For self-hosted, use Let's Encrypt.
- **Redirect**: Choose either:
  - `www.pkanalyzer.com` → `pkanalyzer.com` (or vice versa)
  - Update Supabase auth Site URL to match your chosen primary domain.

## Architecture Overview

- **Frontend**: React 19 + Vite + TypeScript, Tailwind-inspired CSS
- **Auth**: Supabase (email/password, passwordless recovery)
- **Database**: Supabase PostgreSQL (users, categories, transactions)
- **Extraction**: Regex-based CSV/text parser, auto-categorization heuristics
- **Deployment**: Vercel, Cloudflare Pages, or any static host

## File Structure

```
src/
  App.tsx                    # Router and auth guards
  App.css                    # Global styles
  pages/
    LoginPage.tsx            # Sign in
    SignupPage.tsx           # Create account
    ForgotPasswordPage.tsx    # Password reset
    DashboardPage.tsx        # Home page
    AnalyzerPage.tsx         # Main tool (extraction + categories)
  lib/
    supabase.ts              # Supabase client
    extractTransactions.ts   # Parser and heuristics
supabase/
  schema.sql                 # Database and RLS setup
```

## Troubleshooting

### "Missing Supabase configuration"
- Check `.env.local` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Reload the app.

### "Tables not ready yet"
- Run the SQL in `supabase/schema.sql` in your Supabase project.
- Refresh the analyzer page.

### "Auth fails on signup/signin"
- Check Supabase auth is enabled (Auth → Providers → Email).
- Verify email/password is correct.
- Check "Site URL" in Supabase Auth Config matches your app URL.

### "Transactions not saving"
- Ensure RLS policies are created (run the SQL).
- Check the user is signed in (check browser console in Network tab).
- Verify `transactions` table exists.

## Next Steps

1. Add a recent transactions export from your bank as a CSV.
2. Test sign up → extract → categorize workflow.
3. Deploy to production.
4. Configure DNS to point to your chosen host.
5. Update Supabase auth redirect URLs for production domain.
6. Monitor errors with [Sentry](https://sentry.io) or similar.

---

For issues, check browser console (F12 → Console/Network) and Supabase logs in your project dashboard.
