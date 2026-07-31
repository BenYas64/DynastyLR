import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

const API = 'https://api.dynastylr.site'

export default function PlayerDetail() {
  const { playerId } = useParams()
  const [player, setPlayer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${API}/players/${playerId}`)
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Player not found' : 'Failed to load player')
        return r.json()
      })
      .then(data => {
        setPlayer(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [playerId])

  if (loading) return <p style={{ padding: '20px' }}>Loading player...</p>
  if (error) return (
    <div style={{ padding: '20px' }}>
      <p style={{ color: 'red' }}>Error: {error}</p>
      <Link to="/players">&larr; Back to Players</Link>
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
      <Link to="/players">&larr; Back to Players</Link>
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
    </div>
  )
}
