import json
from statistics import median
from sqlalchemy import func
from database import Stat, Roster, Matchup, League, Player, PlayerValue

NON_STAT_COLUMNS = {"player_id", "season", "week", "season_type", "team", "opponent"}

def scoring_expression(league, model=Stat):
    """SQL expression for a single stat (or projection) row's fantasy points: a
    league's weighted scoring_settings if available, otherwise standard PPR."""
    total = model.pts_ppr
    if league and league.scoring_settings:
        scoring_settings = json.loads(league.scoring_settings)
        terms = [
            func.coalesce(getattr(model, key), 0) * weight
            for key, weight in scoring_settings.items()
            if weight and key not in NON_STAT_COLUMNS and hasattr(model, key)
        ]
        if terms:
            total = terms[0]
            for term in terms[1:]:
                total = total + term
    return total

# Estimated share of each flex-type roster slot that actually goes to each
# eligible position, used only to derive how many "starters" exist at a
# single position when that position can also be filled via a flex slot -
# real per-league flex usage would make points-above-replacement
# incomparable across leagues/years, so this is a deliberately fixed,
# adjustable estimate rather than something derived from real rosters.
# SUPER_FLEX skews heavily to QB since that's the entire reason Superflex
# leagues create a second QB market.
FLEX_SPLITS = {
    "FLEX": {"RB": 0.45, "WR": 0.45, "TE": 0.10},
    "WRRB_FLEX": {"RB": 0.55, "WR": 0.45},
    "REC_FLEX": {"WR": 0.85, "TE": 0.15},
    "SUPER_FLEX": {"QB": 0.95, "RB": 0.03, "WR": 0.015, "TE": 0.005},
}

def replacement_starter_counts(league):
    """How many starters exist leaguewide at each offensive skill position -
    base single-position slots plus an estimated share of any flex-type
    slot eligible for it (see FLEX_SPLITS). The player ranked just below
    this count at a position, for a given week, is the replacement level
    points-above-replacement is measured against."""
    if not league or not league.roster_positions:
        return {}
    positions = json.loads(league.roster_positions)
    per_team = {"QB": 0.0, "RB": 0.0, "WR": 0.0, "TE": 0.0}
    for slot in positions:
        if slot in per_team:
            per_team[slot] += 1
        elif slot in FLEX_SPLITS:
            for pos, share in FLEX_SPLITS[slot].items():
                per_team[pos] += share
    num_teams = league.total_rosters or 12
    return {pos: max(1, round(n * num_teams)) for pos, n in per_team.items()}

def position_week_par(db, league, season, position, model=Stat):
    """Per-player points above replacement at `position`, for every week of
    a season at once - computed live from the league's own scoring and
    roster construction (same as scoring_expression itself), not stored,
    since both of those are league-specific and this needs to stay
    comparable to nothing but itself. Replacement level each week is the
    score of the player ranked just below replacement_starter_counts'
    estimate for that position; below it counts as 0, never negative.
    Week 18 is excluded entirely - no league here plays a fantasy week
    that late, so it shouldn't count toward a season PAR total."""
    n = replacement_starter_counts(league).get(position)
    if not n:
        return {}

    rows = (
        db.query(model.player_id, model.week, scoring_expression(league, model))
        .join(Player, Player.player_id == model.player_id)
        .filter(model.season == season, model.season_type == "regular", model.week != 18, Player.position == position)
        .all()
    )

    by_week = {}
    for player_id, week, pts in rows:
        by_week.setdefault(week, []).append((player_id, pts or 0))

    par = {}
    for week, players in by_week.items():
        players.sort(key=lambda p: p[1], reverse=True)
        replacement_score = players[n][1] if len(players) > n else 0
        for player_id, pts in players:
            par.setdefault(player_id, {})[week] = max(0.0, pts - replacement_score)
    return par

# Positions FantasyCalc actually rates for trade value - a K or DEF never
# has a PlayerValue row, so there's nothing to rescale for them anyway.
VALUE_POSITIONS = ("QB", "RB", "WR", "TE")

def value_baseline_rank(league, is_dynasty):
    """Combined QB/RB/WR/TE rank used as this league's trade-value
    baseline - total non-bench/IR starting slots league-wide, times 5/3
    for dynasty or 4/3 for redraft. Same idea as replacement_starter_counts
    (a deliberately-past-the-starters cutoff), but for trade value instead
    of weekly scoring, and not split by position - one combined pool."""
    if not league or not league.roster_positions:
        return None
    positions = json.loads(league.roster_positions)
    starters_per_team = sum(1 for slot in positions if slot not in ("BN", "IR"))
    total_starters = starters_per_team * (league.total_rosters or 12)
    return round(total_starters * (5 / 3 if is_dynasty else 4 / 3))

