import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import RosterSlots from '../components/RosterSlots.jsx'

const API = 'https://api.dynastylr.site'
const MIN_WEEK = 1
const MAX_WEEK = 18

export default function MyTeam() {
  const { user, selectedLeagueId } = useAccount()
  const [roster, setRoster] = useState(null)
  const [week, setWeek] = useState(null)
  const [weekData, setWeekData] = useState(null)
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Resolve which roster is mine (for record/points) and default the week
  // toggle to the upcoming/live matchup week, once per league.
  useEffect(() => {
    if (!user || !selectedLeagueId) return
    setWeek(null)
    Promise.all([
      fetch(`${API}/league/${selectedLeagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/current-week`).then(r => r.json()),
    ]).then(([rosters, currentWeek]) => {
      const myRoster = rosters.find(r => r.owner_id === user.user_id)
      setRoster(myRoster || null)
      setWeek(currentWeek.week)
    })
  }, [user, selectedLeagueId])

  const load = () => {
    if (!roster || week == null) return
    setLoading(true)
    setError(null)
    fetch(`${API}/league/${selectedLeagueId}/roster/${roster.roster_id}/week/${week}`)
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to load roster') })
        return r.json()
      })
      .then(data => {
        setWeekData(data)
        const ids = (data.players || []).filter(id => id && id !== '0')
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
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }

  useEffect(load, [roster, week])

  if (!user || !selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view your team.
    </p>
  )
  if (week == null || loading) return <p style={{ padding: '20px' }}>Loading your team...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>
  if (!roster) return <p style={{ padding: '20px' }}>No roster found.</p>

  const hasActual = (id) => !!id && id !== '0' && !!weekData?.week_points && Object.prototype.hasOwnProperty.call(weekData.week_points, id)
  const pointsFor = (id) => {
    if (!id || id === '0') return 0
    if (hasActual(id)) return weekData.week_points[id] ?? 0
    return weekData?.week_projections?.[id] ?? 0
  }
  const weekStarters = (weekData?.starters || []).filter(id => id && id !== '0')
  const weekTotal = weekStarters.reduce((sum, id) => sum + pointsFor(id), 0)
  const weekTotalIsProjected = weekStarters.some(id => !hasActual(id))

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>My Team</h2>
      <p>Record: {roster.settings.wins}W - {roster.settings.losses}L</p>
      <p>Points For: {roster.settings.fpts}</p>
      {weekData && (
        <p>
          Week {week} Points: {weekTotal.toFixed(2)}
          {weekTotalIsProjected && <span style={{ color: '#888' }}> (proj)</span>}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
        <button
          onClick={() => setWeek(w => Math.max(MIN_WEEK, w - 1))}
          disabled={week <= MIN_WEEK}
          style={{ padding: '6px 12px', cursor: week <= MIN_WEEK ? 'not-allowed' : 'pointer' }}
        >
          &larr;
        </button>
        <strong>Week {week}</strong>
        <button
          onClick={() => setWeek(w => Math.min(MAX_WEEK, w + 1))}
          disabled={week >= MAX_WEEK}
          style={{ padding: '6px 12px', cursor: week >= MAX_WEEK ? 'not-allowed' : 'pointer' }}
        >
          &rarr;
        </button>
        {weekData && !weekData.editable && (
          <span style={{ color: '#666', fontSize: '14px' }}>Read-only &ndash; this week has already been played</span>
        )}
      </div>

      {weekData && (
        <RosterSlots
          rosterPositions={weekData.roster_positions}
          starters={weekData.starters}
          allPlayers={weekData.players}
          playersMap={players}
          editable={weekData.editable}
          leagueId={selectedLeagueId}
          userId={user.user_id}
          week={week}
          onMoved={load}
          weekPoints={weekData.week_points}
          weekProjections={weekData.week_projections}
        />
      )}
    </div>
  )
}
