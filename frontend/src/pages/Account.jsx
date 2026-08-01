import { useState } from 'react'

const API = 'https://api.dynastylr.site'

export default function Account() {
  const [input, setInput] = useState('')
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    setError(null)
    fetch(`${API}/account/${encodeURIComponent(input)}`)
      .then(r => {
        if (!r.ok) throw new Error('No user found with that name')
        return r.json()
      })
      .then(data => setUser(data))
      .catch(err => {
        setUser(null)
        setError(err.message)
      })
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Account</h2>

      {user ? (
        <div>
          <p>Signed in as <strong>{user.display_name}</strong></p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            placeholder="Enter your Sleeper display name..."
            value={input}
            onChange={e => setInput(e.target.value)}
            style={{ padding: '8px', width: '300px', fontSize: '16px' }}
          />
          <button type="submit" style={{ padding: '8px 16px', fontSize: '16px' }}>Enter</button>
        </form>
      )}

      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
