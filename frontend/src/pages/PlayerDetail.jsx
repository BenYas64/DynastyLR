import { useEffect, useMemo, useState, Fragment } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { useAccount } from '../AccountContext.jsx'

const API = 'https://api.dynastylr.site'

const WEEK_COLUMNS = [
  ['week', 'Week'],
  ['pass_yd', 'Pass Yd'],
  ['pass_td', 'Pass TD'],
  ['pass_int', 'INT'],
  ['rush_att', 'Rush Att'],
  ['rush_yd', 'Rush Yd'],
  ['rush_td', 'Rush TD'],
  ['rec', 'Rec'],
  ['rec_tgt', 'Tgt'],
  ['rec_yd', 'Rec Yd'],
  ['rec_td', 'Rec TD'],
]

const SUM_KEYS = WEEK_COLUMNS.filter(([key]) => key !== 'week').map(([key]) => key)

const CURRENT_SEASON = 2025

// Each stat row has a column per Sleeper stat category (kicking, defense/IDP,
// bonus thresholds, etc.), named the same as the matching scoring_settings
// key, so a league's custom scoring can be computed for any category Sleeper
// tracks.
function leagueScoreForStat(stat, scoringSettings) {
  return Object.keys(scoringSettings).reduce((total, key) => total + (stat[key] || 0) * scoringSettings[key], 0)
}

// Weekly positional rank coloring: must-start / flex-worthy / deep bench /
// waiver-wire tiers, scaled down for QB and TE since leagues typically only
// start 1 of each (vs. 2+ for RB/WR). Background carries the tier; text stays
// white throughout.
const QB_TE_TIERS = [8, 16, 24]
const DEFAULT_TIERS = [12, 24, 36]
const TIER_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626']

function rankColor(rank, position) {
  if (rank == null) return null
  const [tier1, tier2, tier3] = position === 'QB' || position === 'TE' ? QB_TE_TIERS : DEFAULT_TIERS
  if (rank <= tier1) return TIER_COLORS[0]
  if (rank <= tier2) return TIER_COLORS[1]
  if (rank <= tier3) return TIER_COLORS[2]
  return TIER_COLORS[3]
}

