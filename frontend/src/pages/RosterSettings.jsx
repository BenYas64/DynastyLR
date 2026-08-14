import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'

// Display order requested, mapped to Sleeper's actual roster_positions slot
// type strings (mirrors FLEX_ELIGIBLE_POSITIONS used elsewhere for slot logic).
// Colors follow the same palette as the position chips on the roster/matchup
// pages where they overlap (QB/RB/WR/TE/FLEX/SUPER_FLEX).
const QB_COLOR = '#d32f2f'
const RB_COLOR = '#2e7d32'
const WR_COLOR = '#1976d2'
const TE_COLOR = '#d26019'

// Flex-type slots already blend 2-4 real positions, so their chips use a
// gradient of those positions' own colors instead of a single flat color -
// everything else (a single true position) stays a flat color.
const SLOT_ORDER = [
  ['QB', 'QB', 'Quarterback', QB_COLOR],
  ['RB', 'RB', 'Running Back', RB_COLOR],
  ['WR', 'WR', 'Wide Receiver', WR_COLOR],
  ['TE', 'TE', 'Tight End', TE_COLOR],
  ['FLEX', 'FLX', 'Flex (RB/WR/TE)', [RB_COLOR, WR_COLOR, TE_COLOR]],
  ['WRRB_FLEX', 'FLX', 'Flex (RB/WR)', [RB_COLOR, WR_COLOR]],
  ['REC_FLEX', 'FLX', 'Flex (WR/TE)', [WR_COLOR, TE_COLOR]],
  ['SUPER_FLEX', 'SFX', 'Super Flex (QB/RB/WR/TE)', [QB_COLOR, RB_COLOR, WR_COLOR, TE_COLOR]],
  ['K', 'K', 'Kicker', '#ec4899'],
  ['DEF', 'DEF', 'Defense', '#795548'],
  ['BN', 'BN', 'Bench', '#9e9e9e'],
  ['DL', 'DL', 'Defensive Linemen', '#f57c00'],
  ['LB', 'LB', 'Linebacker', '#fbc02d'],
  ['DB', 'DB', 'Defensive Back', '#43a047'],
  ['IDP_FLEX', 'IDP', 'IDP Flex', ['#f57c00', '#fbc02d', '#43a047']],
]

function chipStyle(color) {
  return {
    display: 'inline-block',
    minWidth: '44px',
    padding: '2px 8px',
    marginRight: '10px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#fff',
    background: Array.isArray(color) ? `linear-gradient(135deg, ${color.join(', ')})` : color,
  }
}

export default function RosterSettings() {
  const { user, selectedLeagueId, setSelectedLeagueId } = useAccount()
  const [league, setLeague] = useState(null)
  const [history, setHistory] = useState([])
  const [isCommish, setIsCommish] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editedCounts, setEditedCounts] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)

  useEffect(() => {
    if (!selectedLeagueId) return
    setLoading(true)
    setError(null)
    fetch(`${API}/league/${selectedLeagueId}`)
      .then(r => r.json())
      .then(data => {
        setLeague(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [selectedLeagueId])

  useEffect(() => {
    if (!selectedLeagueId) return
    fetch(`${API}/league/${selectedLeagueId}/history`)
      .then(r => r.json())
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [selectedLeagueId])

  useEffect(() => {
    if (!selectedLeagueId || !user) {
      setIsCommish(false)
      return
    }
    fetch(`${API}/league/${selectedLeagueId}/users`)
      .then(r => r.json())
      .then(users => {
        const me = users.find(u => u.user_id === user.user_id)
        setIsCommish(!!me?.commish)
      })
      .catch(() => setIsCommish(false))
  }, [selectedLeagueId, user])

  useEffect(() => {
    if (!league?.roster_positions) return
    try {
      const parsed = JSON.parse(league.roster_positions)
      const counts = {}
      parsed.forEach(slot => { counts[slot] = (counts[slot] || 0) + 1 })
      const asStrings = {}
      SLOT_ORDER.forEach(([slot]) => { asStrings[slot] = String(counts[slot] || 0) })
      setEditedCounts(asStrings)
    } catch {
      setEditedCounts({})
    }
    setSaveMessage(null)
  }, [league])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view its roster settings.
    </p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading roster settings...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>

  let rosterPositions = null
  try {
    rosterPositions = league.roster_positions ? JSON.parse(league.roster_positions) : null
  } catch {
    rosterPositions = null
  }

  if (!rosterPositions) return <p style={{ padding: '20px' }}>No roster settings found for this league.</p>

  const canEdit = isCommish && league.is_current_season

  const counts = {}
  rosterPositions.forEach(slot => { counts[slot] = (counts[slot] || 0) + 1 })

  const entries = SLOT_ORDER.filter(([, , fullName]) => fullName.toLowerCase().includes(search.toLowerCase()))

  const handleSave = () => {
    setSaving(true)
    setSaveMessage(null)
    const positions = {}
    SLOT_ORDER.forEach(([slot]) => {
      const num = parseInt(editedCounts[slot], 10)
      positions[slot] = Number.isFinite(num) && num > 0 ? num : 0
    })

    fetch(`${API}/league/${selectedLeagueId}/roster-positions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.user_id, positions }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to save') })
        return r.json()
      })
      .then(data => {
        setLeague(prev => ({ ...prev, roster_positions: JSON.stringify(data.roster_positions) }))
        setSaveMessage({ type: 'success', text: 'Roster settings saved.' })
        setSaving(false)
      })
      .catch(err => {
        setSaveMessage({ type: 'error', text: err.message })
        setSaving(false)
      })
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Roster Settings</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <p style={{ color: '#666', margin: 0 }}>{league.name}</p>
        {history.length > 1 && (
          <select
            value={selectedLeagueId}
            onChange={e => setSelectedLeagueId(e.target.value)}
            style={{ padding: '4px 8px', fontSize: '14px' }}
          >
            {history.map(h => (
              <option key={h.league_id} value={h.league_id}>{h.season}</option>
            ))}
          </select>
        )}
      </div>

      <input
        type="text"
        placeholder="Search positions..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ padding: '8px', width: '300px', fontSize: '16px', marginBottom: '20px' }}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: '600px' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ padding: '8px', textAlign: 'left' }}>Position</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>Slots</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([slot, abbr, fullName, color]) => (
            <tr key={slot} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px' }}>
                <span style={chipStyle(color)}>{abbr}</span>
                {fullName}
              </td>
              <td style={{ padding: '8px', textAlign: 'right' }}>
                {canEdit ? (
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="no-spinner"
                    value={editedCounts[slot] ?? ''}
                    onChange={e => setEditedCounts(prev => ({ ...prev, [slot]: e.target.value }))}
                    style={{ width: '60px', padding: '4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  />
                ) : (
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{counts[slot] || 0}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <p style={{ color: '#666' }}>No positions match your search.</p>}

      {canEdit && (
        <div style={{ marginTop: '20px' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 24px',
              fontSize: '16px',
              background: '#1a1a2e',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {saveMessage && (
            <p style={{ color: saveMessage.type === 'error' ? 'red' : 'green', marginTop: '8px' }}>
              {saveMessage.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
