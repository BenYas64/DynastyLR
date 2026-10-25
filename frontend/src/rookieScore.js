export const CURRENT_SEASON = 2026

// No league here plays a week 18 (see backend scoring.position_week_par),
// so every season is treated as 17 weeks for the 3-year score below, real
// or substituted.
export const WEEKS_PER_SEASON = 17

// 3-year draft score: average of a player's first 3 seasons' PAR, each
// treated as 17 weeks whether that many have actually happened yet or
// not. A season already fully played uses its real PAR total as-is. The
// season still in progress (or one that hasn't started at all) fills in
// the remaining-weeks fraction of its total from a stand-in FULL-SEASON
// value derived from current dynasty value (dynasty rating / 9999 * 200)
// - an estimate of what a typical season "should" produce for a player
// of that market value, not a real result. A season with no real weeks
// played yet gets 100% of that substitute; one that's n/17 weeks in gets
// its real total plus (17-n)/17 of it.
//
// Shared between the draft page and the rookie draft analytics page so
// the two can never compute this differently - rookiePar/rookieValues
// are the same shape both already fetch (per-season player_id->total,
// and player_id->{dynasty_value, ...}).
export function threeYearDraftScore(rookiePar, rookieValues, currentNflWeek, draftSeason, playerId) {
  const dynastyValue = rookieValues[playerId]?.dynasty_value ?? 0
  const substitutedSeasonValue = dynastyValue / 9999 * 200

  let total = 0
  for (const year of [draftSeason, draftSeason + 1, draftSeason + 2]) {
    let weeksCompleted
    if (year < CURRENT_SEASON) weeksCompleted = WEEKS_PER_SEASON
    else if (year > CURRENT_SEASON) weeksCompleted = 0
    else {
      if (currentNflWeek == null) return null
      weeksCompleted = Math.min(WEEKS_PER_SEASON, Math.max(currentNflWeek - 1, 0))
    }

    let realTotal = 0
    if (year <= CURRENT_SEASON) {
      const seasonPar = rookiePar[year]
      if (!seasonPar) return null
      realTotal = seasonPar[playerId] ?? 0
    }

    const remainingWeeks = WEEKS_PER_SEASON - weeksCompleted
    total += realTotal + (remainingWeeks / WEEKS_PER_SEASON) * substitutedSeasonValue
  }
  return total / 3
}

// PAR rank tiers, same 4-color language as the weekly rank coloring on
// the individual player page - but ranked overall across every
// PAR-eligible position (QB/RB/WR/TE together) for that season, not a
// rate cutoff. No rank at all (never recorded a stat at any of those
// positions that season) is worse than every real rank, so it falls
// through to Red too. Shared between the draft page and the rookie
// draft analytics page so a season's PAR badge is colored identically
// wherever it's shown.
export const PAR_RANK_TIERS = [12, 48, 120]
export const PAR_RANK_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626']

export function parRankColor(rank) {
  if (rank === undefined) return null
  const r = rank ?? Infinity
  const [tier1, tier2, tier3] = PAR_RANK_TIERS
  if (r <= tier1) return PAR_RANK_COLORS[0]
  if (r <= tier2) return PAR_RANK_COLORS[1]
  if (r <= tier3) return PAR_RANK_COLORS[2]
  return PAR_RANK_COLORS[3]
}
