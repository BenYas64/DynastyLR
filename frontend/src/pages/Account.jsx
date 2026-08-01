import { useState } from 'react'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'

export default function Account() {
  const { user, setUser, leagues, setLeagues, selectedLeagueId, setSelectedLeagueId, signOut } = useAccount()
  const [input, setInput] = useState('')
  const [error, setError] = useState(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    setError(null)
    fetch(`${API}/account/${encodeURIComponent(input)}`)
      .then(r => {
        if (!r.ok) throw new Error('No user found with that name')
        return r.json()
      })
      .then(userData => {
        setUser(userData)
        return fetch(`${API}/leagues/${userData.user_id}`).then(r => r.json())
      })
      .then(leaguesData => {
        setLeagues(leaguesData || [])
        setSelectedLeagueId(leaguesData?.[0]?.league_id || null)
      })
      .catch(err => {
        setUser(null)
        setLeagues([])
        setSelectedLeagueId(null)
        setError(err.message)
      })
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Account</h2>

      {user ? (
        <div>
          <p>Signed in as <strong>{user.display_name}</strong></p>

          <label htmlFor="league-select" style={{ display: 'block', marginTop: '15px', marginBottom: '5px' }}>
            League
          </label>
          {leagues.length === 0 ? (
            <p>No leagues found for this user.</p>
          ) : (
            <select
              id="league-select"
              value={selectedLeagueId || ''}
              onChange={e => setSelectedLeagueId(e.target.value)}
              style={{ padding: '8px', width: '300px', fontSize: '16px' }}
            >
              {leagues.map(l => (
                <option key={l.league_id} value={l.league_id}>{l.name}</option>
              ))}
            </select>
          )}

          <div>
            <button
              onClick={signOut}
              style={{ padding: '8px 16px', fontSize: '16px', marginTop: '20px' }}
            >
              Sign Out
            </button>
          </div>
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
