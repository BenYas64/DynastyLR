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

// Mirrors RosterSlots.jsx's slot-building/eligibility logic exactly, so bench
// ordering and move rules behave identically to the roster page.
const BENCH_POSITION_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3 }

function sortBenchPlayerIds(ids, playersMap) {
  return [...ids].sort((a, b) => {
    const pa = playersMap[a]
    const pb = playersMap[b]
    const oa = BENCH_POSITION_ORDER[pa?.position] ?? 4
    const ob = BENCH_POSITION_ORDER[pb?.position] ?? 4
    if (oa !== ob) return oa - ob
    const na = pa ? `${pa.last_name} ${pa.first_name}` : a
    const nb = pb ? `${pb.last_name} ${pb.first_name}` : b
    return na.localeCompare(nb)
  })
}

function buildSlotRows(rosterPositions, starters, allPlayers, playersMap) {
  const starterSlots = rosterPositions.filter(p => p !== 'BN')
  const bnCount = rosterPositions.length - starterSlots.length
  const startersList = starters || []

  const rows = starterSlots.map((slot, i) => {
    const playerId = startersList[i]
    return { slot, playerId: playerId && playerId !== '0' ? playerId : null, overflow: false, section: 'starter' }
  })

  const benchPlayerIds = sortBenchPlayerIds(
    (allPlayers || []).filter(id => !startersList.includes(id)),
    playersMap
  )
  const benchRowCount = Math.max(bnCount, benchPlayerIds.length)
  for (let i = 0; i < benchRowCount; i++) {
    rows.push({
      slot: 'BN',
      playerId: benchPlayerIds[i] || null,
      overflow: i >= bnCount,
      section: 'bench',
    })
  }

  return rows
}

const FLEX_ELIGIBLE_POSITIONS = {
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'],
  REC_FLEX: ['WR', 'TE'],
}

