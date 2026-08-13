import { Link } from 'react-router-dom'

export default function LeagueSettings() {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>League Settings</h2>
      <Link to="/league-settings/scoring" style={{ textDecoration: 'none' }}>
        <button
          style={{
            padding: '10px 24px',
            fontSize: '16px',
            background: '#1a1a2e',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Scoring Settings
        </button>
      </Link>
    </div>
  )
}
