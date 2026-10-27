import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { usePlayerModal } from '../PlayerModalContext.jsx'
import { teamAvatarUrl } from '../teamDisplay.js'
import { CURRENT_SEASON, threeYearDraftScore, parRankColor, pickValue } from '../rookieScore.js'

const API = 'https://api.dynastylr.site'

// Fixed categorical palette, cycled if there are ever more draft classes
// than colors - assigned by season so a year's color never shifts as
// more classes get added over time.
const SEASON_COLORS = ['#dc2626', '#d97706', '#16a34a', '#2563eb', '#9333ea', '#0891b2', '#ec207c']

// Deterministic pseudo-random in [0, 1) from a string - used for chart
// jitter below so a point's wiggle is stable across re-renders (sorting,
// switching a filter) instead of reshuffling every time Math.random()
// would get called again.
function hashToUnit(key) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

// Axis max for the 5x5 grid below - rounded to a clean multiple of 10 so
// the tick labels read as round numbers, but always strictly above the
// all-time best (the +1 before rounding guarantees that even when the
// best already lands exactly on a multiple of 10) and never more than
// one 10-step above it, well inside the "not 20+ above" bound.
function roundAxisMax(best) {
  return Math.ceil((best + 1) / 10) * 10
}

// Shared grid/axes/y=x-line chrome for both charts below - plain inline
// SVG, no charting library (didn't seem worth a new dependency,
// especially one the Pi would need `npm install`-ed, for two simple
// plots). maxX/maxY are passed in rather than computed from whatever's
// plotted so the axes can stay locked to the full unfiltered range even
// when a filter narrows what's actually drawn. `renderMarks(xScale,
// yScale)` returns each chart's own data marks (circles, avatar images,
// whatever) - the only thing that differs between them.
function ChartFrame({ maxX, maxY, xLabel, yLabel, renderMarks }) {
  const width = 700
  const height = 400
  const padding = { left: 55, right: 20, top: 16, bottom: 45 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const xScale = x => padding.left + (x / maxX) * plotW
  const yScale = y => padding.top + plotH - (y / maxY) * plotH

  const TICKS = 5
  const xTicks = Array.from({ length: TICKS + 1 }, (_, i) => maxX * i / TICKS)
  const yTicks = Array.from({ length: TICKS + 1 }, (_, i) => maxY * i / TICKS)

  return (
    <svg width={width} height={height} style={{ background: '#fff', border: '1px solid #ddd', borderRadius: '6px' }}>
      {xTicks.map(v => (
        <g key={`x${v}`}>
          <line x1={xScale(v)} y1={padding.top} x2={xScale(v)} y2={padding.top + plotH} stroke="#eee" />
          <text x={xScale(v)} y={padding.top + plotH + 18} fontSize="11" textAnchor="middle" fill="#666">{v.toFixed(0)}</text>
        </g>
      ))}
      {yTicks.map(v => (
        <g key={`y${v}`}>
          <line x1={padding.left} y1={yScale(v)} x2={padding.left + plotW} y2={yScale(v)} stroke="#eee" />
          <text x={padding.left - 8} y={yScale(v) + 4} fontSize="11" textAnchor="end" fill="#666">{v.toFixed(0)}</text>
        </g>
      ))}
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotH} stroke="#999" />
      <line x1={padding.left} y1={padding.top + plotH} x2={padding.left + plotW} y2={padding.top + plotH} stroke="#999" />
      <text x={padding.left + plotW / 2} y={height - 6} fontSize="12" textAnchor="middle" fill="#333">{xLabel}</text>
      <text
        fontSize="12" textAnchor="middle" fill="#333"
        transform={`translate(14, ${padding.top + plotH / 2}) rotate(-90)`}
      >
        {yLabel}
      </text>
      {(() => {
        // y = m*x from the origin, drawn only out to wherever it exits
        // the plot's own bounds (the two axes don't share a scale, so a
        // slope-1 line doesn't necessarily reach a corner). y = x itself
        // is where a total scored precisely what was expected (Value
        // Added = 0); the unlabeled 0.9x/1.1x lines mark a +/-10% band
        // around it.
        const diagonal = (slope, label) => {
          const exitX = Math.min(maxX, maxY / slope)
          const exitY = slope * exitX
          return (
            <g key={slope}>
              <line
                x1={xScale(0)} y1={yScale(0)} x2={xScale(exitX)} y2={yScale(exitY)}
                stroke="#999" strokeWidth={1} strokeDasharray="5,4"
              />
              {label && (
                <text x={xScale(exitX) - 4} y={yScale(exitY) - 6} fontSize="11" textAnchor="end" fill="#999">
                  {label}
                </text>
              )}
            </g>
          )
        }
        return (
          <>
            {diagonal(0.9, null)}
            {diagonal(1, 'y = x')}
            {diagonal(1.1, null)}
          </>
        )
      })()}
      {renderMarks(xScale, yScale)}
    </svg>
  )
}