function playerPositions(player) {
  if (!player) return []
  if (player.fantasy_positions) {
    try {
      const parsed = JSON.parse(player.fantasy_positions)
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {
      // fall through to primary position
    }
  }
  return player.position ? [player.position] : []
}

function eligibleForSlot(player, slotType) {
  const eligible = FLEX_ELIGIBLE_POSITIONS[slotType] || [slotType]
  return playerPositions(player).some(p => eligible.includes(p))
}

function slotChipStyle(slot, overflow, extra) {
  return {
    display: 'inline-block',
    minWidth: '60px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#fff',
    background: overflow ? '#d32f2f' : SLOT_COLORS[slot] || '#666',
    ...extra,
  }
}

export default function MyMatchup() {
  const { user, selectedLeagueId } = useAccount()
  const { openPlayer } = usePlayerModal()
  const [data, setData] = useState(null)
  const [users, setUsers] = useState({})
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [pickerRow, setPickerRow] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState(null)

  const load = () => {
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
      ;(matchupData.my_roster?.players || []).forEach(id => { if (id && id !== '0') ids.add(id) })
      ;(matchupData.opp_roster?.starters || []).forEach(id => { if (id && id !== '0') ids.add(id) })
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
  }

  useEffect(load, [user, selectedLeagueId])

  useEffect(() => {
    if (pickerRow === null) {
      setSheetOpen(false)
      return
    }
    const id = requestAnimationFrame(() => setSheetOpen(true))
    return () => cancelAnimationFrame(id)
  }, [pickerRow])

  useEffect(() => {
    if (pickerRow === null) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [pickerRow])

  if (!user || !selectedLeagueId) return (
    <p style={{ padding: '20px' }}>Sign in and select a league on the Account page to view your matchup.</p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading matchup...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>
  if (!data || !data.my_roster) return <p style={{ padding: '20px' }}>No matchup found.</p>

  const myUser = users[data.my_roster.owner_id]
  const oppUser = data.opp_roster ? users[data.opp_roster.owner_id] : null

  const rosterPositions = data.roster_positions || []
  const starterSlots = rosterPositions.filter(p => p !== 'BN')
  const myStarters = data.my_roster.starters || []
  const oppStarters = data.opp_roster?.starters || []

  const myRows = buildSlotRows(rosterPositions, myStarters, data.my_roster.players, players)

  const pointsFor = (id) => (id && id !== '0' ? (data.week_points[id] ?? 0) : 0)
  const myTotal = myStarters.reduce((sum, id) => sum + pointsFor(id), 0)
  const oppTotal = oppStarters.reduce((sum, id) => sum + pointsFor(id), 0)

  const closePicker = () => {
    setPickerRow(null)
    setMoveError(null)
  }

  const handleMove = (playerId, slotIndex) => {
    setMoving(true)
    setMoveError(null)
    fetch(`${API}/league/${selectedLeagueId}/set-slot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.user_id, player_id: playerId, slot_index: slotIndex }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to move player') })
        return r.json()
      })
      .then(() => {
        setMoving(false)
        closePicker()
        load()
      })
      .catch(err => {
        setMoving(false)
        setMoveError(err.message)
      })
  }

  const pickerRowData = pickerRow !== null ? myRows[pickerRow] : null
  const pickerPlayer = pickerRowData?.playerId ? players[pickerRowData.playerId] : null
  const fillMode = pickerRowData ? !pickerRowData.playerId : false

  const currentSlotLabel = (playerId) => {
    const idx = myStarters.indexOf(playerId)
    if (idx === -1 || idx >= starterSlots.length) return 'Bench'
    return SLOT_LABELS[starterSlots[idx]] || starterSlots[idx]
  }

  const options = []
  if (pickerRowData && !fillMode) {
    starterSlots.forEach((slotType, i) => {
      if (i === pickerRow) return
      if (!eligibleForSlot(pickerPlayer, slotType)) return
      const occupantId = myRows[i]?.playerId
      options.push({ slotIndex: i, slotType, occupant: occupantId ? players[occupantId] : null })
    })
    if (pickerRowData.section !== 'bench') {
      options.push({ slotIndex: null, slotType: 'BN', occupant: null })
    }
  }

  const fillCandidates = []
  if (pickerRowData && fillMode) {
    const slotType = pickerRowData.slot
    ;(data.my_roster.players || []).forEach(id => {
      const p = players[id]
      if (!p || !eligibleForSlot(p, slotType)) return
      fillCandidates.push({ playerId: id, player: p, currentLabel: currentSlotLabel(id) })
    })
    fillCandidates.sort((a, b) =>
      `${a.player.last_name} ${a.player.first_name}`.localeCompare(`${b.player.last_name} ${b.player.first_name}`)
    )
  }

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
        {myRows.map((row, i) => {
          const myPlayer = row.playerId ? players[row.playerId] : null
          const oppId = row.section === 'starter' ? oppStarters[i] : null
          const oppPlayer = oppId && oppId !== '0' ? players[oppId] : null
          const showHeader = i === 0 || myRows[i - 1].section !== row.section

          return (
            <div key={i}>
              {showHeader && (
                <h3 style={{ margin: i === 0 ? '0 0 8px' : '20px 0 8px', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#666' }}>
                  {row.section === 'starter' ? 'Starters' : 'Bench'}
                </h3>
              )}
              <div
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
                  onClick={() => myPlayer && openPlayer(row.playerId)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end', textAlign: 'right', cursor: myPlayer ? 'pointer' : 'default' }}
                >
                  {myPlayer && (
                    <img
                      src={headshotUrl(row.playerId)}
                      onError={onHeadshotError}
                      alt=""
                      style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                    />
                  )}
                  <span>{myPlayer ? `${myPlayer.first_name} ${myPlayer.last_name} - ${myPlayer.team || 'FA'}` : 'Empty'}</span>
                </div>

                <div style={{ textAlign: 'center', fontWeight: 'bold' }}>
                  {myPlayer ? pointsFor(row.playerId).toFixed(2) : '-'}
                </div>

                <div style={{ textAlign: 'center' }}>
                  <span
                    onClick={() => setPickerRow(i)}
                    style={slotChipStyle(row.slot, row.overflow, { cursor: 'pointer' })}
                  >
                    {SLOT_LABELS[row.slot] || row.slot}
                  </span>
                </div>

                <div style={{ textAlign: 'center', fontWeight: 'bold' }}>
                  {row.section === 'starter' && oppPlayer ? pointsFor(oppId).toFixed(2) : (row.section === 'starter' && data.opp_roster ? '-' : '')}
                </div>

                <div
                  onClick={() => oppPlayer && openPlayer(oppId)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: oppPlayer ? 'pointer' : 'default' }}
                >
                  {row.section === 'starter' && (
                    <>
                      <span>{oppPlayer ? `${oppPlayer.first_name} ${oppPlayer.last_name} - ${oppPlayer.team || 'FA'}` : (data.opp_roster ? 'Empty' : '')}</span>
                      {oppPlayer && (
                        <img
                          src={headshotUrl(oppId)}
                          onError={onHeadshotError}
                          alt=""
                          style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {pickerRowData && (
        <>
          <div
            onClick={closePicker}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000 }}
          />
          <div
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: '60vh',
              overflowY: 'auto',
              background: '#1a1a2e',
              color: '#fff',
              borderTopLeftRadius: '16px',
              borderTopRightRadius: '16px',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.25)',
              padding: '16px 20px 24px',
              zIndex: 1001,
              transform: sheetOpen ? 'translateY(0)' : 'translateY(100%)',
              transition: 'transform 0.25s ease-out',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>
                {fillMode
                  ? `Fill ${SLOT_LABELS[pickerRowData.slot] || pickerRowData.slot}`
                  : `Move ${pickerPlayer ? `${pickerPlayer.first_name} ${pickerPlayer.last_name}` : 'Player'}`}
              </h3>
              <button
                onClick={closePicker}
                style={{ background: 'none', border: 'none', fontSize: '22px', lineHeight: 1, cursor: 'pointer', color: '#fff' }}
              >
                &times;
              </button>
            </div>

            {moveError && <p style={{ color: '#ff6b6b' }}>{moveError}</p>}

            {fillMode ? (
              fillCandidates.length === 0 ? (
                <p style={{ color: '#aaa' }}>No eligible players on your roster for this spot.</p>
              ) : (
                fillCandidates.map(c => (
                  <button
                    key={c.playerId}
                    disabled={moving}
                    onClick={() => handleMove(c.playerId, pickerRow)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      width: '100%',
                      padding: '10px',
                      marginBottom: '8px',
                      border: '1px solid #33334d',
                      borderRadius: '8px',
                      background: '#242444',
                      color: '#fff',
                      cursor: moving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span style={slotChipStyle(c.currentLabel === 'Bench' ? 'BN' : c.player.position, false, { marginRight: '12px' })}>
                      {c.currentLabel}
                    </span>
                    <span>
                      {c.player.first_name} {c.player.last_name} - {c.player.position} - {c.player.team}
                    </span>
                  </button>
                ))
              )
            ) : options.length === 0 ? (
              <p style={{ color: '#aaa' }}>No other eligible slots.</p>
            ) : (
              options.map(opt => (
                <button
                  key={opt.slotIndex ?? 'bench'}
                  disabled={moving}
                  onClick={() => handleMove(pickerRowData.playerId, opt.slotIndex)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    padding: '10px',
                    marginBottom: '8px',
                    border: '1px solid #33334d',
                    borderRadius: '8px',
                    background: '#242444',
                    color: '#fff',
                    cursor: moving ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={slotChipStyle(opt.slotType, false, { marginRight: '12px' })}>
                    {SLOT_LABELS[opt.slotType] || opt.slotType}
                  </span>
                  <span>
                    {opt.slotType === 'BN'
                      ? 'Move to bench'
                      : opt.occupant
                        ? `${opt.occupant.first_name} ${opt.occupant.last_name} - ${opt.occupant.position} - ${opt.occupant.team}`
                        : 'Empty'}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
