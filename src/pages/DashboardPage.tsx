import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function DashboardPage() {
  const handleSignOut = async () => {
    if (!supabase) {
      return
    }

    await supabase.auth.signOut()
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <nav className="page-nav">
          <Link to="/analyzer">Go to Analyzer</Link>
          <button type="button" className="secondary" onClick={handleSignOut}>
            Sign Out
          </button>
        </nav>
      </header>
      <section className="card">
        <h2>Overview</h2>
        <p className="muted">
          Upload statements in the Analyzer, extract transactions, and refine category mappings.
        </p>
      </section>
    </main>
  )
}
