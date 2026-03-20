import { Link } from 'react-router-dom'

export default function SignupPage() {
  return (
    <main className="page auth-page">
      <h1>Create account</h1>
      <p className="muted">Set up your Statement Analyzer account.</p>

      <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Email
          <input type="email" placeholder="you@example.com" required />
        </label>
        <label>
          Password
          <input type="password" placeholder="Create password" required />
        </label>
        <button type="submit">Create Account</button>
      </form>

      <div className="auth-links">
        <Link to="/">Back to sign in</Link>
      </div>
    </main>
  )
}
