import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'
const PAGE_SIZE = 100

export default function Players() {
  const navigate = useNavigate()
  const { selectedLeagueId } = useAccount()
  const [players, setPlayers] = useState([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'available'
  const [selectedLeague, setSelectedLeague] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!selectedLeagueId) {
      setSelectedLeague(null)
      return
    }
    fetch(`${API}/league/${selectedLeagueId}`)
      .then(r => r.json())
      .then(setSelectedLeague)
      .catch(() => setSelectedLeague(null))
  }, [selectedLeagueId])

  useEffect(() => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (selectedLeagueId) params.set('league_id', selectedLeagueId)
    if (filterMode === 'available' && selectedLeagueId) params.set('available_only', 'true')

    fetch(`${API}/players/browse?${params}`)
      .then(r => r.json())
      .then(data => {
        setPlayers(data.players || [])
        setTotal(data.total || 0)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [debouncedSearch, selectedLeagueId, filterMode])

  if (loading) return <p style={{ padding: '20px' }}>Loading players...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Players ({total} total)</h2>
      <p style={{ color: '#666', fontSize: '14px' }}>
        {selectedLeague?.scoring_settings
          ? `2026 points use ${selectedLeague.name}'s scoring settings.`
          : 'Showing standard PPR points. Sign in and select a league on the Account page for that league\'s scoring.'}
      </p>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search players..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px', width: '300px', fontSize: '16px' }}
        />

        <div style={{ display: 'inline-flex', border: '1px solid #ccc', borderRadius: '20px', overflow: 'hidden' }}>
          <button
            onClick={() => setFilterMode('all')}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              border: 'none',
              cursor: 'pointer',
              background: filterMode === 'all' ? '#93c5fd' : '#1a1a2e',
              color: filterMode === 'all' ? '#1a1a2e' : '#fff',
            }}
          >
            All Players
          </button>
          <button
            onClick={() => setFilterMode('available')}
            disabled={!selectedLeagueId}
            title={!selectedLeagueId ? 'Sign in and select a league on the Account page first' : ''}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              border: 'none',
              cursor: selectedLeagueId ? 'pointer' : 'not-allowed',
              background: filterMode === 'available' ? '#93c5fd' : '#1a1a2e',
              color: filterMode === 'available' ? '#1a1a2e' : (selectedLeagueId ? '#fff' : '#d1d5db'),
            }}
          >
            Available Players
          </button>
        </div>
      </div>

      {filterMode === 'available' && !selectedLeagueId && (
        <p style={{ color: '#666' }}>Sign in and select a league on the Account page to filter available players.</p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgb(155, 157, 157)' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Position</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Age</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Injury Status</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>2026 Points</th>
          </tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr
              key={p.player_id}
              onClick={() => navigate(`/players/${p.player_id}`)}
              style={{ borderBottom: '1px solid #ddd', cursor: 'pointer' }}
            >
              <td style={{ padding: '10px' }}>{p.full_name}</td>
              <td style={{ padding: '10px' }}>{p.position}</td>
              <td style={{ padding: '10px' }}>{p.team || 'FA'}</td>
              <td style={{ padding: '10px' }}>{p.age}</td>
              <td style={{ padding: '10px', color: p.injury_status ? 'red' : 'green' }}>
                {p.injury_status || 'Active'}
              </td>
              <td style={{ padding: '10px' }}>{(p.points || 0).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > players.length && <p>Showing {players.length} of {total}. Search to narrow results.</p>}
    </div>
  )
}
