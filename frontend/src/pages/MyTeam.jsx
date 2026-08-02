import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import RosterSlots from '../components/RosterSlots.jsx'

const API = 'https://api.dynastylr.site'

export default function MyTeam() {
  const { user, selectedLeagueId } = useAccount()
  const [roster, setRoster] = useState(null)
  const [rosterPositions, setRosterPositions] = useState(null)
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user || !selectedLeagueId) return
    setLoading(true)
    Promise.all([
      fetch(`${API}/league/${selectedLeagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/players`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}`).then(r => r.json())
    ]).then(([rosters, playersData, league]) => {
      const myRoster = rosters.find(r => r.owner_id === user.user_id)
      const playersMap = {}
      playersData.forEach(p => { playersMap[p.player_id] = p })
      setRoster(myRoster)
      setPlayers(playersMap)
      setRosterPositions(league?.roster_positions ? JSON.parse(league.roster_positions) : null)
      setLoading(false)
    })
  }, [user, selectedLeagueId])

  if (!user || !selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view your team.
    </p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading your team...</p>
  if (!roster) return <p style={{ padding: '20px' }}>No roster found.</p>

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>My Team</h2>
      <p>Record: {roster.settings.wins}W - {roster.settings.losses}L</p>
      <p>Points For: {roster.settings.fpts}</p>
      <RosterSlots
        rosterPositions={rosterPositions}
        starters={roster.starters}
        allPlayers={roster.players}
        playersMap={players}
        backTo="/my-team"
        backLabel="Back to My Team"
      />
    </div>
  )
}
