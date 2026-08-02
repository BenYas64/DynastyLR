import { useEffect, useMemo, useState } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'

const API = 'https://api.dynastylr.site'

const STAT_COLUMNS = [
  ['week', 'Week'],
  ['pts_ppr', 'PPR'],
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

export default function PlayerDetail() {
  const { playerId } = useParams()
  const location = useLocation()
  const backTo = location.state?.backTo || '/players'
  const backLabel = location.state?.backLabel || 'Back to Players'
  const [player, setPlayer] = useState(null)
  const [stats, setStats] = useState([])
  const [season, setSeason] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setSeason('all')
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

  const seasons = useMemo(
    () => [...new Set(stats.map(s => s.season))].sort((a, b) => b - a),
    [stats]
  )

  const filteredStats = season === 'all' ? stats : stats.filter(s => s.season === Number(season))

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
      {seasons.length === 0 ? (
        <p>No stats available.</p>
      ) : (
        <>
          <select
            value={season}
            onChange={e => setSeason(e.target.value)}
            style={{ padding: '6px', marginBottom: '10px', fontSize: '14px' }}
          >
            <option value="all">All Seasons</option>
            {seasons.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f0f0f0' }}>
                  {season === 'all' && <th style={{ padding: '8px', textAlign: 'left' }}>Season</th>}
                  {STAT_COLUMNS.map(([key, label]) => (
                    <th key={key} style={{ padding: '8px', textAlign: 'left' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredStats.map(s => (
                  <tr key={`${s.season}-${s.week}`} style={{ borderBottom: '1px solid #ddd' }}>
                    {season === 'all' && <td style={{ padding: '8px' }}>{s.season}</td>}
                    {STAT_COLUMNS.map(([key]) => (
                      <td key={key} style={{ padding: '8px' }}>{s[key] ?? '-'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
