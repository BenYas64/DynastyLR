import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'

function parseJsonArray(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Flex-type roster slots don't literally match a player's fantasy_positions
// (e.g. no player is tagged "FLEX"), so they're expanded to the positions
// eligible to fill them.
const FLEX_ELIGIBLE_POSITIONS = {
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'],
  REC_FLEX: ['WR', 'TE'],
}

function eligiblePositionsForRoster(rosterPositions) {
  const eligible = new Set()
  for (const slot of rosterPositions) {
    for (const pos of FLEX_ELIGIBLE_POSITIONS[slot] || [slot]) {
      eligible.add(pos)
    }
  }
  return eligible
}

export default function Players() {
  const navigate = useNavigate()
  const { selectedLeagueId } = useAccount()
  const [players, setPlayers] = useState([])
  const [points, setPoints] = useState({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'available'
  const [rosteredIds, setRosteredIds] = useState(null)
  const [selectedLeague, setSelectedLeague] = useState(null)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/players`).then(r => r.json()),
      fetch(`${API}/players/points/2025`).then(r => r.json()),
    ])
      .then(([playersData, pointsData]) => {
        setPlayers(playersData)
        setPoints(pointsData)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (filterMode !== 'available' || !selectedLeagueId) return
    fetch(`${API}/league/${selectedLeagueId}/rostered-players`)
      .then(r => r.json())
      .then(ids => setRosteredIds(new Set(ids)))
      .catch(() => setRosteredIds(new Set()))
  }, [filterMode, selectedLeagueId])

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

  if (loading) return <p style={{ padding: '20px' }}>Loading players...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>

  const showAvailableOnly = filterMode === 'available' && selectedLeagueId && rosteredIds

  const leagueRosterPositions = selectedLeague ? parseJsonArray(selectedLeague.roster_positions) : []
  const eligiblePositions = eligiblePositionsForRoster(leagueRosterPositions)

  const filtered = players
    .filter(p => `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase()))
    .filter(p => !showAvailableOnly || !rosteredIds.has(p.player_id))
    .filter(p => leagueRosterPositions.length === 0 || parseJsonArray(p.fantasy_positions).some(pos => eligiblePositions.has(pos)))
    .sort((a, b) => (points[b.player_id] || 0) - (points[a.player_id] || 0))

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Players ({players.length} total)</h2>

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
              background: filterMode === 'all' ? '#1a1a2e' : '#fff',
              color: filterMode === 'all' ? '#fff' : '#333',
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
              background: filterMode === 'available' ? '#1a1a2e' : '#fff',
              color: filterMode === 'available' ? '#fff' : (selectedLeagueId ? '#333' : '#aaa'),
            }}
          >
            Available Players
          </button>
        </div>
      </div>

      {filterMode === 'available' && !selectedLeagueId && (
        <p style={{ color: '#666' }}>Sign in and select a league on the Account page to filter available players.</p>
      )}
      {filterMode === 'available' && selectedLeagueId && !rosteredIds && (
        <p>Loading rosters...</p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgb(155, 157, 157)' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Position</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Age</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Injury Status</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>2025 Points</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 100).map(p => (
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
              <td style={{ padding: '10px' }}>{(points[p.player_id] || 0).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 100 && <p>Showing 100 of {filtered.length}. Search to narrow results.</p>}
    </div>
  )
}
