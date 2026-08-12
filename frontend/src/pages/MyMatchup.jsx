import { useEffect, useState } from 'react'
import { useAccount } from '../AccountContext.jsx'
import { usePlayerModal } from '../PlayerModalContext.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'
import { headshotUrl, onHeadshotError } from '../playerHeadshot.js'

const API = 'https://api.dynastylr.site'

const SLOT_COLORS = {
  QB: '#d32f2f',
  RB: '#2e7d32',
  WR: '#1976d2',
  TE: '#d26019',
  FLEX: '#7b1fa2',
  SUPER_FLEX: '#d32f2f',
}

const SLOT_LABELS = {
  SUPER_FLEX: 'SFLX',
}

export default function MyMatchup() {
  const { user, selectedLeagueId } = useAccount()
  const { openPlayer } = usePlayerModal()
  const [data, setData] = useState(null)
  const [users, setUsers] = useState({})
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user || !selectedLeagueId) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API}/league/${selectedLeagueId}/matchup/current?user_id=${user.user_id}`).then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to load matchup') })
        return r.json()
      }),
      fetch(`${API}/league/${selectedLeagueId}/users`).then(r => r.json()),
    ]).then(([matchupData, usersData]) => {
      setData(matchupData)
      const userMap = {}
      usersData.forEach(u => { userMap[u.user_id] = u })
      setUsers(userMap)

      const ids = new Set()
      ;[matchupData.my_roster, matchupData.opp_roster].forEach(r => {
        (r?.starters || []).forEach(id => { if (id && id !== '0') ids.add(id) })
      })
      if (ids.size === 0) {
        setPlayers({})
        setLoading(false)
        return
      }
      return fetch(`${API}/players/by-ids?ids=${[...ids].join(',')}`)
        .then(r => r.json())
        .then(playersData => {
          const map = {}
          playersData.forEach(p => { map[p.player_id] = p })
          setPlayers(map)
          setLoading(false)
        })
    }).catch(err => {
      setError(err.message)
      setLoading(false)
    })
  }, [user, selectedLeagueId])

  if (!user || !selectedLeagueId) return (
    <p style={{ padding: '20px' }}>Sign in and select a league on the Account page to view your matchup.</p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading matchup...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>
  if (!data || !data.my_roster) return <p style={{ padding: '20px' }}>No matchup found.</p>

  const myUser = users[data.my_roster.owner_id]
  const oppUser = data.opp_roster ? users[data.opp_roster.owner_id] : null

  const starterSlots = (data.roster_positions || []).filter(p => p !== 'BN')
  const myStarters = data.my_roster.starters || []
  const oppStarters = data.opp_roster?.starters || []

  const pointsFor = (id) => (id && id !== '0' ? (data.week_points[id] ?? 0) : 0)
  const myTotal = myStarters.reduce((sum, id) => sum + pointsFor(id), 0)
  const oppTotal = oppStarters.reduce((sum, id) => sum + pointsFor(id), 0)

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>My Matchup &ndash; Week {data.week}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px', textAlign: 'center' }}>
        <div>
          {teamAvatarUrl(myUser) && (
            <img src={teamAvatarUrl(myUser)} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
          )}
          <div style={{ fontWeight: 'bold', marginTop: '4px' }}>{teamName(myUser)}</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{myTotal.toFixed(2)}</div>
        </div>
        <div>
          {data.opp_roster ? (
            <>
              {teamAvatarUrl(oppUser) && (
                <img src={teamAvatarUrl(oppUser)} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
              )}
              <div style={{ fontWeight: 'bold', marginTop: '4px' }}>{teamName(oppUser)}</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{oppTotal.toFixed(2)}</div>
            </>
          ) : (
            <div style={{ color: '#666', marginTop: '18px' }}>Bye Week</div>
          )}
        </div>
      </div>

      <div>
        {starterSlots.map((slot, i) => {
          const myId = myStarters[i]
          const oppId = oppStarters[i]
          const myPlayer = myId && myId !== '0' ? players[myId] : null
          const oppPlayer = oppId && oppId !== '0' ? players[oppId] : null
          return (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 55px 70px 55px 1fr',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <div
                onClick={() => myPlayer && openPlayer(myId)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end', textAlign: 'right', cursor: myPlayer ? 'pointer' : 'default' }}
              >
                {myPlayer && (
                  <img
                    src={headshotUrl(myId)}
                    onError={onHeadshotError}
                    alt=""
                    style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                  />
                )}
                <span>{myPlayer ? `${myPlayer.first_name} ${myPlayer.last_name} - ${myPlayer.team || 'FA'}` : 'Empty'}</span>
              </div>

              <div style={{ textAlign: 'center', fontWeight: 'bold' }}>
                {myPlayer ? pointsFor(myId).toFixed(2) : '-'}
              </div>

              <div style={{ textAlign: 'center' }}>
                <span
                  style={{
                    display: 'inline-block',
                    minWidth: '60px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: '#fff',
                    background: SLOT_COLORS[slot] || '#666',
                  }}
                >
                  {SLOT_LABELS[slot] || slot}
                </span>
              </div>

              <div style={{ textAlign: 'center', fontWeight: 'bold' }}>
                {oppPlayer ? pointsFor(oppId).toFixed(2) : (data.opp_roster ? '-' : '')}
              </div>

              <div
                onClick={() => oppPlayer && openPlayer(oppId)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: oppPlayer ? 'pointer' : 'default' }}
              >
                <span>{oppPlayer ? `${oppPlayer.first_name} ${oppPlayer.last_name} - ${oppPlayer.team || 'FA'}` : (data.opp_roster ? 'Empty' : '')}</span>
                {oppPlayer && (
                  <img
                    src={headshotUrl(oppId)}
                    onError={onHeadshotError}
                    alt=""
                    style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
