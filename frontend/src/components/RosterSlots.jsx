import { useEffect, useState } from 'react'
import { usePlayerModal } from '../PlayerModalContext.jsx'
import { headshotUrl, onHeadshotError } from '../playerHeadshot.js'
import { SLOT_LABELS, slotBackground } from '../positionColors.js'

const API = 'https://api.dynastylr.site'

// Builds one row per roster slot: starter slots (in league roster_positions order,
// filled positionally from `starters`, which Sleeper always returns in that same
// order), followed by BN rows. Bench rows are padded to the league's BN count with
// blanks, or extended (and flagged as overflow) if there are more bench players
// than BN slots.
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

// Slots like FLEX/SUPER_FLEX don't literally match a player's fantasy_positions
// (no player is tagged "FLEX"), so they're expanded to the positions eligible
// to fill them. Mirrors FLEX_ELIGIBLE_POSITIONS in backend/main.py.
const FLEX_ELIGIBLE_POSITIONS = {
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'],
  REC_FLEX: ['WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
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

// Approximate "best possible lineup" - only touches open starter slots
// (empty, or holding someone who hasn't played yet this week). Mirrors
// computeOptimalLineup in MyMatchup.jsx.
function computeOptimalLineup(starterSlots, roster, players, pointsFor, hasActual) {
  const currentStarters = roster?.starters || []
  const rosterPlayerIds = roster?.players || []

  const slots = starterSlots.map((slotType, i) => {
    const currentId = currentStarters[i] && currentStarters[i] !== '0' ? currentStarters[i] : null
    return { index: i, slotType, currentId, locked: currentId ? hasActual(currentId) : false }
  })

  const available = rosterPlayerIds.filter(id => id && id !== '0' && !hasActual(id))
  const singlePos = []
  const multiPos = []
  available.forEach(id => {
    const positions = playerPositions(players[id])
    ;(positions.length <= 1 ? singlePos : multiPos).push(id)
  })

  const assignments = {}
  const used = new Set()

  const bestCandidate = (pool, slotType) => {
    let best = null
    pool.forEach(id => {
      if (used.has(id) || !eligibleForSlot(players[id], slotType)) return
      if (!best || pointsFor(id) > pointsFor(best)) best = id
    })
    return best
  }

  const singleSlots = slots.filter(s => !s.locked && !FLEX_ELIGIBLE_POSITIONS[s.slotType])
  singleSlots.forEach(slot => {
    const best = bestCandidate(singlePos, slot.slotType)
    if (best) { assignments[slot.index] = best; used.add(best) }
  })

  ;[...multiPos].sort((a, b) => pointsFor(b) - pointsFor(a)).forEach(id => {
    if (used.has(id)) return
    const eligibleSlots = singleSlots.filter(s => assignments[s.index] && eligibleForSlot(players[id], s.slotType))
    if (!eligibleSlots.length) return
    const worst = eligibleSlots.reduce((w, s) => pointsFor(assignments[s.index]) < pointsFor(assignments[w.index]) ? s : w)
    if (pointsFor(id) > pointsFor(assignments[worst.index])) {
      used.delete(assignments[worst.index])
      assignments[worst.index] = id
      used.add(id)
    }
  })

  const flexSlots = slots.filter(s => !s.locked && FLEX_ELIGIBLE_POSITIONS[s.slotType])
  const remainingPool = [...singlePos, ...multiPos]
  flexSlots.forEach(slot => {
    const best = bestCandidate(remainingPool, slot.slotType)
    if (best) { assignments[slot.index] = best; used.add(best) }
  })

  return slots
    .filter(s => assignments[s.index] && assignments[s.index] !== s.currentId)
    .map(s => ({ slotIndex: s.index, playerId: assignments[s.index] }))
}

const SECTION_LABELS = {
  starter: 'Starters',
  bench: 'Bench',
  picks: 'Draft Picks',
}

function ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0])
}

function pickLabel(pick) {
  const base = `${pick.season} ${ordinal(pick.round)}`
  return pick.original_team_name ? `${base} (${pick.original_team_name})` : base
}

