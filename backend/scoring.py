import json
from statistics import median
from sqlalchemy import func
from database import Stat, Roster, Matchup, League

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
