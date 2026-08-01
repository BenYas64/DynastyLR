import { Routes, Route, Link } from 'react-router-dom'
import Teams from './pages/Teams.jsx'
import MyTeam from './pages/MyTeam.jsx'
import Players from './pages/Players.jsx'
import PlayerDetail from './pages/PlayerDetail.jsx'
import Account from './pages/Account.jsx'

function App() {
  return (
    <div>
      <nav style={{ background: '#1a1a2e', padding: '15px', display: 'flex', gap: '20px' }}>
        <Link to="/" style={{ color: 'white', textDecoration: 'none', fontWeight: 'bold' }}>🏈 Fantasy</Link>
        <Link to="/teams" style={{ color: '#ccc', textDecoration: 'none' }}>Teams</Link>
        <Link to="/my-team" style={{ color: '#ccc', textDecoration: 'none' }}>My Team</Link>
        <Link to="/players" style={{ color: '#ccc', textDecoration: 'none' }}>Players</Link>
        <Link to="/account" style={{ color: '#ccc', textDecoration: 'none' }}>Account</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Teams />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/my-team" element={<MyTeam />} />
        <Route path="/players" element={<Players />} />
        <Route path="/players/:playerId" element={<PlayerDetail />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </div>
  )
}

export default App