const optimizeButtonStyle = {
  fontSize: '12px',
  padding: '4px 10px',
  borderRadius: '6px',
  border: '1px solid #ccc',
  background: '#fff',
  color: '#0064a2',
  cursor: 'pointer',
}

function slotChipStyle(slot, overflow, extra) {
  const background = overflow ? '#d32f2f' : slotBackground(slot) || '#e0e0e0'
  return {
    display: 'inline-block',
    minWidth: '70px',
    padding: '2px 8px',
    marginRight: '12px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold',
    textAlign: 'center',
    color: overflow || slotBackground(slot) ? '#fff' : '#333',
    background,
    ...extra,
  }
}

export default function RosterSlots({
  rosterPositions, starters, allPlayers, playersMap,
  editable, leagueId, userId, week, onMoved,
  weekPoints, weekProjections, futurePicks,
}) {
  const { openPlayer } = usePlayerModal()
  const [pickerRow, setPickerRow] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState(null)

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

  if (!rosterPositions || rosterPositions.length === 0) return null

  const rows = buildSlotRows(rosterPositions, starters, allPlayers, playersMap)
  const starterSlots = rosterPositions.filter(p => p !== 'BN')

  // Points are optional - only passed by pages (e.g. MyTeam) that fetched
  // week_points/week_projections. When absent, the points column and
  // Optimize Lineup button just don't render.
  const showPoints = !!weekPoints
  const hasActual = (id) => !!id && id !== '0' && !!weekPoints && Object.prototype.hasOwnProperty.call(weekPoints, id)
  const isProjected = (id) => !!id && id !== '0' && !hasActual(id) && !!weekProjections && Object.prototype.hasOwnProperty.call(weekProjections, id)
  const pointsFor = (id) => {
    if (!id || id === '0') return 0
    if (hasActual(id)) return weekPoints[id] ?? 0
    return weekProjections?.[id] ?? 0
  }

  const runOptimizeLineup = async () => {
    const moves = computeOptimalLineup(starterSlots, { starters, players: allPlayers }, playersMap, pointsFor, hasActual)
    if (!moves.length) return
    setOptimizing(true)
    setOptimizeError(null)
    try {
      // Sequential, not Promise.all - /set-slot reads current starters fresh
      // from the DB on each call, so firing these in parallel could race.
      for (const { slotIndex, playerId } of moves) {
        const res = await fetch(`${API}/league/${leagueId}/set-slot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, week, player_id: playerId, slot_index: slotIndex }),
        })
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.detail || 'Failed to move player')
        }
      }
      onMoved && onMoved()
    } catch (err) {
      setOptimizeError(err.message)
    } finally {
      setOptimizing(false)
    }
  }

  const closePicker = () => {
    setPickerRow(null)
    setMoveError(null)
  }

  const handleMove = (playerId, slotIndex) => {
    setMoving(true)
    setMoveError(null)
    fetch(`${API}/league/${leagueId}/set-slot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, week, player_id: playerId, slot_index: slotIndex }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to move player') })
        return r.json()
      })
      .then(() => {
        setMoving(false)
        closePicker()
        onMoved && onMoved()
      })
      .catch(err => {
        setMoving(false)
        setMoveError(err.message)
      })
  }

  const pickerRowData = pickerRow !== null ? rows[pickerRow] : null
  const pickerPlayer = pickerRowData?.playerId ? playersMap[pickerRowData.playerId] : null
  const fillMode = pickerRowData ? !pickerRowData.playerId : false

  const startersList = starters || []
  const currentSlotLabel = (playerId) => {
    const idx = startersList.indexOf(playerId)
    if (idx === -1 || idx >= starterSlots.length) return 'Bench'
    return SLOT_LABELS[starterSlots[idx]] || starterSlots[idx]
  }

  const options = []
  if (pickerRowData && !fillMode) {
    starterSlots.forEach((slotType, i) => {
      if (i === pickerRow) return
      if (!eligibleForSlot(pickerPlayer, slotType)) return
      const occupantId = rows[i]?.playerId
      options.push({ slotIndex: i, slotType, occupant: occupantId ? playersMap[occupantId] : null })
    })
    if (pickerRowData.section !== 'bench') {
      options.push({ slotIndex: null, slotType: 'BN', occupant: null })
    }
  }

  const fillCandidates = []
  if (pickerRowData && fillMode) {
    const slotType = pickerRowData.slot
    ;(allPlayers || []).forEach(id => {
      const p = playersMap[id]
      if (!p || !eligibleForSlot(p, slotType)) return
      fillCandidates.push({ playerId: id, player: p, currentLabel: currentSlotLabel(id) })
    })
    fillCandidates.sort((a, b) =>
      `${a.player.last_name} ${a.player.first_name}`.localeCompare(`${b.player.last_name} ${b.player.first_name}`)
    )
  }

  return (
    <div>
      {rows.map((row, i) => {
        const player = row.playerId ? playersMap[row.playerId] : null
        const showHeader = i === 0 || rows[i - 1].section !== row.section
        const clickable = editable && (player || row.section === 'starter')
        return (
          <div key={i}>
            {showHeader && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  margin: i === 0 ? '0 0 8px' : '20px 0 8px',
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: '14px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: '#666',
                  }}
                >
                  {SECTION_LABELS[row.section]}
                </h3>
                {row.section === 'starter' && editable && showPoints && (
                  <button onClick={runOptimizeLineup} disabled={optimizing} style={optimizeButtonStyle}>
                    {optimizing ? 'Optimizing…' : 'Optimize Lineup'}
                  </button>
                )}
              </div>
            )}
            {row.section === 'starter' && showHeader && optimizeError && (
              <p style={{ color: 'red', fontSize: '12px', margin: '0 0 8px' }}>{optimizeError}</p>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <span
                  onClick={clickable ? () => setPickerRow(i) : undefined}
                  style={slotChipStyle(row.slot, row.overflow, { cursor: clickable ? 'pointer' : 'default' })}
                >
                  {SLOT_LABELS[row.slot] || row.slot}
                </span>
                {player ? (
                  <span
                    onClick={() => openPlayer(row.playerId)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'inherit', cursor: 'pointer', textDecoration: 'none', minWidth: 0 }}
                  >
                    <img
                      src={headshotUrl(row.playerId)}
                      alt=""
                      style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', background: '#ddd', flexShrink: 0 }}
                      onError={onHeadshotError}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {player.first_name} {player.last_name} - {player.position} - {player.team}
                    </span>
                  </span>
                ) : row.playerId ? (
                  <span>{row.playerId}</span>
                ) : (
                  <span style={{ color: '#bbb' }}>Empty</span>
                )}
              </div>
              {showPoints && player && (
                <span style={{ textAlign: 'right', fontWeight: 'bold', flexShrink: 0, marginLeft: '8px' }}>
                  {pointsFor(row.playerId).toFixed(2)}
                  {isProjected(row.playerId) && (
                    <div style={{ fontSize: '10px', fontWeight: 'normal', color: '#888' }}>proj</div>
                  )}
                </span>
              )}
            </div>
          </div>
        )
      })}

      {futurePicks && futurePicks.length > 0 && (
        <div>
          <div style={{ margin: '20px 0 8px' }}>
            <h3
              style={{
                margin: 0,
                fontSize: '14px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: '#666',
              }}
            >
              {SECTION_LABELS.picks}
            </h3>
          </div>
          {futurePicks.map((pick, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <span>{pickLabel(pick)}</span>
            </div>
          ))}
        </div>
      )}

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
                    <span style={slotChipStyle(c.currentLabel === 'Bench' ? 'BN' : c.player.position, false)}>
                      {c.currentLabel}
                    </span>
                    <img
                      src={headshotUrl(c.playerId)}
                      alt=""
                      style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', background: '#33334d', flexShrink: 0, marginRight: '10px' }}
                      onError={onHeadshotError}
                    />
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
                  <span style={slotChipStyle(opt.slotType, false)}>
                    {SLOT_LABELS[opt.slotType] || opt.slotType}
                  </span>
                  {opt.occupant && (
                    <img
                      src={headshotUrl(opt.occupant.player_id)}
                      alt=""
                      style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', background: '#33334d', flexShrink: 0, marginRight: '10px' }}
                      onError={onHeadshotError}
                    />
                  )}
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
