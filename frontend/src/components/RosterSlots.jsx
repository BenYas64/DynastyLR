import { Link } from 'react-router-dom'

// Builds one row per roster slot: starter slots (in league roster_positions order,
// filled positionally from `starters`, which Sleeper always returns in that same
// order), followed by BN rows. Bench rows are padded to the league's BN count with
// blanks, or extended (and flagged as overflow) if there are more bench players
// than BN slots.
function buildSlotRows(rosterPositions, starters, allPlayers) {
  const starterSlots = rosterPositions.filter(p => p !== 'BN')
  const bnCount = rosterPositions.length - starterSlots.length
  const startersList = starters || []

  const rows = starterSlots.map((slot, i) => {
    const playerId = startersList[i]
    return { slot, playerId: playerId && playerId !== '0' ? playerId : null, overflow: false, section: 'starter' }
  })

  const benchPlayerIds = (allPlayers || []).filter(id => !startersList.includes(id))
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

const SECTION_LABELS = {
  starter: 'Starters',
  bench: 'Bench',
}

const SLOT_COLORS = {
  QB: '#d32f2f',
  RB: '#2e7d32',
  WR: '#1976d2',
  TE: '#d26019',
  FLEX: '#7b1fa2',
  SUPER_FLEX: '#d32f2f',
}

export default function RosterSlots({ rosterPositions, starters, allPlayers, playersMap, backTo, backLabel }) {
  if (!rosterPositions || rosterPositions.length === 0) return null

  const rows = buildSlotRows(rosterPositions, starters, allPlayers)

  return (
    <div>
      {rows.map((row, i) => {
        const player = row.playerId ? playersMap[row.playerId] : null
        const showHeader = i === 0 || rows[i - 1].section !== row.section
        return (
          <div key={i}>
            {showHeader && (
              <h3
                style={{
                  margin: i === 0 ? '0 0 8px' : '20px 0 8px',
                  fontSize: '14px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: '#666',
                }}
              >
                {SECTION_LABELS[row.section]}
              </h3>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  minWidth: '70px',
                  padding: '2px 8px',
                  marginRight: '12px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  color: row.overflow || SLOT_COLORS[row.slot] ? '#fff' : '#333',
                  background: row.overflow ? '#d32f2f' : SLOT_COLORS[row.slot] || '#e0e0e0',
                }}
              >
                {row.slot}
              </span>
              {player ? (
                <Link
                  to={`/players/${row.playerId}`}
                  state={{ backTo, backLabel }}
                  style={{ color: 'inherit' }}
                >
                  {player.first_name} {player.last_name} - {player.position} - {player.team}
                </Link>
              ) : row.playerId ? (
                <span>{row.playerId}</span>
              ) : (
                <span style={{ color: '#bbb' }}>Empty</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
