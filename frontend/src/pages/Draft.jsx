import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { usePlayerModal } from '../PlayerModalContext.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'

const API = 'https://api.dynastylr.site'

export default function Draft() {
  const { selectedLeagueId } = useAccount()
  const { openPlayer } = usePlayerModal()
  const [draftOptions, setDraftOptions] = useState([])
  const [selectedKey, setSelectedKey] = useState(null)
  const [rostersByLeague, setRostersByLeague] = useState({})
  const [usersByLeague, setUsersByLeague] = useState({})
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // One dropdown entry per actual draft across every season in this
  // league's history, not per season - a season can have more than one
  // draft (startup/rookie/expansion). A draft Sleeper shows but that has
  // no real picks behind it (seen in practice - an abandoned/duplicate
  // draft shell) never makes it into draft_picks in the first place, so
  // it's naturally absent here without needing to filter it out.
  useEffect(() => {
    if (!selectedLeagueId) return
    setLoading(true)
    setError(null)
    fetch(`${API}/league/${selectedLeagueId}/history`)
      .then(r => r.json())
      .then(history => Promise.all(history.map(h =>
        Promise.all([
          fetch(`${API}/league/${h.league_id}/draft`).then(r => r.json()),
          fetch(`${API}/league/${h.league_id}/rosters`).then(r => r.json()),
          fetch(`${API}/league/${h.league_id}/users`).then(r => r.json()),
        ]).then(([picks, rosters, users]) => ({ season: h.season, leagueId: h.league_id, picks, rosters, users }))
      )))
      .then(seasons => {
        const options = []
        const rostersMap = {}
        const usersMap = {}
        const allPlayerIds = new Set()

        seasons.forEach(({ season, leagueId, picks, rosters, users }) => {
          rostersMap[leagueId] = rosters
          const userMap = {}
          users.forEach(u => userMap[u.user_id] = u)
          usersMap[leagueId] = userMap

          const byDraft = {}
          picks.forEach(p => {
            if (!byDraft[p.draft_id]) byDraft[p.draft_id] = []
            byDraft[p.draft_id].push(p)
            if (p.player_id) allPlayerIds.add(p.player_id)
          })
          Object.entries(byDraft).forEach(([draftId, draftPicks]) => {
            const rounds = draftPicks.reduce((max, p) => Math.max(max, p.round || 0), 0)
            options.push({
              key: `${leagueId}:${draftId}`,
              leagueId,
              season,
              rounds,
              picks: [...draftPicks].sort((a, b) => a.pick_no - b.pick_no),
            })
          })
        })

        // Newest season first; within a season, most recently created
        // draft first (draft_id is a Sleeper snowflake id, so it sorts
        // chronologically) - the key embeds draft_id after the colon.
        options.sort((a, b) => b.season - a.season || b.key.localeCompare(a.key))

        setRostersByLeague(rostersMap)
        setUsersByLeague(usersMap)
        setDraftOptions(options)
        setSelectedKey(prev => options.some(o => o.key === prev) ? prev : (options[0]?.key || null))

        const ids = [...allPlayerIds]
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
  }, [selectedLeagueId])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view draft results.
    </p>
  )

  const draftSelect = draftOptions.length > 0 && (
    <select
      value={selectedKey || ''}
      onChange={e => setSelectedKey(e.target.value)}
      style={{ padding: '8px', fontSize: '16px', marginBottom: '20px' }}
    >
      {draftOptions.map(o => <option key={o.key} value={o.key}>{o.season} - {o.rounds} Rounds</option>)}
    </select>
  )

  if (loading) return <div style={{ padding: '20px' }}>{draftSelect}<p>Loading draft...</p></div>
  if (error) return <div style={{ padding: '20px' }}>{draftSelect}<p style={{ color: 'red' }}>Error: {error}</p></div>
  if (draftOptions.length === 0) return <div style={{ padding: '20px' }}>{draftSelect}<p>No draft results found for this league.</p></div>

  const selected = draftOptions.find(o => o.key === selectedKey) || draftOptions[0]
  const rosters = rostersByLeague[selected.leagueId] || []
  const users = usersByLeague[selected.leagueId] || {}

  const rosterMap = {}
  rosters.forEach(r => { rosterMap[r.roster_id] = r })

  const teamFor = (rosterId) => {
    if (rosterId == null) return { name: 'TBD', avatar: null }
    const roster = rosterMap[rosterId]
    const user = roster ? users[roster.owner_id] : null
    return { name: roster ? teamName(user) : `Roster ${rosterId}`, avatar: teamAvatarUrl(user) }
  }

  const byRound = {}
  selected.picks.forEach(p => {
    if (!byRound[p.round]) byRound[p.round] = []
    byRound[p.round].push(p)
  })

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Draft Results</h2>
      {draftSelect}

      <h3>{selected.season} &middot; {selected.rounds}-Round Draft &middot; {selected.picks.length} Picks</h3>
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
}