def rescaled_trade_values(db, league, is_dynasty, value_ppr, value_tep):
    """Rebaselines one league's dynasty/redraft trade values (see
    database.PlayerValue) against its own size and format, since
    FantasyCalc's raw numbers mean nothing on their own without knowing
    how deep a league's starting lineups actually run - computed live
    rather than stored, same reasoning as PAR. 0 is set at the value of
    the player ranked at value_baseline_rank; the single best player is
    set to 9999; everyone below 0 is clamped to 0."""
    rank_cutoff = value_baseline_rank(league, is_dynasty)
    if not rank_cutoff:
        return {}

    rows = (
        db.query(PlayerValue.player_id, PlayerValue.value)
        .join(Player, Player.player_id == PlayerValue.player_id)
        .filter(
            PlayerValue.is_dynasty == is_dynasty,
            PlayerValue.ppr == value_ppr,
            PlayerValue.tep == value_tep,
            Player.position.in_(VALUE_POSITIONS),
        )
        .all()
    )
    if not rows:
        return {}

    ranked = sorted(rows, key=lambda r: r[1] or 0, reverse=True)
    baseline = (ranked[rank_cutoff - 1][1] or 0) if len(ranked) >= rank_cutoff else 0
    shifted = {player_id: (value or 0) - baseline for player_id, value in ranked}

    max_shifted = max(shifted.values())
    if max_shifted <= 0:
        return {player_id: 0 for player_id in shifted}

    scale = 9899 / max_shifted
    return {player_id: max(0, round(v * scale + 100)) for player_id, v in shifted.items()}

def is_current_season(db, league):
    """A league is the active one in its dynasty history if nothing has
    superseded it yet and it isn't marked complete - same check main.py's
    week_editable()/get_league() already use for "is this season live"."""
    is_superseded = db.query(League).filter(
        League.previous_league_id == league.league_id
    ).first() is not None
    return (not is_superseded) and league.status != "complete"

def _week_starters(roster, matchup):
    """Same fallback main.py's roster_week_snapshot() uses: a week-specific
    locked-in lineup if one exists, else the roster's live current starters."""
    week_starters = json.loads(matchup.starters) if matchup and matchup.starters else None
    starters = week_starters if week_starters else (roster.starters or [])
    return [s for s in starters if s and s != "0"]

def recompute_matchup_points(db, league, week):
    """Sum each roster's starters' current fantasy points (actual stats,
    same scoring the rest of the app uses) and write the total into that
    roster's Matchup.points for this week - this is what makes the simple
    weekly matchup list live-update as stats come in, instead of showing
    whatever Sleeper's own (possibly stale) import last said."""
    rosters = db.query(Roster).filter(Roster.league_id == league.league_id).all()
    matchups = {
        m.roster_id: m
        for m in db.query(Matchup).filter(Matchup.league_id == league.league_id, Matchup.week == week).all()
    }

    for roster in rosters:
        matchup = matchups.get(roster.roster_id)
        starter_ids = _week_starters(roster, matchup)
        points = 0.0
        if starter_ids:
            points = db.query(func.sum(scoring_expression(league))).filter(
                Stat.season == league.season, Stat.week == week, Stat.season_type == "regular",
                Stat.player_id.in_(starter_ids),
            ).scalar() or 0.0

        if matchup:
            matchup.points = points
        else:
            db.add(Matchup(league_id=league.league_id, week=week, roster_id=roster.roster_id, points=points))

    db.commit()

def recompute_season_records(db, league, through_week):
    """Rebuilds Roster.wins/losses/ties for this league from scratch, from
    weeks 1..through_week - not an incremental +1 each week, so a late
    correction to an earlier week's stats is reflected consistently rather
    than compounding an error forward. Only ever called for the current
    season (see is_current_season) - a completed season's Roster row is
    never touched by this."""
    rosters = db.query(Roster).filter(Roster.league_id == league.league_id).all()
    record = {r.roster_id: {"wins": 0, "losses": 0, "ties": 0} for r in rosters}

    matchups = db.query(Matchup).filter(
        Matchup.league_id == league.league_id, Matchup.week <= through_week, Matchup.points.isnot(None),
    ).all()

    by_week = {}
    for m in matchups:
        by_week.setdefault(m.week, []).append(m)

    playoff_start = league.playoff_week_start or None

    for week, week_matchups in by_week.items():
        is_regular_season = playoff_start is None or week < playoff_start

        # Head-to-head: only real two-team pairings count (skip byes/solo
        # entries), same pairing rule as main.py's get_head_to_head().
        by_matchup_id = {}
        for m in week_matchups:
            if m.matchup_id is not None:
                by_matchup_id.setdefault(m.matchup_id, []).append(m)

        for group in by_matchup_id.values():
            if len(group) != 2:
                continue
            a, b = group
            if a.roster_id not in record or b.roster_id not in record:
                continue
            if a.points > b.points:
                record[a.roster_id]["wins"] += 1
                record[b.roster_id]["losses"] += 1
            elif b.points > a.points:
                record[b.roster_id]["wins"] += 1
                record[a.roster_id]["losses"] += 1
            else:
                record[a.roster_id]["ties"] += 1
                record[b.roster_id]["ties"] += 1

        # Median bonus: every roster vs. the whole league's score that week,
        # independent of who their real opponent was - regular season only.
        if league.league_median and is_regular_season:
            week_median = median(m.points for m in week_matchups)
            for m in week_matchups:
                if m.roster_id not in record:
                    continue
                if m.points > week_median:
                    record[m.roster_id]["wins"] += 1
                elif m.points < week_median:
                    record[m.roster_id]["losses"] += 1
                else:
                    record[m.roster_id]["ties"] += 1

    for roster in rosters:
        rec = record[roster.roster_id]
        roster.wins = rec["wins"]
        roster.losses = rec["losses"]
        roster.ties = rec["ties"]

    db.commit()
