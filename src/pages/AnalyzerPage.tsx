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

export default function AnalyzerPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<string[]>(BASE_CATEGORIES)
  const [userId, setUserId] = useState<string | null>(null)
  const [isPersistenceReady, setIsPersistenceReady] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const [isLoadingSavedData, setIsLoadingSavedData] = useState(false)

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
      setIsPersistenceReady(true)
      setIsLoadingSavedData(false)
    }

    void loadSavedData()
  }, [])

  const totalIncome = useMemo(
    () => transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0),
    [transactions],
  )

  const totalExpenses = useMemo(
    () => transactions.filter((tx) => tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0),
    [transactions],
  )

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const tx of transactions) {
      map.set(tx.category, (map.get(tx.category) ?? 0) + tx.amount)
    }
    return [...map.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  }, [transactions])

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

      const next = parsed.map((tx, index) => ({
        ...tx,
        id: `${tx.date}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        category: suggestCategory(tx.description, tx.amount),
      }))

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

  const handleCategoryChange = async (id: string, category: string) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, category } : tx)))

    if (isPersistenceReady && supabase && userId) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ category_name: category })
        .eq('id', id)
        .eq('user_id', userId)

      if (updateError) {
        setError(updateError.message)
      }
    }
  }

  const handleSignOut = async () => {
    if (!supabase) {
      return
    }
    await supabase.auth.signOut()
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
        <h2>Transaction Results</h2>
        <p className="muted">
          {transactions.length > 0
            ? `${transactions.length} transactions extracted.`
            : 'No extracted transactions yet.'}
        </p>

        {transactions.length > 0 ? (
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
                  {transactions.map((tx) => (
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
                    <strong>{formatAmount(amount)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </section>
    </main>
  )
}
