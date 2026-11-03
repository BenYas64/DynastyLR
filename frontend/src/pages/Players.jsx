import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { usePlayerModal } from '../PlayerModalContext.jsx'
import { headshotUrl, onHeadshotError } from '../playerHeadshot.js'

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
  const [filterOptions, setFilterOptions] = useState({ positions: [], teams: [], injury_statuses: [] })
  const [positionFilter, setPositionFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [injuryFilter, setInjuryFilter] = useState('')
  const [sortBy, setSortBy] = useState('points')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    const params = selectedLeagueId ? `?league_id=${selectedLeagueId}` : ''
    fetch(`${API}/players/filter-options${params}`)
      .then(r => r.json())
      .then(setFilterOptions)
      .catch(() => {})
    // A position picked under one league's dropdown may not exist in
    // another's (no K slot, no IDP, etc.) - drop it rather than leave an
    // invalid filter silently selected.
    setPositionFilter('')
  }, [selectedLeagueId])

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

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE), season: String(season), sort_by: sortBy, sort_dir: sortDir,
    })
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (selectedLeagueId) params.set('league_id', selectedLeagueId)
    if (filterMode === 'available' && selectedLeagueId) params.set('available_only', 'true')
    if (positionFilter) params.set('position', positionFilter)
    if (teamFilter) params.set('team', teamFilter)
    if (injuryFilter) params.set('injury_status', injuryFilter)

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

  useEffect(loadPlayers, [
    debouncedSearch, selectedLeagueId, filterMode, season,
    positionFilter, teamFilter, injuryFilter, sortBy, sortDir,
  ])

  // Clicking an already-active sort column flips direction; switching to a
  // new one picks whichever direction shows the "best" players first -
  // rank columns are best-at-1 (ascending), everything else is
  // best-at-highest (descending).
  const RANK_FIELDS = new Set(['redraft_rank', 'dynasty_rank'])
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir(RANK_FIELDS.has(field) ? 'asc' : 'desc')
    }
  }

  const sortArrow = (field) => sortBy === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

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
        {!selectedLeague && ' PAR needs a selected league too, and shows as "-" until one is chosen.'}
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

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
        <select value={positionFilter} onChange={e => setPositionFilter(e.target.value)} style={{ padding: '6px', fontSize: '14px' }}>
          <option value="">All Positions</option>
          {filterOptions.positions.map(pos => <option key={pos} value={pos}>{pos}</option>)}
        </select>
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={{ padding: '6px', fontSize: '14px' }}>
          <option value="">All Teams</option>
          {filterOptions.teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={injuryFilter} onChange={e => setInjuryFilter(e.target.value)} style={{ padding: '6px', fontSize: '14px' }}>
          <option value="">All Injury Statuses</option>
          <option value="Active">Active</option>
          {filterOptions.injury_statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {addError && <p style={{ color: 'red' }}>{addError}</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgb(155, 157, 157)' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Position</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team</th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('age')}>
              Age{sortArrow('age')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Injury Status</th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('points')}>
              {season} Points{sortArrow('points')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('par')}>
              {season} PAR{sortArrow('par')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('redraft_value')}>
              Redraft Value{sortArrow('redraft_value')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('redraft_rank')}>
              Redraft Rank{sortArrow('redraft_rank')}
            </th>
            {selectedLeague?.league_type === 'dynasty' && (
              <>
                <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('dynasty_value')}>
                  Dynasty Value{sortArrow('dynasty_value')}
                </th>
                <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('dynasty_rank')}>
                  Dynasty Rank{sortArrow('dynasty_rank')}
                </th>
              </>
            )}
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
              <td style={{ padding: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <img
                  src={headshotUrl(p.player_id)}
                  alt=""
                  style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', background: '#ddd', flexShrink: 0 }}
                  onError={onHeadshotError}
                />
                {p.full_name}
              </td>
              <td style={{ padding: '10px' }}>{p.position}</td>
              <td style={{ padding: '10px' }}>{p.team || 'FA'}</td>
              <td style={{ padding: '10px' }}>{p.age}</td>
              <td style={{ padding: '10px', color: p.injury_status ? 'red' : 'green' }}>
                {p.injury_status || 'Active'}
              </td>
              <td style={{ padding: '10px' }}>{(p.points || 0).toFixed(1)}</td>
              <td style={{ padding: '10px' }}>{p.par != null ? p.par.toFixed(1) : '-'}</td>
              <td style={{ padding: '10px' }}>{p.redraft_value ?? '-'}</td>
              <td style={{ padding: '10px' }}>{p.redraft_position_rank != null ? `${p.position}${p.redraft_position_rank}` : '-'}</td>
              {selectedLeague?.league_type === 'dynasty' && (
                <>
                  <td style={{ padding: '10px' }}>{p.dynasty_value ?? '-'}</td>
                  <td style={{ padding: '10px' }}>{p.dynasty_position_rank != null ? `${p.position}${p.dynasty_position_rank}` : '-'}</td>
                </>
              )}
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
