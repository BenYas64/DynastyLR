import { Routes, Route, Link } from 'react-router-dom'
import League from './pages/League.jsx'
import Matchups from './pages/Matchups.jsx'
import LeagueSettings from './pages/LeagueSettings.jsx'
import MyTeam from './pages/MyTeam.jsx'
import Players from './pages/Players.jsx'
import PlayerDetail from './pages/PlayerDetail.jsx'
import Account from './pages/Account.jsx'
import TeamRoster from './pages/TeamRoster.jsx'
import { AccountProvider, useAccount } from './AccountContext.jsx'

function Nav() {
  const { leagues, selectedLeagueId } = useAccount()
  const selectedLeague = leagues.find(l => l.league_id === selectedLeagueId)

  return (
    <nav style={{ background: '#1a1a2e', padding: '15px', display: 'flex', gap: '20px', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
      <Link to="/" style={{ color: 'white', textDecoration: 'none', fontWeight: 'bold' }}>{selectedLeague && <span style={{ color: '#ccc' }}>{selectedLeague.name}</span>}</Link>
      <Link to="/league" style={{ color: '#ccc', textDecoration: 'none' }}>League</Link>
      <Link to="/matchups" style={{ color: '#ccc', textDecoration: 'none' }}>Matchups</Link>
      <Link to="/league-settings" style={{ color: '#ccc', textDecoration: 'none' }}>League Settings</Link>
      <Link to="/my-team" style={{ color: '#ccc', textDecoration: 'none' }}>My Team</Link>
      <Link to="/players" style={{ color: '#ccc', textDecoration: 'none' }}>Players</Link>
      <Link to="/account" style={{ color: '#ccc', textDecoration: 'none' }}>Account</Link>
    </nav>
  )
}

function App() {
  return (
    <AccountProvider>
      <div>
        <Nav />
        <Routes>
          <Route path="/" element={<League />} />
          <Route path="/league" element={<League />} />
          <Route path="/matchups" element={<Matchups />} />
          <Route path="/league-settings" element={<LeagueSettings />} />
          <Route path="/my-team" element={<MyTeam />} />
          <Route path="/players" element={<Players />} />
          <Route path="/players/:playerId" element={<PlayerDetail />} />
          <Route path="/account" element={<Account />} />
          <Route path="/league/:leagueId/roster/:rosterId" element={<TeamRoster />} />
        </Routes>
      </div>
    </AccountProvider>
  )
}

export default App
