import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'

const API = 'https://api.dynastylr.site'

function pct(value) {
  return `${(value * 100).toFixed(1)}%`
}

function pts(value) {
  return value.toFixed(2)
}

const COLUMNS = [
  { key: 'wins_1', label: 'Team 1 Wins' },
  { key: 'wins_2', label: 'Team 2 Wins' },
  { key: 'win_pct_1', label: 'Team 1 Win %', format: pct },
  { key: 'win_pct_2', label: 'Team 2 Win %', format: pct },
  { key: 'avg_points_1', label: 'Team 1 Avg Pts', format: pts },
  { key: 'avg_points_2', label: 'Team 2 Avg Pts', format: pts },
  { key: 'total_games', label: 'Total Games' },
]

export default function HeadToHead() {
  const { selectedLeagueId } = useAccount()
  const [records, setRecords] = useState([])
  const [rosters, setRosters] = useState([])
  const [users, setUsers] = useState({})
  const [weeklyScores, setWeeklyScores] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('total_games')
  const [sortDir, setSortDir] = useState('desc')
  const [teamFilter, setTeamFilter] = useState('')

  useEffect(() => {
    setTeamFilter('')
  }, [selectedLeagueId])

  useEffect(() => {
    if (!selectedLeagueId) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${selectedLeagueId}/head-to-head`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/users`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/weekly-scores`).then(r => r.json()),
    ]).then(([recordsData, rostersData, usersData, weeklyScoresData]) => {
      const userMap = {}
      usersData.forEach(u => userMap[u.user_id] = u)
      setRecords(recordsData)
      setRosters(rostersData)
      setUsers(userMap)
      setWeeklyScores(weeklyScoresData)
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

  const rows = records.map(rec => {
    const games = rec.total_games
    return {
      ...rec,
      win_pct_1: games ? rec.wins_1 / games : 0,
      win_pct_2: games ? rec.wins_2 / games : 0,
      avg_points_1: games ? rec.points_1 / games : 0,
      avg_points_2: games ? rec.points_2 / games : 0,
    }
  })

  const totalGames = records.reduce((sum, rec) => sum + rec.total_games, 0)
  const totalPoints = records.reduce((sum, rec) => sum + rec.points_1 + rec.points_2, 0)
  // Each game has two team scores, so the per-team average divides by 2x games.
  const leagueAvg = totalGames ? totalPoints / (totalGames * 2) : 0

  // Every roster that appears on either side of a matchup, for the team filter dropdown.
  const teamOptions = [...new Set(records.flatMap(rec => [rec.roster_id_1, rec.roster_id_2]))]
    .map(rosterId => ({ rosterId, name: teamFor(rosterId).name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const filtered = teamFilter === ''
    ? rows
    : rows.filter(rec => rec.roster_id_1 === Number(teamFilter) || rec.roster_id_2 === Number(teamFilter))

  const sorted = [...filtered].sort((a, b) => {
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

  const scoresByPoints = [...weeklyScores].sort((a, b) => b.points - a.points)
  const top10Scores = scoresByPoints.slice(0, 10)
  const bottom10Scores = scoresByPoints.slice(-10).reverse()

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Head-to-Head Records</h2>
      <p style={{ color: '#666' }}>All-time regular season and playoff matchup results between every pair of ROSTERS in this league's history.</p>

      <select
        value={teamFilter}
        onChange={e => setTeamFilter(e.target.value)}
        style={{ padding: '8px', fontSize: '14px', marginTop: '12px' }}
      >
        <option value="">All Teams</option>
        {teamOptions.map(opt => (
          <option key={opt.rosterId} value={opt.rosterId}>{opt.name}</option>
        ))}
      </select>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead>
          <tr style={{ background: '#002676' }}>
            <th colSpan={2} style={{ padding: '10px', textAlign: 'left' }}>Teams</th>
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
                <td style={{ padding: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {team1.avatar && <img src={team1.avatar} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />}
                    {team1.name}
                  </div>
                </td>
                <td style={{ padding: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {team2.avatar && <img src={team2.avatar} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />}
                    {team2.name}
                  </div>
                </td>
                {COLUMNS.map(col => (
                  <td key={col.key} style={{ padding: '10px', textAlign: 'center' }}>
                    {col.format ? col.format(rec[col.key]) : rec[col.key]}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>

      <p style={{ marginTop: '16px', color: '#666' }}>
        Total games: {totalGames}
      </p>
      <p style={{ color: '#666' }}>
        All-time league average score: {pts(leagueAvg)}
      </p>

      <div style={{ display: 'flex', gap: '32px', marginTop: '32px', flexWrap: 'wrap' }}>
        <ScoreTable title="Top 10 Weekly Scores" rows={top10Scores} />
        <ScoreTable title="Bottom 10 Weekly Scores" rows={bottom10Scores} />
      </div>
    </div>
  )
}

function ScoreTable({ title, rows }) {
  return (
    <div style={{ flex: '1 1 400px' }}>
      <h3>{title}</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#002676' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team</th>
            <th style={{ padding: '10px', textAlign: 'center' }}>Year</th>
            <th style={{ padding: '10px', textAlign: 'center' }}>Week</th>
            <th style={{ padding: '10px', textAlign: 'center' }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const avatar = teamAvatarUrl(row)
            return (
              <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {avatar && <img src={avatar} alt="" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />}
                    {teamName(row)}
                  </div>
                </td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{row.season}</td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{row.week}</td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{pts(row.points)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
