import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import RosterSlots from '../components/RosterSlots.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'
const MIN_WEEK = 1
const MAX_WEEK = 18

export default function TeamRoster() {
  const { leagueId, rosterId } = useParams()
  const { user } = useAccount()
  const [roster, setRoster] = useState(null)
  const [owner, setOwner] = useState(null)
  const [week, setWeek] = useState(null)
  const [weekData, setWeekData] = useState(null)
  const [players, setPlayers] = useState({})
  const [futurePicks, setFuturePicks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setWeek(null)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${leagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/league/${leagueId}/users`).then(r => r.json()),
      fetch(`${API}/current-week`).then(r => r.json()),
      fetch(`${API}/league/${leagueId}/roster/${rosterId}/future-picks`).then(r => r.json()),
    ]).then(([rosters, users, currentWeek, picks]) => {
      const myRoster = rosters.find(r => String(r.roster_id) === rosterId)
      if (!myRoster) throw new Error('Roster not found')
      const userMap = {}
      users.forEach(u => { userMap[u.user_id] = u })

      setRoster(myRoster)
      setOwner(userMap[myRoster.owner_id] || null)
      setFuturePicks(picks)
      setWeek(currentWeek.week)
    }).catch(err => {
      setError(err.message)
      setLoading(false)
    })
  }, [leagueId, rosterId])

  const load = () => {
    if (week == null) return
    setLoading(true)
    setError(null)
    fetch(`${API}/league/${leagueId}/roster/${rosterId}/week/${week}`)
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

  useEffect(load, [leagueId, rosterId, week])

  const isOwner = !!user && roster?.owner_id === user.user_id

  if (week == null || loading) return <p style={{ padding: '20px' }}>Loading roster...</p>
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
          editable={isOwner && weekData.editable}
          leagueId={leagueId}
          userId={user?.user_id}
          week={week}
          onMoved={load}
          futurePicks={futurePicks}
        />
      )}
    </div>
  )
}
