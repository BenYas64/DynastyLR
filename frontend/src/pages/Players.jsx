import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { usePlayerModal } from '../PlayerModalContext.jsx'

const API = 'https://api.dynastylr.site'
const PAGE_SIZE = 100
const CURRENT_SEASON = 2026
const SEASON_OPTIONS = Array.from({ length: CURRENT_SEASON - 2017 + 1 }, (_, i) => CURRENT_SEASON - i)

export default function Players() {
  const { openPlayer } = usePlayerModal()
  const { user, selectedLeagueId } = useAccount()
  const [players, setPlayers] = useState([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'available'
  const [season, setSeason] = useState(2026)
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [addingId, setAddingId] = useState(null)
  const [addError, setAddError] = useState(null)

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

  const loadPlayers = () => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), season: String(season) })
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
  }

  useEffect(loadPlayers, [debouncedSearch, selectedLeagueId, filterMode, season])

  const handleAdd = (playerId) => {
    setAddError(null)
    setAddingId(playerId)
    fetch(`${API}/league/${selectedLeagueId}/add-player`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.user_id, player_id: playerId }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to add player') })
        return r.json()
      })
      .then(() => {
        setAddingId(null)
        loadPlayers()
      })
      .catch(err => {
        setAddingId(null)
        setAddError(err.message)
      })
  }

  if (loading) return <p style={{ padding: '20px' }}>Loading players...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Players ({total} total)</h2>
      <p style={{ color: '#666', fontSize: '14px' }}>
        {selectedLeague?.scoring_settings
          ? `${season} points use ${selectedLeague.name}'s scoring settings.`
          : `Showing standard PPR points for ${season}. Sign in and select a league on the Account page for that league's scoring.`}
      </p>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search players..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px', width: '300px', fontSize: '16px' }}
        />

        <select
          value={season}
          onChange={e => setSeason(Number(e.target.value))}
          style={{ padding: '8px', fontSize: '14px' }}
        >
          {SEASON_OPTIONS.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

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

      {addError && <p style={{ color: 'red' }}>{addError}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgb(155, 157, 157)' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Position</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Age</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Injury Status</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>{season} Points</th>
            {filterMode === 'available' && <th style={{ padding: '10px', textAlign: 'left' }}></th>}
          </tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr
              key={p.player_id}
              onClick={() => openPlayer(p.player_id)}
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
              {filterMode === 'available' && (
                <td style={{ padding: '10px' }}>
                  {user && (
                    <button
                      onClick={e => { e.stopPropagation(); handleAdd(p.player_id) }}
                      disabled={addingId === p.player_id}
                      style={{
                        padding: '4px 12px',
                        fontSize: '13px',
                        background: '#16a34a',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: addingId === p.player_id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {addingId === p.player_id ? 'Adding...' : 'Add'}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {total > players.length && <p>Showing {players.length} of {total}. Search to narrow results.</p>}
    </div>
  )
}
