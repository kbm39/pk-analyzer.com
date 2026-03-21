# QA Test Plan & Checklist for PK Analyzer

## Pre-Test Setup

### 1. Supabase Configuration
- [ ] Create a Supabase project (free tier is fine)
- [ ] Note your Project URL and Anon Key from Settings → API
- [ ] Run SQL from `supabase/schema.sql` in SQL Editor
- [ ] Verify both `categories` and `transactions` tables exist
- [ ] Verify Row Level Security (RLS) is enabled on both tables
- [ ] Set Site URL to `http://localhost:5173` in Auth → Configuration
- [ ] Add `http://localhost:5173/` to Redirect URLs

### 2. Local Environment
- [ ] Create `.env.local` with:
  ```
  VITE_SUPABASE_URL=your_project_url
  VITE_SUPABASE_ANON_KEY=your_anon_key
  ```
- [ ] Run `npm install && npm run dev`
- [ ] Verify app loads at `http://localhost:5173`

---

## Test 1: Sign Up & Auth

**Goal**: Verify user registration and email verification flow

- [ ] Navigate to `/signup`
- [ ] Enter email: `test@example.com`
- [ ] Enter password: `TestPassword123`
- [ ] Click "Create Account"
- [ ] Expect: "Account created" message
- [ ] In Supabase Auth Users, verify `test@example.com` is listed
- [ ] If email verification is enabled, check provider settings and confirm flow
- [ ] Navigate to `/` and try sign in with the new account
- [ ] Expect: Redirected to `/dashboard` after successful sign in

---

## Test 2: Password Reset Flow

**Goal**: Verify forgot-password works

- [ ] Navigate to `/forgot-password`
- [ ] Enter email: `test@example.com`
- [ ] Click "Send Reset Link"
- [ ] Expect: "If an account exists for that email, a reset link was sent"
- [ ] Check Supabase logs or email (if provider is configured)
- [ ] If reset link received, verify it works

---

## Test 3: Sign Out

**Goal**: Verify session termination

- [ ] Sign in with `test@example.com`
- [ ] On Dashboard or Analyzer, click "Sign Out"
- [ ] Expect: Redirected to `/` (login page)
- [ ] Refresh page and verify redirect persists

---

## Test 4: Extract Transactions (CSV)

**Goal**: Verify transaction parsing and categorization 

Use the sample CSV below or download one from your bank:

```csv
Date,Description,Amount
2024-03-01,Whole Foods Market,125.43
2024-03-02,Starbucks Coffee,-5.62
2024-03-03,Salary Deposit,4500.00
2024-03-04,Electric Bill,-128.76
2024-03-05,Uber Ride,-22.50
2024-03-06,CVS Pharmacy,-45.99
```

- [ ] Save as `bank_statement.csv`
- [ ] Sign in as `test@example.com`
- [ ] Navigate to Analyzer
- [ ] Expect: "Loading your saved data..." briefly shown
- [ ] Expect: "Persistence is active. Extracted transactions are saved to Supabase."
- [ ] Upload `bank_statement.csv`
- [ ] Click "Extract Transactions"
- [ ] Expect: 6 transactions appear in the table
- [ ] Verify **categorization is correct**:
  - Whole Foods → Groceries
  - Starbucks → Dining
  - Salary Deposit → Income
  - Electric Bill → Utilities
  - Uber → Transport
  - CVS Pharmacy → Healthcare
- [ ] Verify **totals**:
  - Income: $4,500.00
  - Expenses: -$228.31
  - Net: $4,271.69
- [ ] Verify **Category Totals** section shows all categories with amounts
- [ ] Message: "Transactions extracted and saved to your account."

---

## Test 5: Category Management

**Goal**: Verify custom category creation and re-categorization

- [ ] In Analyzer, add a custom category: `Transportation`
- [ ] Expect: Category appears in pill list below
- [ ] Expect: Message "Category 'Transportation' added."
- [ ] In the transaction table, change the Uber transaction from `Transport` → `Transportation`
- [ ] Expect: Cell updates immediately
- [ ] Refresh the page
- [ ] Expect: All transactions still show + correct categories (persisted from Supabase)
- [ ] Verify Category Totals updates to show `Transportation` instead of `Transport`

---

## Test 6: Multiple Uploads

**Goal**: Verify cumulative uploads work correctly

Create a second CSV:

```csv
Date,Description,Amount
2024-03-07,Rent Payment,-1500.00
2024-03-08,ExxonMobil Gas,-55.32
```

- [ ] Upload second CSV
- [ ] Expect: 2 more transactions added to the table
- [ ] Expect: Total transaction count is now 8
- [ ] Verify income/expense/net totals are updated
- [ ] Refresh page
- [ ] Expect: All 8 transactions persist

---

## Test 7: Data Isolation (RLS)

**Goal**: Verify users can only see their own data

