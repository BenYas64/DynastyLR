import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAccount } from '../AccountContext.jsx'
import { usePlayerModal } from '../PlayerModalContext.jsx'
import { teamName, teamAvatarUrl } from '../teamDisplay.js'
import { headshotUrl, onHeadshotError } from '../playerHeadshot.js'
import { SLOT_LABELS, slotBackground } from '../positionColors.js'

const API = 'https://api.dynastylr.site'

function humanizeKey(key) {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Compact inline summary shown under each player - just enough box-score
// context to explain the fantasy score at a glance, not the full breakdown.
const BOX_SCORE_ORDER = [
  ['rec', 'rec'],
  ['rec_yd', 'rec yd'],
  ['rec_td', 'rec TD'],
  ['rush_att', 'car'],
  ['rush_yd', 'rush yd'],
  ['rush_td', 'rush TD'],
  ['pass_yd', 'pass yd'],
  ['pass_td', 'pass TD'],
  ['pass_int', 'INT'],
]

function boxScoreLine(stats) {
  if (!stats) return null
  const parts = BOX_SCORE_ORDER.filter(([key]) => stats[key]).map(([key, label]) => `${stats[key]} ${label}`)
  return parts.length ? parts.join(', ') : null
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
    background: overflow ? '#d32f2f' : slotBackground(slot) || '#666',
    ...extra,
  }
}

