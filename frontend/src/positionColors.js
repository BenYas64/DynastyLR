// Single source of truth for position/slot colors and abbreviations, used
// everywhere a position chip is rendered (roster view, matchup view, league
// roster settings). Flex-type slots blend 2-4 real positions, so they're
// defined as a gradient of those positions' own colors instead of a flat one.
export const POSITION_COLORS = {
  QB: '#d32f2f',
  RB: '#2e7d32',
  WR: '#1976d2',
  TE: '#d26019',
  K: '#ec4899',
  DEF: '#795548',
  BN: '#9e9e9e',
  DL: '#f57c00',
  LB: '#fbc02d',
  DB: '#43a047',
}

export const SLOT_COLORS = {
  ...POSITION_COLORS,
  FLEX: [POSITION_COLORS.RB, POSITION_COLORS.WR, POSITION_COLORS.TE],
  WRRB_FLEX: [POSITION_COLORS.RB, POSITION_COLORS.WR],
  REC_FLEX: [POSITION_COLORS.WR, POSITION_COLORS.TE],
  SUPER_FLEX: [POSITION_COLORS.QB, POSITION_COLORS.QB, POSITION_COLORS.QB, POSITION_COLORS.RB, POSITION_COLORS.WR, POSITION_COLORS.TE],
  IDP_FLEX: [POSITION_COLORS.DL, POSITION_COLORS.LB, POSITION_COLORS.DB],
}

export const SLOT_LABELS = {
  SUPER_FLEX: 'SFX',
  FLEX: 'FLX',
  WRRB_FLEX: 'FLX',
  REC_FLEX: 'FLX',
  IDP_FLEX: 'IDP',
}

export function slotBackground(slot) {
  const color = SLOT_COLORS[slot]
  if (!color) return null
  return Array.isArray(color) ? `linear-gradient(135deg, ${color.join(', ')})` : color
}