function ScatterChart({ points, maxX, maxY, legend, onPointClick }) {
  // Deliberately keyed off `legend` (every scored season, filter or not)
  // rather than `points` - a year filter with zero picks still has real
  // axis bounds from the other years and should render them locked and
  // empty, not fall back to this "nothing at all" message.
  if (legend.length === 0) return <p style={{ color: '#666' }}>No scored picks to chart yet.</p>

  return (
    <div>
      <ChartFrame
        maxX={maxX} maxY={maxY} xLabel="Pick Value" yLabel="3Yr Score"
        renderMarks={(xScale, yScale) => points.map((p, i) => (
          <circle
            key={i}
            cx={xScale(p.x)}
            cy={yScale(p.y + p.jitterY)}
            r={5}
            fill={p.color}
            fillOpacity={0.7}
            stroke="#1a1a2e"
            strokeWidth={0.5}
            style={{ cursor: 'pointer' }}
            onClick={() => onPointClick(p.playerId)}
          >
            <title>{`${p.label} (${p.season}) - Pick Value ${p.x.toFixed(1)}, 3Yr Score ${p.y.toFixed(1)}`}</title>
          </circle>
        ))}
      />
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '8px' }}>
        {legend.map(({ season, color }) => (
          <span key={season} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#666' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, display: 'inline-block' }} />
            {season}
          </span>
        ))}
      </div>
    </div>
  )
}

