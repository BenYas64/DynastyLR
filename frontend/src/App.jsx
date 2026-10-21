import { useEffect, useState } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import League from './pages/League.jsx'
import LeagueSettings from './pages/LeagueSettings.jsx'
import ScoringSettings from './pages/ScoringSettings.jsx'
import RosterSettings from './pages/RosterSettings.jsx'
import ValueSettings from './pages/ValueSettings.jsx'
import MyTeam from './pages/MyTeam.jsx'
import MyMatchup from './pages/MyMatchup.jsx'
import HeadToHead from './pages/HeadToHead.jsx'
import Draft from './pages/Draft.jsx'
import Players from './pages/Players.jsx'
import Account from './pages/Account.jsx'
import TeamRoster from './pages/TeamRoster.jsx'
import { AccountProvider, useAccount } from './AccountContext.jsx'
import { PlayerModalProvider } from './PlayerModalContext.jsx'
import PlayerDetailModal from './components/PlayerDetailModal.jsx'

const API = 'https://api.dynastylr.site'

function Nav() {
  const { selectedLeagueId } = useAccount()
  const [leagueInfo, setLeagueInfo] = useState(null)

  useEffect(() => {
    if (!selectedLeagueId) {
      setLeagueInfo(null)
      return
    }
    fetch(`${API}/league/${selectedLeagueId}`)
      .then(r => r.json())
      .then(setLeagueInfo)
      .catch(() => setLeagueInfo(null))
  }, [selectedLeagueId])

  const headerLabel = leagueInfo
    ? !leagueInfo.is_current_season && leagueInfo.season
      ? `${leagueInfo.name} (${leagueInfo.season})`
      : leagueInfo.name
    : null

  return (
    <nav style={{ background: '#1a1a2e', padding: '15px', display: 'flex', flexWrap: 'wrap', gap: '12px 20px', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
      <Link to="/" style={{ color: 'white', textDecoration: 'none', fontWeight: 'bold' }}>{headerLabel && <span style={{ color: '#ccc' }}>{headerLabel}</span>}</Link>
      <Link to="/league" style={{ color: '#ccc', textDecoration: 'none' }}>League</Link>
      <Link to="/matchup" style={{ color: '#ccc', textDecoration: 'none' }}>My Matchup</Link>
      <Link to="/head-to-head" style={{ color: '#ccc', textDecoration: 'none' }}>Head-to-Head</Link>
      <Link to="/draft" style={{ color: '#ccc', textDecoration: 'none' }}>Draft</Link>
      <Link to="/league-settings" style={{ color: '#ccc', textDecoration: 'none' }}>League Settings</Link>
      <Link to="/my-team" style={{ color: '#ccc', textDecoration: 'none' }}>My Team</Link>
      <Link to="/players" style={{ color: '#ccc', textDecoration: 'none' }}>Players</Link>
      <Link to="/account" style={{ color: '#ccc', textDecoration: 'none' }}>Account</Link>
    </nav>
  )
}

function AppRoutes() {
  // Keyed by path so a crash on one page doesn't leave every later page
  // stuck behind the same boundary instance - navigating anywhere, even
  // back to the page that just crashed, starts it fresh.
  const location = useLocation()
  return (
    <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/" element={<League />} />
        <Route path="/league" element={<League />} />
        <Route path="/matchup" element={<MyMatchup />} />
        <Route path="/head-to-head" element={<HeadToHead />} />
        <Route path="/draft" element={<Draft />} />
        <Route path="/league/:leagueId/matchup/:week/:rosterId" element={<MyMatchup />} />
        <Route path="/league-settings" element={<LeagueSettings />} />
        <Route path="/league-settings/scoring" element={<ScoringSettings />} />
        <Route path="/league-settings/roster" element={<RosterSettings />} />
        <Route path="/league-settings/value" element={<ValueSettings />} />
        <Route path="/my-team" element={<MyTeam />} />
        <Route path="/players" element={<Players />} />
        <Route path="/account" element={<Account />} />
        <Route path="/league/:leagueId/roster/:rosterId" element={<TeamRoster />} />
      </Routes>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <AccountProvider>
      <PlayerModalProvider>
        <div>
          <Nav />
          <AppRoutes />
          <PlayerDetailModal />
        </div>
      </PlayerModalProvider>
    </AccountProvider>
  )
}

export default App
