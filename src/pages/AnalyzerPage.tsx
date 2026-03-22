import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractTransactionsFromFile, suggestCategory } from '../lib/extractTransactions'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

type Transaction = {
  id: string
  date: string
  description: string
  amount: number
  category: string
}

type DbCategory = {
  id: string
  name: string
  is_default: boolean
}

type DbTransaction = {
  id: string
  tx_date: string
  description: string
  amount: number
  category_name: string
}

type PayeeRule = {
  id: string
  payee_pattern: string
  category_name: string
}

type DbPayeeRule = {
  id: string
  payee_pattern: string
  category_name: string
}

const BASE_CATEGORIES = [
  'Housing',
  'Utilities',
  'Groceries',
  'Dining',
  'Transport',
  'Healthcare',
  'Insurance',
  'Transfer',
  'Income',
  'Other',
]

function formatAmount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function sortTransactionsDescending(items: Transaction[]): Transaction[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date))
}

function escCsv(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

function mergeCategories(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map((value) => value.toLowerCase()))
  const next = [...current]

  for (const value of incoming) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(trimmed)
  }

  return next
}

export default function AnalyzerPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<string[]>(BASE_CATEGORIES)
  const [payeeRules, setPayeeRules] = useState<PayeeRule[]>([])
  const [payeeSearch, setPayeeSearch] = useState('')
  const [payeeRuleCategory, setPayeeRuleCategory] = useState('')
  const [transactionSearchTerm, setTransactionSearchTerm] = useState('')
  const [transactionSearchMode, setTransactionSearchMode] = useState<'pin' | 'filter'>('pin')
  const [isSavingPayeeRule, setIsSavingPayeeRule] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [isPersistenceReady, setIsPersistenceReady] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const [isLoadingSavedData, setIsLoadingSavedData] = useState(false)
  const [categoryChangeModal, setCategoryChangeModal] = useState<{
    transactionId: string
    payee: string
    oldCategory: string
    newCategory: string
    matchingCount: number
  } | null>(null)
  const [applyingCategoryChange, setApplyingCategoryChange] = useState(false)

  const isMissingPayeeRulesTableError = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    const errorLike = value as { message?: string; code?: string }
    return (
      errorLike.code === '42P01' ||
      (typeof errorLike.message === 'string' &&
        errorLike.message.toLowerCase().includes('relation') &&
        errorLike.message.toLowerCase().includes('payee_rules'))
    )
  }

  useEffect(() => {
    const loadSavedData = async () => {
      if (!isSupabaseConfigured || !supabase) {
        return
      }

      setIsLoadingSavedData(true)

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setIsLoadingSavedData(false)
        return
      }

      setUserId(user.id)

      const { data: existingCategories, error: categoryReadError } = await supabase
        .from('categories')
        .select('id, name, is_default')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      if (categoryReadError) {
        setError('Supabase tables are not ready yet. Run the SQL in supabase/schema.sql to enable persistence.')
        setIsLoadingSavedData(false)
        return
      }

      const categoryRows = (existingCategories as DbCategory[]) ?? []
      const existingNames = new Set(categoryRows.map((item) => item.name.toLowerCase()))
      const missingDefaults = BASE_CATEGORIES.filter((name) => !existingNames.has(name.toLowerCase()))

      if (missingDefaults.length > 0) {
        await supabase.from('categories').insert(
          missingDefaults.map((name) => ({
            user_id: user.id,
            name,
            is_default: true,
          })),
        )
      }

      const { data: mergedCategories } = await supabase
        .from('categories')
        .select('name')
        .eq('user_id', user.id)
        .order('name', { ascending: true })

      const loadedCategories = ((mergedCategories as Array<{ name: string }> | null) ?? []).map(
        (item) => item.name,
      )
      if (loadedCategories.length > 0) {
        setCategories(loadedCategories)
      }

      const { data: txRows, error: txReadError } = await supabase
        .from('transactions')
        .select('id, tx_date, description, amount, category_name')
        .eq('user_id', user.id)
        .order('tx_date', { ascending: false })
        .limit(500)

      if (txReadError) {
        setError('Transactions table is not ready yet. Run the SQL in supabase/schema.sql to enable persistence.')
        setIsLoadingSavedData(false)
        return
      }

      const loadedTransactions = ((txRows as DbTransaction[]) ?? []).map((item) => ({
        id: item.id,
        date: item.tx_date,
        description: item.description,
        amount: item.amount,
        category: item.category_name,
      }))

      setTransactions(loadedTransactions)

      const { data: ruleRows, error: ruleReadError } = await supabase
        .from('payee_rules')
        .select('id, payee_pattern, category_name')
        .eq('user_id', user.id)
        .order('payee_pattern', { ascending: true })

      if (ruleReadError && !isMissingPayeeRulesTableError(ruleReadError)) {
        setError(ruleReadError.message)
      }

      setPayeeRules(((ruleRows as DbPayeeRule[]) ?? []).map((r) => ({
        id: String(r.id),
        payee_pattern: r.payee_pattern,
        category_name: r.category_name,
      })))

      setIsPersistenceReady(true)
      setIsLoadingSavedData(false)
    }

    void loadSavedData()
  }, [])

  const displayedTransactions = useMemo(() => {
    const term = transactionSearchTerm.trim().toLowerCase()
    if (!term) {
      return transactions
    }

    const score = (tx: Transaction): number => {
      const description = tx.description.toLowerCase()
      const category = tx.category.toLowerCase()
      const date = tx.date.toLowerCase()

      if (description === term) return 100
      if (description.startsWith(term)) return 80
      if (description.includes(term)) return 60
      if (category.startsWith(term)) return 40
      if (category.includes(term)) return 30
      if (date.includes(term)) return 20
      return 0
    }

    const withMatchState = transactions.map((tx) => {
      const haystack = `${tx.description} ${tx.category} ${tx.date} ${tx.amount}`.toLowerCase()
      const isMatch = haystack.includes(term)
      return { tx, isMatch, rank: score(tx) }
    })

    if (transactionSearchMode === 'filter') {
      return withMatchState
        .filter((entry) => entry.isMatch)
        .sort((a, b) => {
          const diff = b.rank - a.rank
          if (diff !== 0) return diff
          return b.tx.date.localeCompare(a.tx.date)
        })
        .map((entry) => entry.tx)
    }

    return withMatchState
      .sort((a, b) => {
        if (a.isMatch !== b.isMatch) return a.isMatch ? -1 : 1
        const diff = b.rank - a.rank
        if (diff !== 0) return diff
        return b.tx.date.localeCompare(a.tx.date)
      })
      .map((entry) => entry.tx)
  }, [transactionSearchMode, transactionSearchTerm, transactions])

  const summarySource = useMemo(
    () => (transactionSearchMode === 'filter' ? displayedTransactions : transactions),
    [displayedTransactions, transactionSearchMode, transactions],
  )

  const totalIncome = useMemo(
    () => summarySource.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0),
    [summarySource],
  )

  const totalExpenses = useMemo(
    () => summarySource.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0),
    [summarySource],
  )

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const tx of summarySource) {
      map.set(tx.category, (map.get(tx.category) ?? 0) + tx.amount)
    }
    return [...map.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  }, [summarySource])

  const handleExtract = async () => {
    if (!selectedFile) {
      setError('Choose a statement file first (.csv, .tsv, or text export).')
      return
    }

    setError('')
    setMessage('')
    setIsExtracting(true)

    try {
      const parsed = await extractTransactionsFromFile(selectedFile)
      if (parsed.length === 0) {
        setError('No transactions were found. Try a CSV export with date/description/amount columns.')
        setTransactions([])
        setIsExtracting(false)
        return
      }

      const applyPayeeRule = (description: string): string | null => {
        const lower = description.toLowerCase()
        for (const rule of payeeRules) {
          if (lower.includes(rule.payee_pattern.toLowerCase())) {
            return rule.category_name
          }
        }
        return null
      }

      const next = parsed.map((tx, index) => {
        // Priority: 1) category in file, 2) matched payee rule, 3) heuristic suggestion
        const category =
          (tx.category && tx.category.trim())
            ? tx.category.trim()
            : applyPayeeRule(tx.description) ?? suggestCategory(tx.description, tx.amount)
        return {
          ...tx,
          id: `${tx.date}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          category,
        }
      })

      const importedCategories = Array.from(
        new Set(
          next
            .map((tx) => tx.category.trim())
            .filter(Boolean),
        ),
      )

      const missingImportedCategories = importedCategories.filter(
        (candidate) => !categories.some((existing) => existing.toLowerCase() === candidate.toLowerCase()),
      )

      if (missingImportedCategories.length > 0) {
        setCategories((prev) => mergeCategories(prev, missingImportedCategories))

        if (isPersistenceReady && supabase && userId) {
          const { error: categoryInsertError } = await supabase.from('categories').insert(
            missingImportedCategories.map((name) => ({
              user_id: userId,
              name,
              is_default: false,
            })),
          )

          if (categoryInsertError && categoryInsertError.code !== '23505') {
            setError(categoryInsertError.message)
          }
        }
      }

      if (isPersistenceReady && supabase && userId) {
        const payload = next.map((tx) => ({
          user_id: userId,
          tx_date: tx.date,
          description: tx.description,
          amount: tx.amount,
          category_name: tx.category,
          source_file: selectedFile.name,
        }))

        const { data: insertedRows, error: insertError } = await supabase
          .from('transactions')
          .insert(payload)
          .select('id, tx_date, description, amount, category_name')

        if (insertError) {
          setError(insertError.message)
          setIsExtracting(false)
          return
        }

        const persistedTransactions = ((insertedRows as DbTransaction[]) ?? []).map((item) => ({
          id: item.id,
          date: item.tx_date,
          description: item.description,
          amount: item.amount,
          category: item.category_name,
        }))

        setTransactions((prev) => sortTransactionsDescending([...persistedTransactions, ...prev]))
        setMessage('Transactions extracted and saved to your account.')
      } else {
        setTransactions(sortTransactionsDescending(next))
        setMessage('Transactions extracted in local mode. Configure Supabase tables to persist data.')
      }
    } catch {
      setError('Could not process this file. Please upload a CSV/TSV or text statement export.')
      setTransactions([])
    } finally {
      setIsExtracting(false)
    }
  }

  const handleAddCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const candidate = newCategory.trim()
    if (!candidate) {
      return
    }

    const exists = categories.some((category) => category.toLowerCase() === candidate.toLowerCase())
    if (exists) {
      setNewCategory('')
      return
    }

    if (isPersistenceReady && supabase && userId) {
      const { error: insertError } = await supabase.from('categories').insert({
        user_id: userId,
        name: candidate,
        is_default: false,
      })

      if (insertError) {
        setError(insertError.message)
        return
      }
    }

    setCategories((prev) => [...prev, candidate])
    setMessage(`Category "${candidate}" added.`)
    setNewCategory('')
  }

  
  const handleSavePayeeRule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')

    const pattern = payeeSearch.trim()
    const category = payeeRuleCategory.trim()
    if (!pattern || !category) {
      setError('Enter a payee and select a category before saving.')
      return
    }

    setIsSavingPayeeRule(true)

    const existing = payeeRules.find((r) => r.payee_pattern.toLowerCase() === pattern.toLowerCase())

    try {
      if (isPersistenceReady && supabase && userId) {
        if (existing) {
          const { error: updateError } = await supabase
            .from('payee_rules')
            .update({ category_name: category })
            .eq('id', existing.id)
            .eq('user_id', userId)

          if (updateError && !isMissingPayeeRulesTableError(updateError)) {
            setError(updateError.message)
            return
          }

          setPayeeRules((prev) =>
            prev.map((r) =>
              r.id === existing.id || r.payee_pattern.toLowerCase() === pattern.toLowerCase()
                ? { ...r, category_name: category }
                : r,
            ),
          )
        } else {
          const { data, error: insertError } = await supabase
            .from('payee_rules')
            .insert({ user_id: userId, payee_pattern: pattern, category_name: category })
            .select('id, payee_pattern, category_name')
            .single()

          if (insertError && !isMissingPayeeRulesTableError(insertError)) {
            setError(insertError.message)
            return
          }

          if (data) {
            const row = data as DbPayeeRule
            setPayeeRules((prev) => [
              ...prev,
              { id: String(row.id), payee_pattern: row.payee_pattern, category_name: row.category_name },
            ])
          } else {
            setPayeeRules((prev) => [
              ...prev,
              { id: `local-${Date.now()}`, payee_pattern: pattern, category_name: category },
            ])
            setMessage('Rule saved locally. Run the payee_rules SQL to persist rules in Supabase.')
          }
        }
      } else {
        if (existing) {
          setPayeeRules((prev) =>
            prev.map((r) =>
              r.payee_pattern.toLowerCase() === pattern.toLowerCase() ? { ...r, category_name: category } : r,
            ),
          )
        } else {
          setPayeeRules((prev) => [
            ...prev,
            { id: `local-${Date.now()}`, payee_pattern: pattern, category_name: category },
          ])
        }
      }

      setMessage((prev) => prev || `Rule saved: "${pattern}" -> ${category}`)
      setPayeeSearch('')
      setPayeeRuleCategory('')
    } finally {
      setIsSavingPayeeRule(false)
    }
  }

  const handleDeletePayeeRule = async (rule: PayeeRule) => {
    if (isPersistenceReady && supabase && userId) {
      const { error: deleteError } = await supabase
        .from('payee_rules')
        .delete()
        .eq('id', rule.id)
        .eq('user_id', userId)
      if (deleteError) { setError(deleteError.message); return }
    }
    setPayeeRules((prev) => prev.filter((r) => r.id !== rule.id))
  }

  const handleSignOut = async () => {
    if (!supabase) {
      return
    }
    await supabase.auth.signOut()
  }

  const handleCategoryChange = (transactionId: string, newCategory: string) => {
    const transaction = transactions.find((tx) => tx.id === transactionId)
    if (!transaction) return

    const payee = transaction.description
    const matchingCount = transactions.filter((tx) =>
      tx.description.toLowerCase() === payee.toLowerCase() && tx.category !== newCategory,
    ).length

    setCategoryChangeModal({
      transactionId,
      payee,
      oldCategory: transaction.category,
      newCategory,
      matchingCount,
    })
  }

  const handleConfirmCategoryChange = async (applyToAll: boolean) => {
    if (!categoryChangeModal) return

    setApplyingCategoryChange(true)
    const { transactionId, payee, newCategory } = categoryChangeModal

    try {
      if (applyToAll) {
        // Update all transactions with matching payee
        const matchingIds = transactions
          .filter((tx) => tx.description.toLowerCase() === payee.toLowerCase())
          .map((tx) => tx.id)

        if (isPersistenceReady && supabase && userId) {
          // Update in Supabase
          const { error: updateError } = await supabase
            .from('transactions')
            .update({ category_name: newCategory })
            .in('id', matchingIds)
            .eq('user_id', userId)

          if (updateError) {
            setError(updateError.message)
            setApplyingCategoryChange(false)
            return
          }
        }

        // Update in local state
        setTransactions((prev) =>
          prev.map((tx) =>
            matchingIds.includes(tx.id) ? { ...tx, category: newCategory } : tx,
          ),
        )
        setMessage(`Updated ${matchingIds.length} transaction${matchingIds.length === 1 ? '' : 's'} for "${payee}"`)
      } else {
        // Update only this transaction
        if (isPersistenceReady && supabase && userId) {
          const { error: updateError } = await supabase
            .from('transactions')
            .update({ category_name: newCategory })
            .eq('id', transactionId)
            .eq('user_id', userId)

          if (updateError) {
            setError(updateError.message)
            setApplyingCategoryChange(false)
            return
          }
        }

        // Update in local state
        setTransactions((prev) =>
          prev.map((tx) => (tx.id === transactionId ? { ...tx, category: newCategory } : tx)),
        )
        setMessage('Transaction category updated')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMsg)
    } finally {
      setCategoryChangeModal(null)
      setApplyingCategoryChange(false)
    }
  }

  const handleCancelCategoryChange = () => {
    setCategoryChangeModal(null)
  }

  const handleExportAll = () => {
    if (summarySource.length === 0) return

    const grouped = new Map<string, Transaction[]>()
    for (const [cat] of byCategory) grouped.set(cat, [])
    for (const tx of summarySource) {
      const arr = grouped.get(tx.category) ?? []
      arr.push(tx)
      grouped.set(tx.category, arr)
    }

    const rows: string[] = ['Date,Description,Amount,Category']
    for (const [cat, txs] of grouped) {
      if (txs.length === 0) continue
      const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date))
      for (const tx of sorted) {
        rows.push(`${tx.date},${escCsv(tx.description)},${tx.amount.toFixed(2)},${escCsv(cat)}`)
      }
      const subtotal = txs.reduce((s, t) => s + t.amount, 0)
      rows.push(`SUBTOTAL – ${cat},,${subtotal.toFixed(2)},`)
      rows.push('')
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'transactions-all.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCategory = (category: string) => {
    const txs = summarySource
      .filter((tx) => tx.category === category)
      .sort((a, b) => b.date.localeCompare(a.date))
    if (txs.length === 0) return

    const rows: string[] = ['Date,Description,Amount,Category']
    for (const tx of txs) {
      rows.push(`${tx.date},${escCsv(tx.description)},${tx.amount.toFixed(2)},${escCsv(category)}`)
    }
    const total = txs.reduce((s, t) => s + t.amount, 0)
    rows.push(`TOTAL – ${category},,${total.toFixed(2)},`)

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleEraseAllTransactions = async () => {
    if (transactions.length === 0) return

    const confirmed = window.confirm('Erase all transactions? This cannot be undone.')
    if (!confirmed) return

    setError('')
    setMessage('')

    if (isPersistenceReady && supabase && userId) {
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .eq('user_id', userId)

      if (deleteError) {
        setError(deleteError.message)
        return
      }
    }

    setTransactions([])
    setTransactionSearchTerm('')
    setMessage('All transactions erased.')
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Analyzer</h1>
        <nav className="page-nav">
          <Link to="/dashboard">Back to Dashboard</Link>
          <button type="button" className="secondary" onClick={handleSignOut}>
            Sign Out
          </button>
        </nav>
      </header>

      <section className="card">
        <h2>Statement Upload</h2>
        <p className="muted">Upload a CSV, TSV, Excel (.xlsx), or PDF statement to extract transactions automatically.</p>
        {isLoadingSavedData ? <p className="muted">Loading your saved data...</p> : null}
        {!isLoadingSavedData && isPersistenceReady ? (
          <p className="muted">Persistence is active. Extracted transactions are saved to Supabase.</p>
        ) : null}
        {!isLoadingSavedData && !isPersistenceReady ? (
          <p className="muted">Persistence is not active yet. Data will remain local until Supabase tables are created.</p>
        ) : null}

        <div className="upload-row">
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
          <button type="button" onClick={handleExtract} disabled={isExtracting}>
            {isExtracting ? 'Extracting...' : 'Extract Transactions'}
          </button>
        </div>

        {selectedFile ? <p className="muted">Selected file: {selectedFile.name}</p> : null}
        {error ? <p className="status error">{error}</p> : null}
        {message ? <p className="status success">{message}</p> : null}
      </section>

      <section className="card">
        <h2>Categories</h2>
        <p className="muted">Use defaults below or add your own category labels.</p>

        <form className="inline-form" onSubmit={handleAddCategory}>
          <input
            type="text"
            placeholder="Add custom category"
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
          />
          <button type="submit">Add Category</button>
        </form>

        <div className="pill-list">
          {categories.map((category) => (
            <span key={category} className="pill">
              {category}
            </span>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Payee Rules</h2>
        <p className="muted">Assign a category to a payee name. All future uploads matching that payee will use this category automatically.</p>

        <form className="inline-form" onSubmit={handleSavePayeeRule}>
          <input
            type="text"
            placeholder="Payee name (e.g. Amazon, Starbucks)"
            value={payeeSearch}
            onChange={(e) => setPayeeSearch(e.target.value)}
            list="payee-suggestions"
          />
          <datalist id="payee-suggestions">
            {[...new Set(transactions.map((tx) => tx.description))].map((desc) => (
              <option key={desc} value={desc} />
            ))}
          </datalist>
          <select
            value={payeeRuleCategory}
            onChange={(e) => setPayeeRuleCategory(e.target.value)}
          >
            <option value="">Select category...</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <button type="submit" disabled={isSavingPayeeRule || !payeeSearch.trim() || !payeeRuleCategory}>
            {isSavingPayeeRule ? 'Saving...' : 'Save Rule'}
          </button>
        </form>

        {error ? <p className="status error">{error}</p> : null}
        {message ? <p className="status success">{message}</p> : null}

        {payeeRules.length > 0 ? (
          <table className="payee-rules-table">
            <thead>
              <tr>
                <th>Payee Pattern</th>
                <th>Category</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payeeRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.payee_pattern}</td>
                  <td>{rule.category_name}</td>
                  <td>
                    <button
                      type="button"
                      className="danger-small"
                      onClick={() => handleDeletePayeeRule(rule)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No payee rules yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Transaction Results</h2>
        <p className="muted">
          {displayedTransactions.length > 0
            ? `${displayedTransactions.length} transaction${displayedTransactions.length === 1 ? '' : 's'} shown.`
            : 'No extracted transactions yet.'}
        </p>

        <div className="inline-form">
          <input
            type="text"
            placeholder="Search transactions (payee, category, date, amount)"
            value={transactionSearchTerm}
            onChange={(event) => setTransactionSearchTerm(event.target.value)}
          />
          <select
            value={transactionSearchMode}
            onChange={(event) => setTransactionSearchMode(event.target.value as 'pin' | 'filter')}
            aria-label="Search mode"
          >
            <option value="pin">Pin matches to top</option>
            <option value="filter">Show matches only</option>
          </select>
          <button type="button" className="secondary" onClick={() => setTransactionSearchTerm('')}>
            Clear
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleExportAll}
            disabled={summarySource.length === 0}
          >
            Export All
          </button>
          <button
            type="button"
            className="danger"
            onClick={handleEraseAllTransactions}
            disabled={transactions.length === 0}
          >
            Erase All
          </button>
        </div>

        {displayedTransactions.length > 0 ? (
          <>
            <div className="stats-grid">
              <div className="stat-box">
                <span className="label">Income</span>
                <strong>{formatAmount(totalIncome)}</strong>
              </div>
              <div className="stat-box">
                <span className="label">Expenses</span>
                <strong>{formatAmount(totalExpenses)}</strong>
              </div>
              <div className="stat-box">
                <span className="label">Net</span>
                <strong>{formatAmount(totalIncome + totalExpenses)}</strong>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>{tx.date}</td>
                      <td>{tx.description}</td>
                      <td className={tx.amount < 0 ? 'negative' : 'positive'}>{formatAmount(tx.amount)}</td>
                      <td>
                        <select
                          value={tx.category}
                          onChange={(event) => handleCategoryChange(tx.id, event.target.value)}
                        >
                          {categories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="category-summary">
              <h3>Category Totals</h3>
              <ul>
                {byCategory.map(([category, amount]) => (
                  <li key={category}>
                    <span>{category}</span>
                    <div className="category-row-actions">
                      <strong>{formatAmount(amount)}</strong>
                      <button
                        type="button"
                        className="export-small"
                        onClick={() => handleExportCategory(category)}
                      >
                        Export
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </section>

      {categoryChangeModal && (
        <div className="modal-overlay" onClick={handleCancelCategoryChange}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Change Category</h3>
            <p>
              Change category for "<strong>{categoryChangeModal.payee}</strong>" from{' '}
              <strong>{categoryChangeModal.oldCategory}</strong> to{' '}
              <strong>{categoryChangeModal.newCategory}</strong>?
            </p>
            {categoryChangeModal.matchingCount > 1 && (
              <p className="muted">
                There {categoryChangeModal.matchingCount === 1 ? 'is' : 'are'}{' '}
                <strong>{categoryChangeModal.matchingCount}</strong> transaction
                {categoryChangeModal.matchingCount === 1 ? '' : 's'} with this payee.
              </p>
            )}
            <div className="modal-buttons">
              <button
                type="button"
                className="secondary"
                onClick={handleCancelCategoryChange}
                disabled={applyingCategoryChange}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmCategoryChange(false)}
                disabled={applyingCategoryChange}
              >
                {applyingCategoryChange ? 'Updating...' : 'Change This Only'}
              </button>
              {categoryChangeModal.matchingCount > 1 && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => handleConfirmCategoryChange(true)}
                  disabled={applyingCategoryChange}
                >
                  {applyingCategoryChange ? 'Updating...' : `Change All ${categoryChangeModal.matchingCount}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
