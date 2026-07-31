import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [games, setGames] = useState([])
  const [mode, setMode] = useState('login')
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void loadUser()
  }, [])

  async function loadUser() {
    try {
      const response = await fetch('/api/me', { credentials: 'include' })
      if (!response.ok) {
        setUser(null)
        setGames([])
        return
      }

      const profile = await response.json()
      setUser(profile)
      if (profile) {
        await loadGames()
      }
    } catch {
      setError('Unable to reach the server.')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadGames() {
    try {
      const response = await fetch('/api/games', { credentials: 'include' })
      if (!response.ok) {
        throw new Error('Unable to load games')
      }
      const nextGames = await response.json()
      setGames(nextGames)
    } catch {
      setError('Unable to load past games.')
    }
  }

  async function handleAuth(event) {
    event.preventDefault()
    setError('')

    try {
      const endpoint = mode === 'signup' ? '/api/signup' : '/api/login'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.detail || 'Authentication failed')
      }

      setUser(payload)
      await loadGames()
      setFormData({ email: '', password: '' })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // ignore and clear local state anyway
    }
    setUser(null)
    setGames([])
    setError('')
  }

  async function handleDelete(gameId) {
    try {
      const response = await fetch(`/api/games/${gameId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error('Unable to delete that game')
      }
      setGames((currentGames) => currentGames.filter((game) => game.id !== gameId))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Bowling tracker</p>
            <h1>Past games</h1>
          </div>
          {user ? (
            <button type="button" className="secondary" onClick={handleLogout}>
              Log out
            </button>
          ) : null}
        </div>

        {isLoading ? (
          <p className="muted">Loading your account…</p>
        ) : user ? (
          <>
            <p className="account-name">Signed in as {user.email}</p>
            {error ? <p className="error">{error}</p> : null}
            {games.length === 0 ? (
              <p className="muted">No past games yet. Upload a new scoreboard to start building your history.</p>
            ) : (
              <ul className="game-list">
                {games.map((game) => (
                  <li key={game.id} className="game-card">
                    <div>
                      <p className="game-date">{new Date(game.created_at).toLocaleString()}</p>
                      <p className="game-score">{game.frame_string}</p>
                    </div>
                    <button type="button" className="danger" onClick={() => void handleDelete(game.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <form className="auth-form" onSubmit={handleAuth}>
            <div className="toggle-row">
              <button
                type="button"
                className={mode === 'login' ? 'secondary active' : 'secondary'}
                onClick={() => setMode('login')}
              >
                Log in
              </button>
              <button
                type="button"
                className={mode === 'signup' ? 'secondary active' : 'secondary'}
                onClick={() => setMode('signup')}
              >
                Sign up
              </button>
            </div>

            {error ? <p className="error">{error}</p> : null}

            <label>
              Email
              <input
                type="email"
                value={formData.email}
                onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={formData.password}
                onChange={(event) => setFormData({ ...formData, password: event.target.value })}
                required
              />
            </label>

            <button type="submit" className="primary">
              {mode === 'signup' ? 'Create account' : 'Log in'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}

export default App
