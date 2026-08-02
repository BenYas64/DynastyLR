import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

const API = 'https://api.dynastylr.site'

export default function TeamRoster() {
  const { leagueId, rosterId } = useParams()
  const [roster, setRoster] = useState(null)
  const [owner, setOwner] = useState(null)
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${leagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/league/${leagueId}/users`).then(r => r.json()),
      fetch(`${API}/players`).then(r => r.json())
    ]).then(([rosters, users, playersData]) => {
      const myRoster = rosters.find(r => String(r.roster_id) === rosterId)
      if (!myRoster) throw new Error('Roster not found')
      const userMap = {}
      users.forEach(u => { userMap[u.user_id] = u })

      const playersMap = {}
      playersData.forEach(p => { playersMap[p.player_id] = p })

      setRoster(myRoster)
      setOwner(userMap[myRoster.owner_id] || null)
      setPlayers(playersMap)
      setLoading(false)
    }).catch(err => {
      setError(err.message)
      setLoading(false)
    })
  }, [leagueId, rosterId])

  if (loading) return <p style={{ padding: '20px' }}>Loading roster...</p>
  if (error) return (
    <div style={{ padding: '20px' }}>
      <p style={{ color: 'red' }}>Error: {error}</p>
      <Link to="/league">&larr; Back to League</Link>
    </div>
  )
  if (!roster) return <p style={{ padding: '20px' }}>No roster found.</p>

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <Link to="/league">&larr; Back to League</Link>
      <h2 style={{ marginTop: '10px' }}>{owner?.display_name || 'Unknown'}</h2>
      <p>Record: {roster.settings.wins}W - {roster.settings.losses}L</p>
      <p>Points For: {roster.settings.fpts}</p>
      <h3>Starters</h3>
      <ul>
        {roster.starters?.map(id => (
          <li key={id} style={{ padding: '5px 0' }}>
            <Link to={`/players/${id}`} style={{ color: 'inherit' }}>
              {players[id] ? `${players[id].first_name} ${players[id].last_name} - ${players[id].position} - ${players[id].team}` : id}
            </Link>
          </li>
        ))}
      </ul>
      <h3>Bench</h3>
      <ul>
        {roster.players?.filter(id => !roster.starters?.includes(id)).map(id => (
          <li key={id} style={{ padding: '5px 0', color: '#666' }}>
            <Link to={`/players/${id}`} style={{ color: 'inherit' }}>
              {players[id] ? `${players[id].first_name} ${players[id].last_name} - ${players[id].position} - ${players[id].team}` : id}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
