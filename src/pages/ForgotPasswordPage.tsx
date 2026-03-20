import { Link } from 'react-router-dom'

export default function ForgotPasswordPage() {
  return (
    <main className="page auth-page">
      <h1>Reset password</h1>
      <p className="muted">Enter your email and we will send reset instructions.</p>

      <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Email
          <input type="email" placeholder="you@example.com" required />
        </label>
        <button type="submit">Send Reset Link</button>
      </form>

      <div className="auth-links">
        <Link to="/">Back to sign in</Link>
      </div>
    </main>
  )
}
