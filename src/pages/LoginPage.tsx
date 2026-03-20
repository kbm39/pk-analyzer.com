import { Link } from 'react-router-dom'

export default function LoginPage() {
  return (
    <main className="page auth-page">
      <h1>Statement Analyzer</h1>
      <p className="muted">Sign in to continue.</p>

      <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Email
          <input type="email" placeholder="you@example.com" required />
        </label>
        <label>
          Password
          <input type="password" placeholder="Password" required />
        </label>
        <button type="submit">Sign In</button>
      </form>

      <div className="auth-links">
        <Link to="/forgot-password">Forgot password?</Link>
        <span>·</span>
        <Link to="/signup">Sign up</Link>
      </div>
    </main>
  )
}