export default function PlayerDetail() {
  const { playerId } = useParams()
  const location = useLocation()
  const backTo = location.state?.backTo || '/players'
  const backLabel = location.state?.backLabel || 'Back to Players'
  const { selectedLeagueId } = useAccount()
  const [player, setPlayer] = useState(null)
  const [stats, setStats] = useState([])
  const [expandedSeason, setExpandedSeason] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [weeklyRanks, setWeeklyRanks] = useState({})

  useEffect(() => {
    setLoading(true)
    setError(null)
    setExpandedSeason(null)
    fetch(`${API}/players/${playerId}`)
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Player not found' : 'Failed to load player')
        return r.json()
      })
      .then(data => {
        setPlayer(data.player)
        setStats(data.stats || [])
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [playerId])

  useEffect(() => {
    if (!selectedLeagueId) {
      setSelectedLeague(null)
      return
    }
    fetch(`${API}/league/${selectedLeagueId}`)
      .then(r => r.json())
      .then(setSelectedLeague)
      .catch(() => setSelectedLeague(null))
  }, [selectedLeagueId])

  useEffect(() => {
    setWeeklyRanks({})
  }, [selectedLeagueId, playerId])

  useEffect(() => {
    if (!selectedLeagueId || expandedSeason == null || weeklyRanks[expandedSeason]) return
    fetch(`${API}/league/${selectedLeagueId}/players/${playerId}/weekly-rank/${expandedSeason}`)
      .then(r => r.json())
      .then(ranks => setWeeklyRanks(prev => ({ ...prev, [expandedSeason]: ranks })))
      .catch(() => setWeeklyRanks(prev => ({ ...prev, [expandedSeason]: {} })))
  }, [selectedLeagueId, expandedSeason, playerId, weeklyRanks])

  const scoringSettings = useMemo(() => {
    if (!selectedLeague?.scoring_settings) return null
    try {
      return JSON.parse(selectedLeague.scoring_settings)
    } catch {
      return null
    }
  }, [selectedLeague])

  const seasonTotals = useMemo(() => {
    const bySeason = {}
    for (const s of stats) {
      if (!bySeason[s.season]) {
        bySeason[s.season] = { season: s.season, weeks: [], leaguePts: 0 }
        SUM_KEYS.forEach(key => { bySeason[s.season][key] = 0 })
      }
      const totals = bySeason[s.season]
      const leaguePts = scoringSettings ? leagueScoreForStat(s, scoringSettings) : null
      totals.weeks.push({ ...s, leaguePts })
      totals.leaguePts += leaguePts || 0
      SUM_KEYS.forEach(key => { totals[key] += s[key] || 0 })
    }
    return Object.values(bySeason).sort((a, b) => b.season - a.season)
  }, [stats, scoringSettings])

  if (loading) return <p style={{ padding: '20px' }}>Loading player...</p>
  if (error) return (
    <div style={{ padding: '20px' }}>
      <p style={{ color: 'red' }}>Error: {error}</p>
      <Link to={backTo}>&larr; {backLabel}</Link>
    </div>
  )

  const fields = [
    ['Team', player.team || 'FA'],
    ['Position', player.position],
    ['Age', player.age],
    ['Height', player.height],
    ['Weight', player.weight],
    ['College', player.college],
    ['Years Exp', player.years_exp],
    ['Status', player.status],
    ['Injury Status', player.injury_status || 'Active'],
    ['Injury Body Part', player.injury_body_part],
    ['Injury Notes', player.injury_notes],
    ['Birth Date', player.birth_date],
    ['Birth Place', [player.birth_city, player.birth_state, player.birth_country].filter(Boolean).join(', ')],
    ['Depth Chart', player.depth_chart_position ? `${player.depth_chart_position} #${player.depth_chart_order ?? ''}` : null],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '')

  const earliestSeason = player.years_exp == null
    ? null
    : CURRENT_SEASON - Math.max(player.years_exp - 1, 0)
  const visibleSeasonTotals = earliestSeason == null
    ? seasonTotals
    : seasonTotals.filter(t => t.season >= earliestSeason)

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <Link to={backTo}>&larr; {backLabel}</Link>
      <h2 style={{ marginTop: '10px' }}>{player.full_name}</h2>
      <table style={{ borderCollapse: 'collapse', marginTop: '10px' }}>
        <tbody>
          {fields.map(([label, value]) => (
            <tr key={label} style={{ borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '8px 20px 8px 0', fontWeight: 'bold', color: '#555' }}>{label}</td>
              <td style={{ padding: '8px 0', color: label === 'Injury Status' && value !== 'Active' ? 'red' : 'inherit' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: '30px' }}>Stats</h3>
      {!scoringSettings && (
        <p style={{ color: '#666', fontSize: '14px' }}>
          Sign in and select a league on the Account page to see points using that league's scoring settings.
        </p>
      )}
      {scoringSettings && (
        <p style={{ color: '#666', fontSize: '14px' }}>
          Points below use {selectedLeague.name}'s scoring settings.
        </p>
      )}
      {visibleSeasonTotals.length === 0 ? (
        <p>No stats available.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>Season</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Fantasy Pts</th>
                {SUM_KEYS.map(key => {
                  const label = WEEK_COLUMNS.find(([k]) => k === key)[1]
                  return <th key={key} style={{ padding: '8px', textAlign: 'left' }}>{label}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {visibleSeasonTotals.map(t => {
                const isExpanded = expandedSeason === t.season
                return (
                  <Fragment key={t.season}>
                    <tr
                      onClick={() => setExpandedSeason(isExpanded ? null : t.season)}
                      style={{ borderBottom: '1px solid #ddd', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '8px', fontWeight: 'bold' }}>
                        {isExpanded ? '▾' : '▸'} {t.season}
                      </td>
                      <td style={{ padding: '8px', fontWeight: 'bold' }}>
                        {scoringSettings ? t.leaguePts.toFixed(2) : '-'}
                      </td>
                      {SUM_KEYS.map(key => (
                        <td key={key} style={{ padding: '8px' }}>
                          {key === 'pts_ppr' ? t[key].toFixed(2) : t[key]}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={SUM_KEYS.length + 2} style={{ padding: '0 0 12px 20px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ padding: '6px', textAlign: 'left', color: '#666', fontWeight: 'normal' }}>Fantasy Pts</th>
                                {WEEK_COLUMNS.map(([key, label]) => (
                                  <th key={key} style={{ padding: '6px', textAlign: 'left', color: '#666', fontWeight: 'normal' }}>{label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {t.weeks.map(w => {
                                const rank = weeklyRanks[t.season]?.[w.week]
                                const background = rankColor(rank, player.position)
                                return (
                                  <tr key={w.week} style={{ borderBottom: '1px solid #eee' }}>
                                    <td
                                      style={{ padding: '6px', fontWeight: background ? 'bold' : 'normal', background, color: background ? '#fff' : 'inherit' }}
                                      title={rank != null ? `#${rank} at ${player.position} that week` : undefined}
                                    >
                                      {w.leaguePts != null ? w.leaguePts.toFixed(2) : '-'}
                                    </td>
                                    {WEEK_COLUMNS.map(([key]) => (
                                      <td key={key} style={{ padding: '6px' }}>{w[key] ?? '-'}</td>
                                    ))}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
