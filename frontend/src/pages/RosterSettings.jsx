import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'

// Display order requested, mapped to Sleeper's actual roster_positions slot
// type strings (mirrors FLEX_ELIGIBLE_POSITIONS used elsewhere for slot logic).
const SLOT_ORDER = [
  ['QB', 'QB'],
  ['RB', 'RB'],
  ['WR', 'WR'],
  ['TE', 'TE'],
  ['REC_FLEX', 'WR/TE'],
  ['WRRB_FLEX', 'WR/RB'],
  ['FLEX', 'Flex Spots'],
  ['SUPER_FLEX', 'Super Flex Spots'],
  ['K', 'Kicker'],
  ['DEF', 'Team Def'],
  ['BN', 'Bench Spots'],
  ['DL', 'DL'],
  ['LB', 'LB'],
  ['DB', 'DB'],
  ['IDP_FLEX', 'IDP Flex'],
]

export default function RosterSettings() {
  const { selectedLeagueId, setSelectedLeagueId } = useAccount()
  const [league, setLeague] = useState(null)
  const [history, setHistory] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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

  const counts = {}
  rosterPositions.forEach(slot => { counts[slot] = (counts[slot] || 0) + 1 })

  const entries = SLOT_ORDER.filter(([, label]) => label.toLowerCase().includes(search.toLowerCase()))

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
          {entries.map(([slot, label]) => (
            <tr key={slot} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px' }}>{label}</td>
              <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {counts[slot] || 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <p style={{ color: '#666' }}>No positions match your search.</p>}
    </div>
  )
}