// One point per user who's made a scored rookie pick - aggregate total
// pick value (x) vs. total 3Yr score (y), marked with their own avatar
// instead of a plain dot. A user with no avatar on file falls back to a
// plain circle with their name's first letter.
function UserAggregateChart({ points, maxX, maxY, onPointClick }) {
  if (points.length === 0) return <p style={{ color: '#666' }}>No scored picks to chart yet.</p>
  const SIZE = 26
  const HALF = SIZE / 2

  return (
    <ChartFrame
      maxX={maxX} maxY={maxY} xLabel="Total Pick Value" yLabel="Total 3Yr Score"
      renderMarks={(xScale, yScale) => points.map((p, i) => {
        const cx = xScale(p.x)
        const cy = yScale(p.y)
        const title = `${p.label} - Total Pick Value ${p.x.toFixed(1)}, Total 3Yr Score ${p.y.toFixed(1)}`
        return (
          <g key={i} style={{ cursor: 'pointer' }} onClick={() => onPointClick(p.userId)}>
            <title>{title}</title>
            {p.avatar ? (
              <image
                href={p.avatar} x={cx - HALF} y={cy - HALF} width={SIZE} height={SIZE}
                style={{ clipPath: 'circle(50%)' }}
              />
            ) : (
              <>
                <circle cx={cx} cy={cy} r={HALF} fill="#9ca3af" />
                <text x={cx} y={cy + 4} fontSize="12" fontWeight="bold" textAnchor="middle" fill="#fff">
                  {(p.label || '?')[0].toUpperCase()}
                </text>
              </>
            )}
            <circle cx={cx} cy={cy} r={HALF} fill="none" stroke="#1a1a2e" strokeWidth={1} />
          </g>
        )
      })}
    />
  )
}

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
  const [yearFilter, setYearFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('all')

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
          // resolve it to the owning user now, using that same season's
          // own rosters/users, rather than carrying every season's
          // rosters around for a render-time lookup.
          const userById = {}
          users.forEach(u => { userById[u.user_id] = u })
          const rosterById = {}
          rosters.forEach(r => { rosterById[r.roster_id] = r })

          seasonPicks.forEach(p => {
            if (p.draft_type === 'rookie' && p.player_id) {
              // picked_by (who actually submitted the pick in Sleeper) can
              // differ from the roster's current owner - a commissioner
              // picking for an absent manager, a departed owner's
              // historical picks, etc. - so it takes priority when
              // present; roster_id's owner is still the fallback for
              // picks where Sleeper never recorded a picker.
              const roster = rosterById[p.roster_id]
              const pickedByUserId = p.picked_by || roster?.owner_id || null
              const user = pickedByUserId ? userById[pickedByUserId] : null
              picks.push({
                season, pickNo: p.pick_no, playerId: p.player_id,
                // user_id is stable across seasons (unlike roster_id, which
                // is only meaningful within its own league/season) - used
                // as the filter dropdown's key, with display_name as the
                // label actually shown.
                userId: pickedByUserId,
                userName: user?.display_name || null,
                userAvatar: user ? teamAvatarUrl(user) : null,
              })
              allPlayerIds.add(p.player_id)
            }
          })
        })

        // picked_by can point to someone who isn't a recorded member of
        // THIS season's league at all (a roster seat changing hands over
        // the years) - /league/{id}/users would never have them, so
        // anyone still unresolved gets one extra global lookup before
        // picks are committed to state.
        const unresolvedUserIds = [...new Set(picks.filter(p => p.userId && !p.userName).map(p => p.userId))]
        const resolveMissingUsers = unresolvedUserIds.length > 0
          ? fetch(`${API}/users/by-ids?ids=${unresolvedUserIds.join(',')}`).then(r => r.json())
          : Promise.resolve([])

        resolveMissingUsers.then(globalUsers => {
          const globalUserById = {}
          globalUsers.forEach(u => { globalUserById[u.user_id] = u })
          picks.forEach(p => {
            if (p.userId && !p.userName) {
              const u = globalUserById[p.userId]
              if (u) {
                p.userName = u.display_name || null
                p.userAvatar = teamAvatarUrl(u)
              }
            }
          })
          setRookiePicks(picks)

          const ids = [...allPlayerIds]
          if (ids.length === 0) {
            setPlayers({})
            setLoading(false)
            return
          }

          // Every season from the earliest rookie draft through the
          // current one - that span covers every
          // (draftSeason..draftSeason+2) window any pick here could need,
          // since a rookie draft happens every year. Each season's PAR
          // has to use THAT season's own league (its own scoring/roster
          // settings), not whichever league the account currently has
          // selected - same reasoning as the draft page.
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
    classRows.forEach(r => {
      r.pickValue = scale != null ? r.basePickValue * scale : null
      r.valueAdded = r.pickValue != null && r.score != null ? r.score - r.pickValue : null
    })
  })

  // Both the chart and the table read from these - the scale factor above
  // is still computed from the FULL class regardless of either filter, so
  // narrowing to one year or one user never changes any pick's value.
  const seasonOptions = [...new Set(rows.map(r => r.season))].sort((a, b) => b - a)
  const userOptions = [...new Map(rows.filter(r => r.userId).map(r => [r.userId, r.userName || r.userId])).entries()]
    .sort((a, b) => (a[1] || '').localeCompare(b[1] || ''))
  const matchesFilters = r =>
    (yearFilter === 'all' || r.season === Number(yearFilter)) &&
    (userFilter === 'all' || r.userId === userFilter)
  const filteredRows = rows.filter(matchesFilters)

  const SORT_KEYS = {
    season: r => r.season,
    pickNo: r => r.pickNo,
    user: r => r.userName || '',
    year1: r => r.yearPar[0] ?? -Infinity,
    year2: r => r.yearPar[1] ?? -Infinity,
    year3: r => r.yearPar[2] ?? -Infinity,
    dynastyValue: r => r.dynastyValue ?? -Infinity,
    score: r => r.score ?? -Infinity,
    pickValue: r => r.pickValue ?? -Infinity,
    valueAdded: r => r.valueAdded ?? -Infinity,
  }
  const sortKey = SORT_KEYS[sortBy] || SORT_KEYS.score
  const sorted = [...filteredRows].sort((a, b) => {
    const ka = sortKey(a)
    const kb = sortKey(b)
    const diff = typeof ka === 'string' ? ka.localeCompare(kb) : ka - kb
    return sortDir === 'asc' ? diff : -diff
  })

  // Keyed off the season NUMBER itself (mod palette length), not its
  // position in seasonOptions - a list index would shift every existing
  // season's color whenever a new draft class gets added, since
  // seasonOptions is sorted newest-first.
  const colorForSeason = season => SEASON_COLORS[season % SEASON_COLORS.length]
  const scoredRows = rows.filter(r => r.pickValue != null && r.score != null)
  const toPoint = r => ({
    x: r.pickValue,
    y: r.score,
    // Display-only nudge (+/-1pt) so same/close-scoring picks don't sit
    // exactly on top of each other - never fed into tooltips, sorting,
    // or the y=x line, only the plotted dot position.
    jitterY: (hashToUnit(r.playerId) - 0.5) * 2,
    season: r.season,
    color: colorForSeason(r.season),
    playerId: r.playerId,
    label: r.player ? `${r.player.first_name} ${r.player.last_name}` : `Player ${r.playerId}`,
  })

  // Axis bounds come from EVERY scored pick regardless of either filter,
  // so switching years or users never rescales the chart - only which
  // points are actually drawn changes.
  const chartMaxX = roundAxisMax(Math.max(...scoredRows.map(r => r.pickValue), 0))
  const chartMaxY = roundAxisMax(Math.max(...scoredRows.map(r => r.score), 0))
  // SVG paints later elements on top of earlier ones, so oldest-first
  // here means the most recent draft class ends up layered above older
  // ones wherever points overlap.
  const chartPoints = scoredRows.filter(matchesFilters).map(toPoint).sort((a, b) => a.season - b.season)
  const scoredSeasons = [...new Set(scoredRows.map(r => r.season))].sort((a, b) => b - a)
  const chartLegend = scoredSeasons.map(s => ({ season: s, color: colorForSeason(s) }))

  // Every user who's made a scored rookie pick, with their pick values
  // and 3Yr scores summed - same locked-axis treatment as the per-pick
  // chart (bounds from every user regardless of the filters, points
  // drawn from just the filtered ones), so e.g. narrowing to one draft
  // class shows each user's total for just that class without the axes
  // jumping around.
  const aggregateByUser = rowsSubset => {
    const totals = {}
    rowsSubset.forEach(r => {
      if (!r.userId) return
      const t = (totals[r.userId] ??= {
        userId: r.userId, label: r.userName || r.userId, avatar: r.userAvatar,
        x: 0, y: 0,
      })
      t.x += r.pickValue
      t.y += r.score
    })
    return Object.values(totals)
  }
  const allUserTotals = aggregateByUser(scoredRows)
  const userChartMaxX = roundAxisMax(Math.max(...allUserTotals.map(u => u.x), 0))
  const userChartMaxY = roundAxisMax(Math.max(...allUserTotals.map(u => u.y), 0))
  const userChartPoints = aggregateByUser(scoredRows.filter(matchesFilters))

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

      <div style={{ display: 'flex', gap: '20px', marginBottom: '16px' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px', color: '#666' }}>Draft class:</span>
          <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={{ padding: '6px', fontSize: '14px' }}>
            <option value="all">All Years</option>
            {seasonOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px', color: '#666' }}>User:</span>
          <select value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{ padding: '6px', fontSize: '14px' }}>
            <option value="all">All Users</option>
            {userOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </div>

      <h3 style={{ marginTop: '24px', marginBottom: '8px' }}>By Pick</h3>
      <div>
        <ScatterChart points={chartPoints} maxX={chartMaxX} maxY={chartMaxY} legend={chartLegend} onPointClick={openPlayer} />
      </div>

      <h3 style={{ marginTop: '24px', marginBottom: '8px' }}>By User</h3>
      <p style={{ color: '#666', fontSize: '14px', marginTop: 0 }}>
        Click a user's avatar to filter the table and both charts to just them.
      </p>
      <div>
        <UserAggregateChart points={userChartPoints} maxX={userChartMaxX} maxY={userChartMaxY} onPointClick={setUserFilter} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
        <thead>
          <tr style={{ background: 'rgb(155, 157, 157)' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Player</th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('season')}>
              Draft{sortArrow('season')}
            </th>
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('user')}>
              Drafted By{sortArrow('user')}
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
            <th style={{ padding: '10px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('valueAdded')}>
              Value Added{sortArrow('valueAdded')}
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
                {row.userAvatar && <img src={row.userAvatar} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />}
                {row.userName || 'Unknown'}
              </td>
              {yearCell(row, 0)}
              {yearCell(row, 1)}
              {yearCell(row, 2)}
              <td style={{ padding: '10px' }}>{row.dynastyValue ?? '-'}</td>
              <td style={{ padding: '10px' }}>{row.score != null ? row.score.toFixed(1) : '...'}</td>
              <td style={{ padding: '10px' }}>{row.pickValue != null ? row.pickValue.toFixed(1) : '...'}</td>
              <td style={{ padding: '10px' }}>{row.valueAdded != null ? row.valueAdded.toFixed(1) : '...'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No rookie drafts found for this league.</p>}
      {rows.length > 0 && filteredRows.length === 0 && <p>No picks match the current filters.</p>}
    </div>
  )
}
