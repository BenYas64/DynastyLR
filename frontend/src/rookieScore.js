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
// value derived from current dynasty value (dynasty rating / 9999 * 250)
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
  const substitutedSeasonValue = dynastyValue / 9999 * 250

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

// Hand-set pick values (picks 1-60) for draft classes where the fixed
// curve below doesn't reflect that year's actual crop of rookies -
// values[0] is pick #1, values[59] is pick #60. A season or pick
// number not covered here falls through to the formula.
const PICK_VALUE_TABLE = {
  2023: [100.0, 84.9, 65.8, 58.4, 61.2, 56.0, 41.0, 37.8, 35.7, 30.9, 29.2, 25.8, 25.6, 25.6, 24.4, 21.9, 21.6, 21.6, 20.0, 18.9, 17.7, 16.9, 16.2, 15.9, 15.2, 12.6, 12.2, 12.1, 11.5, 10.8, 10.2, 9.6, 9.1, 8.6, 8.1, 7.7, 7.2, 6.8, 6.4, 6.1, 5.7, 5.4, 5.1, 4.8, 4.5, 4.3, 4.1, 3.8, 3.6, 3.4, 3.2, 3.0, 2.9, 2.7, 2.6, 2.4, 2.3, 2.1, 2.0, 1.9],
  2024: [100.0, 96.1, 72.0, 69.0, 61.2, 57.2, 53.3, 51.5, 44.9, 44.3, 40.7, 40.0, 38.4, 37.9, 35.7, 33.3, 29.7, 29.6, 28.4, 28.3, 28.2, 23.9, 23.8, 23.6, 23.5, 23.1, 22.0, 21.1, 20.0, 18.8, 17.8, 16.8, 15.8, 15.0, 14.1, 13.3, 12.6, 11.9, 11.2, 10.6, 10.0, 9.4, 8.9, 8.4, 7.9, 7.5, 7.1, 6.7, 6.3, 5.9, 5.6, 5.3, 5.0, 4.7, 4.4, 4.2, 4.0, 3.7, 3.5, 3.3],
  2025: [100.0, 71.2, 62.3, 61.1, 59.8, 57.4, 51.8, 49.4, 46.1, 41.4, 40.8, 40.3, 36.3, 36.0, 33.2, 31.0, 30.2, 28.7, 27.4, 24.9, 24.9, 24.4, 23.3, 23.1, 20.8, 20.6, 20.4, 19.8, 18.7, 17.7, 16.7, 15.7, 14.8, 14.0, 13.2, 12.5, 11.8, 11.1, 10.5, 9.9, 9.3, 8.8, 8.3, 7.9, 7.4, 7.0, 6.6, 6.2, 5.9, 5.6, 5.2, 5.0, 4.7, 4.4, 4.2, 3.9, 3.7, 3.5, 3.3, 3.1],
  2026: [100.0, 62.6, 61.3, 52.3, 48.2, 47.8, 43.3, 36.6, 33.5, 32.7, 29.6, 28.2, 24.2, 21.6, 20.6, 19.0, 18.4, 16.8, 16.1, 15.3, 14.1, 13.9, 13.9, 11.5, 10.9, 10.5, 10.5, 10.0, 9.4, 8.9, 8.4, 7.9, 7.5, 7.1, 6.7, 6.3, 5.9, 5.6, 5.3, 5.0, 4.7, 4.5, 4.2, 4.0, 3.7, 3.5, 3.3, 3.1, 3.0, 2.8, 2.6, 2.5, 2.4, 2.2, 2.1, 2.0, 1.9, 1.8, 1.7, 1.6],
}

// Rookie pick value curve, pre PAR-based class-strength rescaling
// (that happens downstream, on the already-looked-up/computed base
// value - see RookieDraftAnalytics.jsx). A draft class with hand-set
// values in PICK_VALUE_TABLE above uses those directly for picks 1-60;
// any other season, or a pick past #60 even in a covered season, falls
// back to the fixed formula (same for every uncovered class, no
// season dependency), where pick #1 is always 100 and value decays
// smoothly from there.
export function pickValue(pickNo, season) {
  const tableValue = PICK_VALUE_TABLE[season]?.[pickNo - 1]
  if (tableValue != null) return tableValue
  return 75 * Math.pow(0.5, pickNo / 12 - 1 / 12) + 25 * Math.pow(0.25, pickNo - 1)
}
