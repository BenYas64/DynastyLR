import { useEffect, useMemo, useState, Fragment } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'

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

export default function PlayerDetail() {
  const { playerId } = useParams()
  const location = useLocation()
  const backTo = location.state?.backTo || '/players'
  const backLabel = location.state?.backLabel || 'Back to Players'
  const [player, setPlayer] = useState(null)
  const [stats, setStats] = useState([])
  const [expandedSeason, setExpandedSeason] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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

  const seasonTotals = useMemo(() => {
    const bySeason = {}
    for (const s of stats) {
      if (!bySeason[s.season]) {
        bySeason[s.season] = { season: s.season, weeks: [] }
        SUM_KEYS.forEach(key => { bySeason[s.season][key] = 0 })
      }
      const totals = bySeason[s.season]
      totals.weeks.push(s)
      SUM_KEYS.forEach(key => { totals[key] += s[key] || 0 })
    }
    return Object.values(bySeason).sort((a, b) => b.season - a.season)
  }, [stats])

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
      {seasonTotals.length === 0 ? (
        <p>No stats available.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>Season</th>
                {SUM_KEYS.map(key => {
                  const label = WEEK_COLUMNS.find(([k]) => k === key)[1]
                  return <th key={key} style={{ padding: '8px', textAlign: 'left' }}>{label}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {seasonTotals.map(t => {
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
                      {SUM_KEYS.map(key => (
                        <td key={key} style={{ padding: '8px' }}>
                          {key === 'pts_ppr' ? t[key].toFixed(2) : t[key]}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={SUM_KEYS.length + 1} style={{ padding: '0 0 12px 20px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                {WEEK_COLUMNS.map(([key, label]) => (
                                  <th key={key} style={{ padding: '6px', textAlign: 'left', color: '#666', fontWeight: 'normal' }}>{label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {t.weeks.map(w => (
                                <tr key={w.week} style={{ borderBottom: '1px solid #eee' }}>
                                  {WEEK_COLUMNS.map(([key]) => (
                                    <td key={key} style={{ padding: '6px' }}>{w[key] ?? '-'}</td>
                                  ))}
                                </tr>
                              ))}
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
