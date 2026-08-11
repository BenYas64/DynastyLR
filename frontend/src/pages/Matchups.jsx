import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../AccountContext.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'

const API = 'https://api.dynastylr.site'
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

export default function Matchups() {
  const { selectedLeagueId } = useAccount()
  const navigate = useNavigate()
  const [view, setView] = useState('weekly') // 'weekly' | 'bracket'
  const [week, setWeek] = useState(1)
  const [league, setLeague] = useState(null)
  const [matchups, setMatchups] = useState([])
  const [rosters, setRosters] = useState([])
  const [users, setUsers] = useState({})
  const [winnersBracket, setWinnersBracket] = useState(null)
  const [losersBracket, setLosersBracket] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!selectedLeagueId) return
    setLeague(null)
    setWinnersBracket(null)
    setLosersBracket(null)
    Promise.all([
      fetch(`${API}/league/${selectedLeagueId}`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/rosters`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/users`).then(r => r.json()),
    ]).then(([leagueData, rostersData, usersData]) => {
      const userMap = {}
      usersData.forEach(u => { userMap[u.user_id] = u })
      setLeague(leagueData)
      setRosters(rostersData)
      setUsers(userMap)
    }).catch(err => setError(err.message))
  }, [selectedLeagueId])

  useEffect(() => {
    if (!selectedLeagueId || view !== 'weekly') return
    setLoading(true)
    setError(null)
    fetch(`${API}/league/${selectedLeagueId}/matchups/${week}`)
      .then(r => r.json())
      .then(data => {
        setMatchups(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [selectedLeagueId, week, view])

  useEffect(() => {
    if (!selectedLeagueId || view !== 'bracket' || winnersBracket) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${selectedLeagueId}/bracket/winners`).then(r => r.json()),
      fetch(`${API}/league/${selectedLeagueId}/bracket/losers`).then(r => r.json()),
    ]).then(([winners, losers]) => {
      setWinnersBracket(winners)
      setLosersBracket(losers)
      setLoading(false)
    }).catch(err => {
      setError(err.message)
      setLoading(false)
    })
  }, [selectedLeagueId, view, winnersBracket])

  if (!selectedLeagueId) return (
    <p style={{ padding: '20px' }}>
      Sign in and select a league on the Account page to view matchups.
    </p>
  )

  const rosterMap = {}
  rosters.forEach(r => { rosterMap[r.roster_id] = r })

  const teamFor = (rosterId) => {
    if (rosterId == null) return { name: 'TBD', avatar: null }
    const roster = rosterMap[rosterId]
    const user = roster ? users[roster.owner_id] : null
    return { name: roster ? teamName(user) : `Roster ${rosterId}`, avatar: teamAvatarUrl(user) }
  }

  const isPlayoffWeek = league?.playoff_week_start > 0 && week >= league.playoff_week_start

  // A null matchup_id means Sleeper didn't pair this roster against anyone that
  // week (e.g. non-playoff teams during playoff weeks) - each gets its own group
  // instead of being bundled together under the same "null" key.
  const byMatchupId = {}
  matchups.forEach(m => {
    const key = m.matchup_id != null ? m.matchup_id : `solo-${m.roster_id}`
    if (!byMatchupId[key]) byMatchupId[key] = []
    byMatchupId[key].push(m)
  })
  const pairs = Object.values(byMatchupId)

  const hasBracket = (winnersBracket?.length || 0) + (losersBracket?.length || 0) > 0

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Matchups</h2>

      <div style={{ display: 'inline-flex', border: '1px solid #ccc', borderRadius: '20px', overflow: 'hidden', marginBottom: '20px' }}>
        <button
          onClick={() => setView('weekly')}
          style={{
            padding: '8px 16px', fontSize: '14px', border: 'none', cursor: 'pointer',
            background: filterMode === 'all' ? '#93c5fd' : '#1a1a2e',
            color: filterMode === 'all' ? '#1a1a2e' : '#fff',
          }}
        >
          Weekly
        </button>
        <button
          onClick={() => setView('bracket')}
          style={{
            padding: '8px 16px', fontSize: '14px', border: 'none', cursor: 'pointer',
            background: filterMode === 'all' ? '#93c5fd' : '#1a1a2e',
            color: filterMode === 'all' ? '#1a1a2e' : '#fff',
          }}
        >
          Playoff Bracket
        </button>
      </div>

      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {loading && <p>Loading...</p>}

      {!loading && view === 'weekly' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <select
              value={week}
              onChange={e => setWeek(Number(e.target.value))}
              style={{ padding: '8px', fontSize: '16px' }}
            >
              {WEEKS.map(w => <option key={w} value={w}>Week {w}</option>)}
            </select>
            {isPlayoffWeek && (
              <span style={{ background: '#d97706', color: '#fff', padding: '4px 10px', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold' }}>
                Playoffs
              </span>
            )}
          </div>

          {pairs.length === 0 ? (
            <p>No matchups found for week {week}.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '500px' }}>
              {pairs.map((pair, i) => {
                const [a, b] = pair
                const aWins = b && a.points > b.points
                const bWins = b && b.points > a.points
                return (
                  <div key={i} style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '12px' }}>
                    <MatchupRow
                      team={teamFor(a.roster_id)}
                      points={a.points}
                      winner={aWins}
                      onClick={() => navigate(`/league/${selectedLeagueId}/roster/${a.roster_id}`)}
                    />
                    {b && (
                      <MatchupRow
                        team={teamFor(b.roster_id)}
                        points={b.points}
                        winner={bWins}
                        onClick={() => navigate(`/league/${selectedLeagueId}/roster/${b.roster_id}`)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {!loading && view === 'bracket' && (
        hasBracket ? (
          <>
            <BracketSection title="Winners Bracket" matches={winnersBracket} teamFor={teamFor} leagueId={selectedLeagueId} navigate={navigate} />
            <BracketSection title="Losers Bracket" matches={losersBracket} teamFor={teamFor} leagueId={selectedLeagueId} navigate={navigate} />
          </>
        ) : (
          <p>This league has no playoff bracket.</p>
        )
      )}
    </div>
  )
}

function BracketSection({ title, matches, teamFor, leagueId, navigate }) {
  if (!matches || matches.length === 0) return null

  const byRound = {}
  matches.forEach(m => {
    if (!byRound[m.round]) byRound[m.round] = []
    byRound[m.round].push(m)
  })
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b)

  return (
    <div style={{ marginBottom: '30px' }}>
      <h3>{title}</h3>
      <div style={{ display: 'flex', gap: '30px', overflowX: 'auto', paddingBottom: '10px' }}>
        {rounds.map(round => (
          <div key={round} style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '220px' }}>
            <p style={{ color: '#666', fontWeight: 'bold', margin: 0 }}>Round {round}</p>
            {byRound[round].map(m => (
              <div key={m.match_id} style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '10px' }}>
                <BracketTeamRow
                  team={teamFor(m.roster_id_1)}
                  isWinner={m.winner_roster_id != null && m.winner_roster_id === m.roster_id_1}
                  onClick={() => m.roster_id_1 != null && navigate(`/league/${leagueId}/roster/${m.roster_id_1}`)}
                />
                <BracketTeamRow
                  team={teamFor(m.roster_id_2)}
                  isWinner={m.winner_roster_id != null && m.winner_roster_id === m.roster_id_2}
                  onClick={() => m.roster_id_2 != null && navigate(`/league/${leagueId}/roster/${m.roster_id_2}`)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function BracketTeamRow({ team, isWinner, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0',
        cursor: 'pointer', fontWeight: isWinner ? 'bold' : 'normal', color: isWinner ? '#16a34a' : 'inherit',
      }}
    >
      {team.avatar && (
        <img src={team.avatar} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />
      )}
      {team.name}
    </div>
  )
}

function MatchupRow({ team, points, winner, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: winner ? 'bold' : 'normal' }}>
        {team.avatar && (
          <img
            src={team.avatar}
            alt=""
            style={{ width: '24px', height: '24px', borderRadius: '50%' }}
          />
        )}
        {team.name}
      </div>
      <span style={{ fontWeight: winner ? 'bold' : 'normal', color: winner ? '#16a34a' : 'inherit' }}>
        {points != null ? points.toFixed(2) : '-'}
      </span>
    </div>
  )
}
