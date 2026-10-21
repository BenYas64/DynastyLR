import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { usePlayerModal } from '../PlayerModalContext.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'

const API = 'https://api.dynastylr.site'

export default function Draft() {
  const { selectedLeagueId } = useAccount()
  const { openPlayer } = usePlayerModal()
  const [history, setHistory] = useState([])
  const [targetLeagueId, setTargetLeagueId] = useState(null)
  const [picks, setPicks] = useState([])
  const [rosters, setRosters] = useState([])
  const [users, setUsers] = useState({})
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Every season this league has had a draft in - lets the year dropdown
  // switch to a past season's own league_id, since rosters/ownership/draft
  // data are all scoped per-season just like everywhere else in the app.
  useEffect(() => {
    if (!selectedLeagueId) return
    setTargetLeagueId(selectedLeagueId)
    fetch(`${API}/league/${selectedLeagueId}/history`)
      .then(r => r.json())
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [selectedLeagueId])

  useEffect(() => {
    if (!targetLeagueId) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${targetLeagueId}/draft`).then(r => r.json()),
      fetch(`${API}/league/${targetLeagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/league/${targetLeagueId}/users`).then(r => r.json()),
    ]).then(([picksData, rostersData, usersData]) => {
      const userMap = {}
      usersData.forEach(u => userMap[u.user_id] = u)
      setPicks(picksData)
      setRosters(rostersData)
      setUsers(userMap)

      const ids = [...new Set(picksData.map(p => p.player_id).filter(Boolean))]
      if (ids.length === 0) {
        setPlayers({})
        setLoading(false)
        return
      }
      return fetch(`${API}/players/by-ids?ids=${ids.join(',')}`)
        .then(r => r.json())
        .then(playersData => {
          const playersMap = {}
          playersData.forEach(p => playersMap[p.player_id] = p)
          setPlayers(playersMap)
          setLoading(false)
        })
    }).catch(err => {
      setError(err.message)
      setLoading(false)
    })
  }, [targetLeagueId])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view draft results.
    </p>
  )

  const yearSelect = history.length > 1 && (
    <select
      value={targetLeagueId || ''}
      onChange={e => setTargetLeagueId(e.target.value)}
      style={{ padding: '8px', fontSize: '16px', marginBottom: '20px' }}
    >
      {history.map(h => <option key={h.league_id} value={h.league_id}>{h.season}</option>)}
    </select>
  )

  if (loading) return <div style={{ padding: '20px' }}>{yearSelect}<p>Loading draft...</p></div>
  if (error) return <div style={{ padding: '20px' }}>{yearSelect}<p style={{ color: 'red' }}>Error: {error}</p></div>
  if (picks.length === 0) return <div style={{ padding: '20px' }}>{yearSelect}<p>No draft results found for this season.</p></div>

  const rosterMap = {}
  rosters.forEach(r => { rosterMap[r.roster_id] = r })

  const teamFor = (rosterId) => {
    if (rosterId == null) return { name: 'TBD', avatar: null }
    const roster = rosterMap[rosterId]
    const user = roster ? users[roster.owner_id] : null
    return { name: roster ? teamName(user) : `Roster ${rosterId}`, avatar: teamAvatarUrl(user) }
  }

  // A league can have more than one draft (e.g. a startup draft and
  // separate annual rookie drafts) - the backend already orders by
  // draft_id then pick_no, so grouping preserves that order.
  const byDraft = {}
  picks.forEach(p => {
    if (!byDraft[p.draft_id]) byDraft[p.draft_id] = []
    byDraft[p.draft_id].push(p)
  })

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Draft Results</h2>
      {yearSelect}

      {Object.entries(byDraft).map(([draftId, draftPicks]) => {
        const rounds = draftPicks.reduce((max, p) => Math.max(max, p.round || 0), 0)
        const byRound = {}
        draftPicks.forEach(p => {
          if (!byRound[p.round]) byRound[p.round] = []
          byRound[p.round].push(p)
        })

        return (
          <div key={draftId} style={{ marginBottom: '30px' }}>
            <h3>{rounds}-Round Draft &middot; {draftPicks.length} Picks</h3>
            {Object.keys(byRound).map(Number).sort((a, b) => a - b).map(round => (
              <div key={round} style={{ marginBottom: '16px' }}>
                <p style={{ color: '#666', fontWeight: 'bold', margin: '0 0 6px' }}>Round {round}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '600px' }}>
                  {byRound[round].map(pick => {
                    const player = players[pick.player_id]
                    const team = teamFor(pick.roster_id)
                    return (
                      <div
                        key={pick.pick_no}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #ddd', borderRadius: '6px', padding: '8px 12px' }}
                      >
                        <span style={{ color: '#666', width: '36px' }}>{pick.pick_no}.</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '180px' }}>
                          {team.avatar && <img src={team.avatar} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />}
                          <span>{team.name}</span>
                        </div>
                        <span
                          onClick={() => player && openPlayer(pick.player_id)}
                          style={{ cursor: player ? 'pointer' : 'default', fontWeight: 'bold' }}
                        >
                          {player ? `${player.first_name} ${player.last_name} - ${player.position} - ${player.team || 'FA'}` : `Player ${pick.player_id}`}
                        </span>
                        {pick.is_keeper && (
                          <span style={{ background: '#d97706', color: '#fff', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                            Keeper
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
