import { Link } from 'react-router-dom'

export default function DashboardPage() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <nav>
          <Link to="/analyzer">Go to Analyzer</Link>
        </nav>
      </header>
      <section className="card">
        <h2>Overview</h2>
        <p className="muted">This is the standalone rebuild project foundation.</p>
      </section>
    </main>
  )
}
