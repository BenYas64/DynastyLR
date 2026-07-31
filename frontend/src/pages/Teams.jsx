import { useEffect, useState } from 'react'

const API = 'https://api.dynastylr.site'

export default function Teams() {
  const [rosters, setRosters] = useState([])
  const [users, setUsers] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API}/user/CoolBen9880`)
      .then(r => r.json())
      .then(user => {
        return fetch(`${API}/leagues/${user.user_id}`)
          .then(r => r.json())
          .then(leagues => {
            if (!leagues || leagues.length === 0) throw new Error('No leagues found')
            const league = leagues[0]
            return Promise.all([
              fetch(`${API}/league/${league.league_id}/rosters`).then(r => r.json()),
              fetch(`${API}/league/${league.league_id}/users`).then(r => r.json())
            ])
          })
      })
      .then(([rostersData, usersData]) => {
        const userMap = {}
        usersData.forEach(u => userMap[u.user_id] = u)
        setRosters(rostersData)
        setUsers(userMap)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  if (loading) return <p style={{ padding: '20px' }}>Loading teams...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>
  if (rosters.length === 0) return <p style={{ padding: '20px' }}>No rosters found.</p>

  const sorted = [...rosters].sort((a, b) => b.settings.wins - a.settings.wins)

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>League Standings</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Rank</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team</th>
            <th style={{ padding: '10px', textAlign: 'center' }}>W</th>
            <th style={{ padding: '10px', textAlign: 'center' }}>L</th>
            <th style={{ padding: '10px', textAlign: 'center' }}>PF</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((roster, i) => {
            const user = users[roster.owner_id]
            return (
              <tr key={roster.roster_id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '10px' }}>{i + 1}</td>
                <td style={{ padding: '10px' }}>{user?.display_name || 'Unknown'}</td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{roster.settings.wins}</td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{roster.settings.losses}</td>
                <td style={{ padding: '10px', textAlign: 'center' }}>{roster.settings.fpts}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
