import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

export default function Matchups() {
  const { selectedLeagueId } = useAccount()
  const navigate = useNavigate()
  const [week, setWeek] = useState(1)
  const [matchups, setMatchups] = useState([])
  const [rosters, setRosters] = useState([])
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!selectedLeagueId) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${selectedLeagueId}/matchups/${week}`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/users`).then(r => r.json()),
    ]).then(([matchupsData, rostersData, usersData]) => {
      const userMap = {}
      usersData.forEach(u => { userMap[u.user_id] = u })
      setMatchups(matchupsData)
      setRosters(rostersData)
      setUsers(userMap)
      setLoading(false)
    }).catch(err => {
      setError(err.message)
      setLoading(false)
    })
  }, [selectedLeagueId, week])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view matchups.
    </p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading matchups...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>

  const rosterMap = {}
  rosters.forEach(r => { rosterMap[r.roster_id] = r })

  const byMatchupId = {}
  matchups.forEach(m => {
    if (!byMatchupId[m.matchup_id]) byMatchupId[m.matchup_id] = []
    byMatchupId[m.matchup_id].push(m)
  })
  const pairs = Object.values(byMatchupId)

  const teamFor = (rosterId) => {
    const roster = rosterMap[rosterId]
    const user = roster ? users[roster.owner_id] : null
    return { name: user?.display_name || `Roster ${rosterId}`, avatar: user?.avatar }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Matchups</h2>

      <select
        value={week}
        onChange={e => setWeek(Number(e.target.value))}
        style={{ padding: '8px', fontSize: '16px', marginBottom: '20px' }}
      >
        {WEEKS.map(w => <option key={w} value={w}>Week {w}</option>)}
      </select>

      {pairs.length === 0 ? (
        <p>No matchups found for week {week}.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '500px' }}>
          {pairs.map((pair, i) => {
            const [a, b] = pair
            const aWins = b && a.points > b.points
            const bWins = b && b.points > a.points
            return (
              <div key={i} style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '12px' }}>
                <MatchupRow
                  team={teamFor(a.roster_id)}
                  points={a.points}
                  winner={aWins}
                  onClick={() => navigate(`/league/${selectedLeagueId}/roster/${a.roster_id}`)}
                />
                {b && (
                  <MatchupRow
                    team={teamFor(b.roster_id)}
                    points={b.points}
                    winner={bWins}
                    onClick={() => navigate(`/league/${selectedLeagueId}/roster/${b.roster_id}`)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MatchupRow({ team, points, winner, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: winner ? 'bold' : 'normal' }}>
        {team.avatar && (
          <img
            src={`https://sleepercdn.com/avatars/thumbs/${team.avatar}`}
            alt=""
            style={{ width: '24px', height: '24px', borderRadius: '50%' }}
          />
        )}
        {team.name}
      </div>
      <span style={{ fontWeight: winner ? 'bold' : 'normal', color: winner ? '#16a34a' : 'inherit' }}>
        {points != null ? points.toFixed(2) : '-'}
      </span>
    </div>
  )
}
