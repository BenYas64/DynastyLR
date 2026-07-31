import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API = 'https://api.dynastylr.site'

export default function Players() {
  const navigate = useNavigate()
  const [players, setPlayers] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API}/players`)
      .then(r => r.json())
      .then(data => {
        setPlayers(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  if (loading) return <p style={{ padding: '20px' }}>Loading players...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>

  const filtered = players.filter(p =>
    `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Players ({players.length} total)</h2>
      <input
        type="text"
        placeholder="Search players..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ padding: '8px', width: '300px', marginBottom: '20px', fontSize: '16px' }}
      />
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f0f0f0' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Position</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Team</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Age</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 100).map(p => (
            <tr
              key={p.player_id}
              onClick={() => navigate(`/players/${p.player_id}`)}
              style={{ borderBottom: '1px solid #ddd', cursor: 'pointer' }}
            >
              <td style={{ padding: '10px' }}>{p.full_name}</td>
              <td style={{ padding: '10px' }}>{p.position}</td>
              <td style={{ padding: '10px' }}>{p.team || 'FA'}</td>
              <td style={{ padding: '10px' }}>{p.age}</td>
              <td style={{ padding: '10px', color: p.injury_status ? 'red' : 'green' }}>
                {p.injury_status || 'Active'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 100 && <p>Showing 100 of {filtered.length}. Search to narrow results.</p>}
    </div>
  )
}
