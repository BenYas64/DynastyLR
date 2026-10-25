import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { usePlayerModal } from '../PlayerModalContext.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'
import { CURRENT_SEASON, threeYearDraftScore, parRankColor, pickValue } from '../rookieScore.js'

const API = 'https://api.dynastylr.site'

export default function RookieDraftAnalytics() {
  const { selectedLeagueId } = useAccount()
  const { openPlayer } = usePlayerModal()
  const [rookiePicks, setRookiePicks] = useState([])
  const [players, setPlayers] = useState({})
  const [rookiePar, setRookiePar] = useState({})
  // { [season]: { [player_id]: overallRank } } - same overall PAR rank
  // (across every PAR-eligible position) used to color the draft page's
  // PAR badges.
  const [rookieRank, setRookieRank] = useState({})
  const [rookieValues, setRookieValues] = useState({})
  const [currentNflWeek, setCurrentNflWeek] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sortBy, setSortBy] = useState('score')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    fetch(`${API}/current-week`)
      .then(r => r.json())
      .then(d => setCurrentNflWeek(d.week))
      .catch(() => {})
  }, [])

  // Every rookie-draft pick across this league's full history, not just
  // the current season - same draft_type signal (Sleeper's own
  // settings.player_type == 1, see sync_drafts.py) used on the draft page.
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
        const picks = []
        const allPlayerIds = new Set()
        const seasonToLeagueId = {}
        seasons.forEach(({ season, leagueId, picks: seasonPicks, rosters, users }) => {
          seasonToLeagueId[season] = leagueId

          // roster_id is only meaningful within its own season's league -
          // resolve it to a team name now, using that same season's own
          // rosters/users, rather than carrying every season's rosters
          // around for a render-time lookup.
          const userById = {}
          users.forEach(u => { userById[u.user_id] = u })
          const rosterById = {}
          rosters.forEach(r => { rosterById[r.roster_id] = r })

          seasonPicks.forEach(p => {
            if (p.draft_type === 'rookie' && p.player_id) {
              const roster = rosterById[p.roster_id]
              const user = roster ? userById[roster.owner_id] : null
              picks.push({
                season, pickNo: p.pick_no, playerId: p.player_id,
                team: roster ? teamName(user) : null,
                teamAvatar: roster ? teamAvatarUrl(user) : null,
              })
              allPlayerIds.add(p.player_id)
            }
          })
        })
        setRookiePicks(picks)

        const ids = [...allPlayerIds]
        if (ids.length === 0) {
          setPlayers({})
          setLoading(false)
          return
        }

        // Every season from the earliest rookie draft through the current
        // one - that span covers every (draftSeason..draftSeason+2) window
        // any pick here could need, since a rookie draft happens every year.
        // Each season's PAR has to use THAT season's own league (its own
        // scoring/roster settings), not whichever league the account
        // currently has selected - same reasoning as the draft page.
        const earliestSeason = Math.min(...picks.map(p => p.season))
        const parSeasons = []
        for (let s = earliestSeason; s <= CURRENT_SEASON; s++) {
          if (seasonToLeagueId[s]) parSeasons.push(s)
        }

        Promise.all([
          fetch(`${API}/players/by-ids?ids=${ids.join(',')}`).then(r => r.json()),
          Promise.all(parSeasons.map(season =>
            fetch(`${API}/league/${seasonToLeagueId[season]}/players/points-above-replacement-totals/${season}?ids=${ids.join(',')}`)
              .then(r => r.json())
              .then(totals => ({ season, totals }))
          )),
          Promise.all(parSeasons.map(season =>
            fetch(`${API}/league/${seasonToLeagueId[season]}/players/points-above-replacement-rank/${season}?ids=${ids.join(',')}`)
              .then(r => r.json())
              .then(ranks => ({ season, ranks }))
          )),
          selectedLeagueId
            ? fetch(`${API}/players/values?ids=${ids.join(',')}&league_id=${selectedLeagueId}`).then(r => r.json())
            : Promise.resolve({}),
        ]).then(([playersData, parResults, rankResults, values]) => {
          const playersMap = {}
          playersData.forEach(p => playersMap[p.player_id] = p)
          setPlayers(playersMap)

          const parMap = {}
          parResults.forEach(({ season, totals }) => { parMap[season] = totals })
          setRookiePar(parMap)

          const rankMap = {}
          rankResults.forEach(({ season, ranks }) => { rankMap[season] = ranks })
          setRookieRank(rankMap)

          setRookieValues(values)
          setLoading(false)
        })
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [selectedLeagueId])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view rookie draft analytics.
    </p>
  )

  if (loading) return <p style={{ padding: '20px' }}>Loading rookie draft analytics...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>

  const rows = rookiePicks.map(pick => {
    const years = [pick.season, pick.season + 1, pick.season + 2]
    return {
      ...pick,
      player: players[pick.playerId],
      score: threeYearDraftScore(rookiePar, rookieValues, currentNflWeek, pick.season, pick.playerId),
      dynastyValue: rookieValues[pick.playerId]?.dynasty_value,
      yearPar: years.map(year => rookiePar[year]?.[pick.playerId]),
      yearRank: years.map(year => rookieRank[year]?.[pick.playerId]),
      basePickValue: pickValue(pick.pickNo),
    }
  })

  // Pick values stay proportional to the base curve (pick 1 is always
  // twice pick 8, no matter the year) but get uniformly scaled per draft
  // class so that class's pick values sum to exactly that class's total
  // 3Yr Score - a class with a lot of combined value gets inflated pick
  // values relative to the base curve, a weak class gets deflated ones.
  // Needs every pick in the class scored before it means anything, so a
  // class with any pick still loading shows '...' across the board.
  const rowsBySeason = {}
  rows.forEach(r => {
    (rowsBySeason[r.season] ??= []).push(r)
  })
  Object.values(rowsBySeason).forEach(classRows => {
    const allScored = classRows.every(r => r.score != null)
    const totalBase = classRows.reduce((sum, r) => sum + r.basePickValue, 0)
    const totalScore = classRows.reduce((sum, r) => sum + r.score, 0)
    const scale = allScored && totalBase > 0 ? totalScore / totalBase : null
    classRows.forEach(r => { r.pickValue = scale != null ? r.basePickValue * scale : null })
  })

  const SORT_KEYS = {
    season: r => r.season,
    pickNo: r => r.pickNo,
    team: r => r.team || '',
    year1: r => r.yearPar[0] ?? -Infinity,
    year2: r => r.yearPar[1] ?? -Infinity,
    year3: r => r.yearPar[2] ?? -Infinity,
    dynastyValue: r => r.dynastyValue ?? -Infinity,
    score: r => r.score ?? -Infinity,
    pickValue: r => r.pickValue ?? -Infinity,
  }
  const sortKey = SORT_KEYS[sortBy] || SORT_KEYS.score
  const sorted = [...rows].sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    const diff = typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb
    return sortDir === 'asc' ? diff : -diff
  })

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }
  const sortArrow = (field) => sortBy === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  // Each row's "year 1/2/3" is relative to ITS OWN draft season, not a
  // shared absolute year like the draft page's columns - a season past
  // CURRENT_SEASON hasn't happened at all yet ('-'), one that has but
  // whose PAR hasn't loaded shows '...' rather than a wrong placeholder.
  const yearCell = (row, i) => {
    const year = row.season + i
    const total = row.yearPar[i]
    const rank = row.yearRank[i]
    const background = parRankColor(rank)
    const label = year > CURRENT_SEASON ? '-' : (total != null ? total.toFixed(1) : '...')
    return (
      <td style={{ padding: '10px' }}>
        <span
          title={rank != null ? `${total.toFixed(1)} PAR, rank #${rank} overall, ${year}` : `${year}`}
          style={{ color: '#fff', background, padding: background ? '2px 6px' : 0, borderRadius: '4px' }}
        >
          {label}
        </span>
      </td>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Rookie Draft Analytics</h2>
      <p style={{ color: '#666', fontSize: '14px' }}>
        Every rookie-draft pick in this league's history ({rows.length} picks). 3Yr Score averages a player's
        first 3 seasons' PAR, filling in any season not fully played yet from their current dynasty value.
        Pick Value follows a fixed curve by pick number (pick 1 is always twice pick 8) scaled per draft
        class so that class's pick values add up to its total 3Yr Score - a stronger class's picks are worth
        more than the same slot in a weaker one.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
        <thead>
          <tr style={{ background: 'rgb(155, 157, 157)' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Player</th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('season')}>
              Draft{sortArrow('season')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('team')}>
              Drafted By{sortArrow('team')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('year1')}>
              Year 1 PAR{sortArrow('year1')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('year2')}>
              Year 2 PAR{sortArrow('year2')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('year3')}>
              Year 3 PAR{sortArrow('year3')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('dynastyValue')}>
              Dynasty Value{sortArrow('dynastyValue')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('score')}>
              3Yr Score{sortArrow('score')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('pickValue')}>
              Pick Value{sortArrow('pickValue')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr
              key={`${row.season}:${row.pickNo}`}
              onClick={() => openPlayer(row.playerId)}
              style={{ borderBottom: '1px solid #ddd', cursor: 'pointer' }}
            >
              <td style={{ padding: '10px', fontWeight: 'bold' }}>
                {row.player ? `${row.player.first_name} ${row.player.last_name} - ${row.player.position}` : `Player ${row.playerId}`}
              </td>
              <td style={{ padding: '10px' }}>{row.season} Pick {row.pickNo}</td>
              <td style={{ padding: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {row.teamAvatar && <img src={row.teamAvatar} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />}
                {row.team || 'Unknown'}
              </td>
              {yearCell(row, 0)}
              {yearCell(row, 1)}
              {yearCell(row, 2)}
              <td style={{ padding: '10px' }}>{row.dynastyValue ?? '-'}</td>
              <td style={{ padding: '10px' }}>{row.score != null ? row.score.toFixed(1) : '...'}</td>
              <td style={{ padding: '10px' }}>{row.pickValue != null ? row.pickValue.toFixed(1) : '...'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No rookie drafts found for this league.</p>}
    </div>
  )
}
