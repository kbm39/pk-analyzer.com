import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractTransactionsFromFile, suggestCategory } from '../lib/extractTransactions'
import { supabase } from '../lib/supabase'

type Transaction = {
  id: string
  date: string
  description: string
  amount: number
  category: string
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

export default function AnalyzerPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<string[]>(BASE_CATEGORIES)
  const [newCategory, setNewCategory] = useState('')
  const [error, setError] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)

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

      setTransactions(next)
    } catch {
      setError('Could not process this file. Please upload a CSV/TSV or text statement export.')
      setTransactions([])
    } finally {
      setIsExtracting(false)
    }
  }

  const handleAddCategory = (event: React.FormEvent<HTMLFormElement>) => {
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

    setCategories((prev) => [...prev, candidate])
    setNewCategory('')
  }

  const handleCategoryChange = (id: string, category: string) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, category } : tx)))
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
        <p className="muted">Upload a CSV/TSV statement export to extract transactions automatically.</p>

        <div className="upload-row">
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          />
          <button type="button" onClick={handleExtract} disabled={isExtracting}>
            {isExtracting ? 'Extracting...' : 'Extract Transactions'}
          </button>
        </div>

        {selectedFile ? <p className="muted">Selected file: {selectedFile.name}</p> : null}
        {error ? <p className="status error">{error}</p> : null}
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