In **Incognito Window**:
- [ ] Sign up as `test2@example.com` / `TestPassword123`
- [ ] Navigate to Analyzer
- [ ] Expect: "Loading your saved data..." then empty transaction list
- [ ] Upload the sample CSV (from Test 4)
- [ ] Expect: test2 sees 6 transactions
- [ ] Switch back to original window (test@example.com)
- [ ] Expect: Still showing 8 transactions (test2's data is isolated)

---

## Test 8: TSV & Text Format

**Goal**: Verify parser handles multiple formats

Create a TSV file (tab-separated):

```
Date	Description	Amount
2024-03-10	Amazon Purchase	-89.99
2024-03-11	Interest Income	2.15
```

- [ ] Save as `statement.tsv`
- [ ] Upload and extract
- [ ] Expect: 2 transactions parsed correctly
- [ ] Categories assigned: Other (Amazon), Income (Interest)

Create a text export:

```
03/15/2024 Target Store -$65.43
03/16/2024 Paycheck $3000.00
```

- [ ] Save as `statement.txt`
- [ ] Upload and extract
- [ ] Expect: 2 transactions parsed correctly

---

## Test 9: Mobile Responsiveness

**Goal**: Verify UI works on small screens

- [ ] Open DevTools (F12)
- [ ] Set viewport to iPhone 12 (390 x 844)
- [ ] Navigate through all pages (Login, Signup, Analyzer, Dashboard)
- [ ] Verify:
  - [ ] Text is readable
  - [ ] Buttons are clickable (not overlapping)
  - [ ] File input works
  - [ ] Table has horizontal scroll if needed
  - [ ] Input fields are appropriately sized

---

## Test 10: Error Handling

**Goal**: Verify graceful error messages

### Empty file
- [ ] Upload a blank CSV
- [ ] Expect: "No transactions were found..."

### Invalid format
- [ ] Upload a JPEG image
- [ ] Expect: "Could not process this file..."

### Duplicate custom category
- [ ] Try to add a category that already exists
- [ ] Expect: Silently dismissed (no error, category not duplicated)

### Missing Supabase env vars
- [ ] Temporarily comment out env vars in `.env.local`
- [ ] Reload app
- [ ] Expect: Error message on Login page mentioning config
- [ ] Restore env vars

---

## Test 11: Console & Network Audit

**Goal**: Identify hidden errors

- [ ] Open DevTools → Console
- [ ] Perform all tests above
- [ ] Expect: No red errors (warnings are OK)
- [ ] Open Network tab
- [ ] Upload a statement and extract
- [ ] Expect: All requests return 200/201 status
- [ ] Check for 4xx/5xx errors

---

## Test 12: Persistence Across Sessions

**Goal**: Verify data survives browser close

- [ ] Sign in, upload transactions
- [ ] Close browser completely
- [ ] Reopen and navigate to app
- [ ] Sign in again
- [ ] Navigate to Analyzer
- [ ] Expect: All previous transactions and categories still present

---

## Test 13: Performance

**Goal**: Verify reasonably fast extraction

- [ ] Create a large CSV (500 rows)
- [ ] Upload and extract
- [ ] Measure time from click to table render
- [ ] Expect: < 2 seconds for 500 rows

---

## Test 14: Sign Out & Redirect Guards

**Goal**: Verify auth guards work

- [ ] Sign in
- [ ] Sign out
- [ ] Try to navigate directly to `/analyzer` (browser address bar)
- [ ] Expect: Redirected to `/`
- [ ] Try to navigate to `/dashboard`
- [ ] Expect: Redirected to `/`

---

## Summary

| Test # | Name | Status | Notes |
|--------|------|--------|-------|
| 1 | Sign Up & Auth | ✓/✗ | |
| 2 | Password Reset | ✓/✗ | |
| 3 | Sign Out | ✓/✗ | |
| 4 | Extract CSV | ✓/✗ | |
| 5 | Categories | ✓/✗ | |
| 6 | Multiple Uploads | ✓/✗ | |
| 7 | Data Isolation | ✓/✗ | |
| 8 | TSV & Text | ✓/✗ | |
| 9 | Mobile | ✓/✗ | |
| 10 | Error Handling | ✓/✗ | |
| 11 | Console/Network | ✓/✗ | |
| 12 | Persistence | ✓/✗ | |
| 13 | Performance | ✓/✗ | |
| 14 | Guards & Redirect | ✓/✗ | |

---

## Production Checklist (Before Going Live)

- [ ] All 14 tests pass
- [ ] No console errors (warnings OK)
- [ ] No network 4xx/5xx errors
- [ ] Tested on Chrome, Firefox, Safari
- [ ] Tested on mobile (iOS Safari, Android Chrome)
- [ ] API keys are in environment (not hardcoded)
- [ ] `.env.local` is in `.gitignore`
- [ ] Database backup exists
- [ ] Error tracking (Sentry) configured (optional)
- [ ] Analytics configured (optional)
- [ ] SEO meta tags updated
- [ ] Domain DNS and SSL cert ready
- [ ] Supabase auth redirect URLs updated for production domain