export default function MyMatchup() {
  const { leagueId: urlLeagueId, week: urlWeek, rosterId: urlRosterId } = useParams()
  const { user, selectedLeagueId } = useAccount()
  const { openPlayer } = usePlayerModal()

  // /matchup (no params) shows the signed-in user's current matchup for the
  // account's selected league. /league/:leagueId/matchup/:week/:rosterId
  // (reached by clicking a pairing on the League page) shows that specific
  // matchup instead, for anyone.
  const leagueId = urlLeagueId || selectedLeagueId

  const [data, setData] = useState(null)
  const [users, setUsers] = useState({})
  const [players, setPlayers] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [pickerRow, setPickerRow] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState(null)

  const [breakdown, setBreakdown] = useState(null)
  const [breakdownSheetOpen, setBreakdownSheetOpen] = useState(false)

  const load = () => {
    if (!leagueId) return
    if (!urlRosterId && (!user || !selectedLeagueId)) return
    setLoading(true)
    setError(null)

    const matchupUrl = urlRosterId
      ? `${API}/league/${leagueId}/matchup/${urlWeek}/${urlRosterId}`
      : `${API}/league/${leagueId}/matchup/current?user_id=${user.user_id}`

    Promise.all([
      fetch(matchupUrl).then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to load matchup') })
        return r.json()
      }),
      fetch(`${API}/league/${leagueId}/users`).then(r => r.json()),
    ]).then(([matchupData, usersData]) => {
      setData(matchupData)
      const userMap = {}
      usersData.forEach(u => { userMap[u.user_id] = u })
      setUsers(userMap)

      const ids = new Set()
      ;(matchupData.my_roster?.players || []).forEach(id => { if (id && id !== '0') ids.add(id) })
      ;(matchupData.opp_roster?.players || []).forEach(id => { if (id && id !== '0') ids.add(id) })
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

  useEffect(load, [leagueId, urlWeek, urlRosterId, user, selectedLeagueId])

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

  useEffect(() => {
    if (!breakdown) {
      setBreakdownSheetOpen(false)
      return
    }
    const id = requestAnimationFrame(() => setBreakdownSheetOpen(true))
    return () => cancelAnimationFrame(id)
  }, [breakdown])

  useEffect(() => {
    if (!breakdown) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [breakdown])

  if (!urlRosterId && (!user || !selectedLeagueId)) return (
    <p style={{ padding: '20px' }}>Sign in and select a league on the Account page to view your matchup.</p>
  )
  if (loading) return <p style={{ padding: '20px' }}>Loading matchup...</p>
  if (error) return <p style={{ padding: '20px', color: 'red' }}>Error: {error}</p>
  if (!data || !data.my_roster) return <p style={{ padding: '20px' }}>No matchup found.</p>

  const leftRoster = data.my_roster
  const rightRoster = data.opp_roster
  const leftUser = users[leftRoster.owner_id]
  const rightUser = rightRoster ? users[rightRoster.owner_id] : null

  // Editing only applies to whichever side (if either) belongs to the signed-in
  // viewer - /set-slot resolves the roster server-side from user_id, so this
  // just controls whether the slot chips are clickable at all. The backend
  // also refuses to lock in a past season or an already-played week, so mirror
  // that here too rather than showing chips that would just error on click.
  const editableSide = !data.editable
    ? null
    : user && leftRoster.owner_id === user.user_id
      ? 'left'
      : user && rightRoster && rightRoster.owner_id === user.user_id
        ? 'right'
        : null

  const rosterPositions = data.roster_positions || []
  const starterSlots = rosterPositions.filter(p => p !== 'BN')

  const leftRows = buildSlotRows(rosterPositions, leftRoster.starters, leftRoster.players, players)
  const rightRows = rightRoster ? buildSlotRows(rosterPositions, rightRoster.starters, rightRoster.players, players) : []
  const rowCount = Math.max(leftRows.length, rightRows.length)

  // Actual stats win once they exist; until then (upcoming/in-progress weeks,
  // or a player who hasn't played yet) fall back to Sleeper's projection.
  const hasActual = (id) => !!id && id !== '0' && Object.prototype.hasOwnProperty.call(data.week_points, id)
  const isProjected = (id) => !!id && id !== '0' && !hasActual(id) && Object.prototype.hasOwnProperty.call(data.week_projections || {}, id)
  const pointsFor = (id) => {
    if (!id || id === '0') return 0
    if (hasActual(id)) return data.week_points[id] ?? 0
    return data.week_projections?.[id] ?? 0
  }
  const leftTotal = (leftRoster.starters || []).reduce((sum, id) => sum + pointsFor(id), 0)
  const rightTotal = (rightRoster?.starters || []).reduce((sum, id) => sum + pointsFor(id), 0)

  const editableRoster = editableSide === 'left' ? leftRoster : editableSide === 'right' ? rightRoster : null
  const editableRows = editableSide === 'left' ? leftRows : editableSide === 'right' ? rightRows : []
  const editableStarters = editableRoster?.starters || []

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
      body: JSON.stringify({ user_id: user.user_id, week: data.week, player_id: playerId, slot_index: slotIndex }),
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

  const closeBreakdown = () => setBreakdown(null)

  const openBreakdown = (playerId) => {
    const player = players[playerId]
    setBreakdown({ playerId, player, loading: true, error: null, total: 0, rows: [], projected: false })
    fetch(`${API}/league/${leagueId}/players/${playerId}/stat-breakdown/${data.week}`)
      .then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.detail || 'Failed to load stats') })
        return r.json()
      })
      .then(result => {
        setBreakdown({ playerId, player, loading: false, error: null, total: result.total, rows: result.breakdown, projected: result.projected })
      })
      .catch(err => {
        setBreakdown({ playerId, player, loading: false, error: err.message, total: 0, rows: [], projected: false })
      })
  }

  const pickerRowData = pickerRow !== null ? editableRows[pickerRow] : null
  const pickerPlayer = pickerRowData?.playerId ? players[pickerRowData.playerId] : null
  const fillMode = pickerRowData ? !pickerRowData.playerId : false

  const currentSlotLabel = (playerId) => {
    const idx = editableStarters.indexOf(playerId)
    if (idx === -1 || idx >= starterSlots.length) return 'Bench'
    return SLOT_LABELS[starterSlots[idx]] || starterSlots[idx]
  }

  const options = []
  if (pickerRowData && !fillMode) {
    starterSlots.forEach((slotType, i) => {
      if (i === pickerRow) return
      if (!eligibleForSlot(pickerPlayer, slotType)) return
      const occupantId = editableRows[i]?.playerId
      options.push({ slotIndex: i, slotType, occupant: occupantId ? players[occupantId] : null })
    })
    if (pickerRowData.section !== 'bench') {
      options.push({ slotIndex: null, slotType: 'BN', occupant: null })
    }
  }

  const fillCandidates = []
  if (pickerRowData && fillMode) {
    const slotType = pickerRowData.slot
    ;(editableRoster?.players || []).forEach(id => {
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
      <h2>Matchup &ndash; Week {data.week}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px', textAlign: 'center' }}>
        <div>
          {teamAvatarUrl(leftUser) && (
            <img src={teamAvatarUrl(leftUser)} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
          )}
          <div style={{ fontWeight: 'bold', marginTop: '4px' }}>{teamName(leftUser)}</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{leftTotal.toFixed(2)}</div>
        </div>
        <div>
          {rightRoster ? (
            <>
              {teamAvatarUrl(rightUser) && (
                <img src={teamAvatarUrl(rightUser)} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
              )}
              <div style={{ fontWeight: 'bold', marginTop: '4px' }}>{teamName(rightUser)}</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{rightTotal.toFixed(2)}</div>
            </>
          ) : (
            <div style={{ color: '#666', marginTop: '18px' }}>Bye Week</div>
          )}
        </div>
      </div>

      <div>
        {Array.from({ length: rowCount }).map((_, i) => {
          const leftRow = leftRows[i] || null
          const rightRow = rightRows[i] || null
          const section = leftRow?.section || rightRow?.section || 'bench'
          const slot = leftRow?.slot || rightRow?.slot || 'BN'
          const overflow = leftRow?.overflow || rightRow?.overflow || false
          const leftPlayer = leftRow?.playerId ? players[leftRow.playerId] : null
          const rightPlayer = rightRow?.playerId ? players[rightRow.playerId] : null
          const prevSection = i === 0 ? null : (leftRows[i - 1]?.section || rightRows[i - 1]?.section)
          const showHeader = i === 0 || prevSection !== section

          const chipEditable = (editableSide === 'left' && leftRow) || (editableSide === 'right' && rightRow)
          const chipRowIndex = editableSide === 'left' ? i : editableSide === 'right' ? i : null

          const leftStatLine = leftPlayer ? boxScoreLine(data.week_stats?.[leftRow.playerId]) : null
          const rightStatLine = rightPlayer ? boxScoreLine(data.week_stats?.[rightRow.playerId]) : null

          return (
            <div key={i}>
              {showHeader && (
                <h3 style={{ margin: i === 0 ? '0 0 8px' : '20px 0 8px', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#666' }}>
                  {section === 'starter' ? 'Starters' : 'Bench'}
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
                  onClick={() => leftPlayer && openPlayer(leftRow.playerId)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', textAlign: 'right', cursor: leftPlayer ? 'pointer' : 'default' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {leftPlayer && (
                      <img
                        src={headshotUrl(leftRow.playerId)}
                        onError={onHeadshotError}
                        alt=""
                        style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                      />
                    )}
                    <span>{leftRow ? (leftPlayer ? `${leftPlayer.first_name} ${leftPlayer.last_name} - ${leftPlayer.team || 'FA'}` : 'Empty') : ''}</span>
                  </div>
                  {leftStatLine && <span style={{ fontSize: '11px', color: '#888' }}>{leftStatLine}</span>}
                </div>

                <div
                  onClick={() => leftPlayer && openBreakdown(leftRow.playerId)}
                  style={{ textAlign: 'center', fontWeight: 'bold', cursor: leftPlayer ? 'pointer' : 'default' }}
                >
                  {leftPlayer ? pointsFor(leftRow.playerId).toFixed(2) : (leftRow ? '-' : '')}
                  {leftPlayer && isProjected(leftRow.playerId) && (
                    <div style={{ fontSize: '10px', fontWeight: 'normal', color: '#888' }}>proj</div>
                  )}
                </div>

                <div style={{ textAlign: 'center' }}>
                  <span
                    onClick={chipEditable ? () => setPickerRow(chipRowIndex) : undefined}
                    style={slotChipStyle(slot, overflow, { cursor: chipEditable ? 'pointer' : 'default' })}
                  >
                    {SLOT_LABELS[slot] || slot}
                  </span>
                </div>

                <div
                  onClick={() => rightPlayer && openBreakdown(rightRow.playerId)}
                  style={{ textAlign: 'center', fontWeight: 'bold', cursor: rightPlayer ? 'pointer' : 'default' }}
                >
                  {rightPlayer ? pointsFor(rightRow.playerId).toFixed(2) : (rightRow ? '-' : '')}
                  {rightPlayer && isProjected(rightRow.playerId) && (
                    <div style={{ fontSize: '10px', fontWeight: 'normal', color: '#888' }}>proj</div>
                  )}
                </div>

                <div
                  onClick={() => rightPlayer && openPlayer(rightRow.playerId)}
                  style={{ display: 'flex', flexDirection: 'column', gap: '2px', cursor: rightPlayer ? 'pointer' : 'default' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{rightRow ? (rightPlayer ? `${rightPlayer.first_name} ${rightPlayer.last_name} - ${rightPlayer.team || 'FA'}` : 'Empty') : ''}</span>
                    {rightPlayer && (
                      <img
                        src={headshotUrl(rightRow.playerId)}
                        onError={onHeadshotError}
                        alt=""
                        style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                      />
                    )}
                  </div>
                  {rightStatLine && <span style={{ fontSize: '11px', color: '#888' }}>{rightStatLine}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {breakdown && (
        <>
          <div
            onClick={closeBreakdown}
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
              transform: breakdownSheetOpen ? 'translateY(0)' : 'translateY(100%)',
              transition: 'transform 0.25s ease-out',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>
                {breakdown.player ? `${breakdown.player.first_name} ${breakdown.player.last_name}` : 'Player'} &ndash; Week {data.week}
                {breakdown.projected && <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#aaa' }}> (Projected)</span>}
              </h3>
              <button
                onClick={closeBreakdown}
                style={{ background: 'none', border: 'none', fontSize: '22px', lineHeight: 1, cursor: 'pointer', color: '#fff' }}
              >
                &times;
              </button>
            </div>

            {breakdown.loading ? (
              <p style={{ color: '#aaa' }}>Loading...</p>
            ) : breakdown.error ? (
              <p style={{ color: '#ff6b6b' }}>{breakdown.error}</p>
            ) : breakdown.rows.length === 0 ? (
              <p style={{ color: '#aaa' }}>No stats recorded for this week.</p>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px', color: '#aaa', fontWeight: 'normal' }}>Stat</th>
                      <th style={{ textAlign: 'right', padding: '6px', color: '#aaa', fontWeight: 'normal' }}>Value</th>
                      <th style={{ textAlign: 'right', padding: '6px', color: '#aaa', fontWeight: 'normal' }}>Per Unit</th>
                      <th style={{ textAlign: 'right', padding: '6px', color: '#aaa', fontWeight: 'normal' }}>Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.rows.map(row => (
                      <tr key={row.key} style={{ borderBottom: '1px solid #33334d' }}>
                        <td style={{ padding: '6px' }}>{humanizeKey(row.key)}</td>
                        <td style={{ padding: '6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.value}</td>
                        <td style={{ padding: '6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.weight}pts</td>
                        <td style={{ padding: '6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.points.toFixed(2)}pts</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ marginTop: '12px', fontWeight: 'bold', textAlign: 'right' }}>
                  Total: {breakdown.total.toFixed(2)}pts
                </p>
              </>
            )}
          </div>
        </>
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
