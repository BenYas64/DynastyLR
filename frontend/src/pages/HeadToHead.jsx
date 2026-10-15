import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'

const API = 'https://api.dynastylr.site'

const COLUMNS = [
  { key: 'wins_1', label: 'Team 1 Wins' },
  { key: 'wins_2', label: 'Team 2 Wins' },
  { key: 'total_games', label: 'Total Games' },
]

export default function HeadToHead() {
  const { selectedLeagueId } = useAccount()
  const [records, setRecords] = useState([])
  const [rosters, setRosters] = useState([])
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('total_games')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    if (!selectedLeagueId) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${selectedLeagueId}/head-to-head`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/users`).then(r => r.json()),
    ]).then(([recordsData, rostersData, usersData]) => {
      const userMap = {}
      usersData.forEach(u => userMap[u.user_id] = u)
      setRecords(recordsData)
      setRosters(rostersData)
      setUsers(userMap)
      setLoading(false)
    }).catch(err => {
      setError(err.message)
      setLoading(false)
    })
  }, [selectedLeagueId])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view head-to-head records.
    </p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading head-to-head records...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>
  if (records.length === 0) return <p style={{ padding: '20px' }}>No completed matchups found yet.</p>

  const rosterMap = {}
  rosters.forEach(r => { rosterMap[r.roster_id] = r })

  const teamFor = (rosterId) => {
    const roster = rosterMap[rosterId]
    const user = roster ? users[roster.owner_id] : null
    return { name: roster ? teamName(user) : `Roster ${rosterId}`, avatar: teamAvatarUrl(user) }
  }

  const sorted = [...records].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey]
    return sortDir === 'desc' ? -diff : diff
  })

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir(dir => dir === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Head-to-Head Records</h2>
      <p style={{ color: '#666' }}>All-time regular-season matchup results between every pair of teams in this league's history.</p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team 1</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team 2</th>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                style={{ padding: '10px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
              >
                {col.label}{sortKey === col.key && (sortDir === 'desc' ? ' ▼' : ' ▲')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((rec, i) => {
            const team1 = teamFor(rec.roster_id_1)
            const team2 = teamFor(rec.roster_id_2)
            return (
              <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {team1.avatar && <img src={team1.avatar} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />}
                  {team1.name}
                </td>
                <td style={{ padding: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {team2.avatar && <img src={team2.avatar} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />}
                  {team2.name}
                </td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{rec.wins_1}</td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{rec.wins_2}</td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{rec.total_games}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
