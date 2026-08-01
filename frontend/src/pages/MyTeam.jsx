import { useEffect, useState } from 'react'

const LEAGUE_ID = '1180188202559705088' // WCXC Dynasty
const MY_USERNAME = 'CoolBen9880'
const API = 'https://api.dynastylr.site'

export default function MyTeam() {
  const [roster, setRoster] = useState(null)
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/user/${MY_USERNAME}`).then(r => r.json()),
      fetch(`${API}/league/${LEAGUE_ID}/rosters`).then(r => r.json()),
      fetch(`${API}/players`).then(r => r.json())
    ]).then(([user, rosters, playersData]) => {
      const myRoster = rosters.find(r => r.owner_id === user.user_id)
      const playersMap = {}
      playersData.forEach(p => { playersMap[p.player_id] = p })
      setRoster(myRoster)
      setPlayers(playersMap)
      setLoading(false)
    })
  }, [])

  if (loading) return <p style={{ padding: '20px' }}>Loading your team...</p>
  if (!roster) return <p style={{ padding: '20px' }}>No roster found.</p>

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>My Team</h2>
      <p>Record: {roster.settings.wins}W - {roster.settings.losses}L</p>
      <p>Points For: {roster.settings.fpts}</p>
      <h3>Starters</h3>
      <ul>
        {roster.starters?.map(id => (
          <li key={id} style={{ padding: '5px 0' }}>
            {players[id] ? `${players[id].first_name} ${players[id].last_name} - ${players[id].position} - ${players[id].team}` : id}
          </li>
        ))}
      </ul>
      <h3>Bench</h3>
      <ul>
        {roster.players?.filter(id => !roster.starters?.includes(id)).map(id => (
          <li key={id} style={{ padding: '5px 0', color: '#666' }}>
            {players[id] ? `${players[id].first_name} ${players[id].last_name} - ${players[id].position} - ${players[id].team}` : id}
          </li>
        ))}
      </ul>
    </div>
  )
}
