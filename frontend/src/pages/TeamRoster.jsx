import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import RosterSlots from '../components/RosterSlots.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'

const API = 'https://api.dynastylr.site'

export default function TeamRoster() {
  const { leagueId, rosterId } = useParams()
  const [roster, setRoster] = useState(null)
  const [owner, setOwner] = useState(null)
  const [players, setPlayers] = useState({})
  const [rosterPositions, setRosterPositions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${leagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/league/${leagueId}/users`).then(r => r.json()),
      fetch(`${API}/league/${leagueId}`).then(r => r.json())
    ]).then(([rosters, users, league]) => {
      const myRoster = rosters.find(r => String(r.roster_id) === rosterId)
      if (!myRoster) throw new Error('Roster not found')
      const userMap = {}
      users.forEach(u => { userMap[u.user_id] = u })

      setRoster(myRoster)
      setOwner(userMap[myRoster.owner_id] || null)
      setRosterPositions(league?.roster_positions ? JSON.parse(league.roster_positions) : null)

      const ids = myRoster.players || []
      if (ids.length === 0) {
        setPlayers({})
        setLoading(false)
        return
      }
      return fetch(`${API}/players/by-ids?ids=${ids.join(',')}`)
        .then(r => r.json())
        .then(playersData => {
          const playersMap = {}
          playersData.forEach(p => { playersMap[p.player_id] = p })
          setPlayers(playersMap)
          setLoading(false)
        })
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
      <h2 style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {teamAvatarUrl(owner) && (
          <img
            src={teamAvatarUrl(owner)}
            alt=""
            style={{ width: '32px', height: '32px', borderRadius: '50%' }}
          />
        )}
        {teamName(owner)}
      </h2>
      <p>Record: {roster.settings.wins}W - {roster.settings.losses}L</p>
      <p>Points For: {roster.settings.fpts}</p>
      <RosterSlots
        rosterPositions={rosterPositions}
        starters={roster.starters}
        allPlayers={roster.players}
        playersMap={players}
        backTo={`/league/${leagueId}/roster/${rosterId}`}
        backLabel="Back to Roster"
      />
    </div>
  )
}
