import json
import time
import requests
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from database import get_db, Player, Stat, Projection, User, League, Roster, LeagueUser, Matchup, BracketMatchup, DraftPick, PlayerValue
from scoring import scoring_expression, NON_STAT_COLUMNS, position_week_par, replacement_starter_counts, rescaled_trade_values

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "Fantasy Football API is running"}

@app.get("/players/by-ids")
def get_players_by_ids(ids: str, db: Session = Depends(get_db)):
    id_list = [i for i in ids.split(",") if i]
    if not id_list:
        return []
    return db.query(Player).filter(Player.player_id.in_(id_list)).all()

# FLEX-type roster slots don't literally match a player's fantasy_positions
# (e.g. no player is tagged "FLEX"), so they're expanded to the positions
# eligible to fill them.
FLEX_ELIGIBLE_POSITIONS = {
    "FLEX": ["RB", "WR", "TE"],
    "SUPER_FLEX": ["QB", "RB", "WR", "TE"],
    "WRRB_FLEX": ["WR", "RB"],
    "REC_FLEX": ["WR", "TE"],
    "IDP_FLEX": ["DL", "LB", "DB"],
}

def eligible_positions_for_roster(roster_positions):
    eligible = set()
    for slot in roster_positions:
        eligible.update(FLEX_ELIGIBLE_POSITIONS.get(slot, [slot]))
    return eligible

def player_to_dict(player):
    return {c.name: getattr(player, c.name) for c in Player.__table__.columns}

CACHE_TTL_SECONDS = 3600
_points_cache = {}
_position_rank_cache = {}
_par_cache = {}
_value_cache = {}

def season_points(db, league, season):
    """Per-player summed points for the season. Cached in-process, since stats only
    change on sync (weekly) and this is the same aggregation query behind every
    browse/sort request - recomputing it live on every page view is what drained
    the DB's I/O budget last time."""
    cache_key = (league.league_id if league else None, season)
    cached = _points_cache.get(cache_key)
    now = time.time()
    if cached and now - cached["computed_at"] < CACHE_TTL_SECONDS:
        return cached["points"]

    rows = (
        db.query(Stat.player_id, func.sum(scoring_expression(league)).label("points"))
        .filter(Stat.season == season, Stat.season_type == "regular")
        .group_by(Stat.player_id)
        .all()
    )
    points = {player_id: pts or 0 for player_id, pts in rows}
    _points_cache[cache_key] = {"computed_at": now, "points": points}
    return points

def position_week_ranks(db, league, season, position):
    """Per-player weekly rank at `position` for the season (1 = highest score that
    week), using the league's scoring. Cached per (league, season, position) since
    the same rank table serves every player at that position - one query computes
    it for everyone, rather than a query per player-detail-page view."""
    cache_key = (league.league_id if league else None, season, position)
    cached = _position_rank_cache.get(cache_key)
    now = time.time()
    if cached and now - cached["computed_at"] < CACHE_TTL_SECONDS:
        return cached["ranks"]

    rank_col = func.rank().over(partition_by=Stat.week, order_by=scoring_expression(league).desc())
    rows = (
        db.query(Stat.player_id, Stat.week, rank_col.label("rank"))
        .join(Player, Player.player_id == Stat.player_id)
        .filter(Stat.season == season, Stat.season_type == "regular", Player.position == position)
        .all()
    )
    ranks = {}
    for player_id, week, rank in rows:
        ranks.setdefault(player_id, {})[week] = rank
    _position_rank_cache[cache_key] = {"computed_at": now, "ranks": ranks}
    return ranks

def cached_position_week_par(db, league, season, position):
    """Same caching shape as position_week_ranks, for
    scoring.position_week_par - keyed by league too (unlike ranks, PAR
    depends on the league's scoring AND roster construction, not just
    scoring)."""
    cache_key = (league.league_id if league else None, season, position)
    cached = _par_cache.get(cache_key)
    now = time.time()
    if cached and now - cached["computed_at"] < CACHE_TTL_SECONDS:
        return cached["par"]

    par = position_week_par(db, league, season, position)
    _par_cache[cache_key] = {"computed_at": now, "par": par}
    return par

def cached_rescaled_trade_values(db, league, is_dynasty, value_ppr, value_tep):
    """Same caching shape as cached_position_week_par, for
    scoring.rescaled_trade_values - keyed by league (roster shape and
    size), dynasty vs. redraft, and the ppr/tep slice, since all four
    change which FantasyCalc values get pulled and how they're rebaselined."""
    cache_key = (league.league_id if league else None, is_dynasty, value_ppr, value_tep)
    cached = _value_cache.get(cache_key)
    now = time.time()
    if cached and now - cached["computed_at"] < CACHE_TTL_SECONDS:
        return cached["values"]

    values = rescaled_trade_values(db, league, is_dynasty, value_ppr, value_tep)
    _value_cache[cache_key] = {"computed_at": now, "values": values}
    return values

@app.get("/players/browse")
def browse_players(
    q: str = "",
    league_id: str | None = None,
    available_only: bool = False,
    season: int = 2026,
    position: str | None = None,
    team: str | None = None,
    injury_status: str | None = None,
    sort_by: str = "points",
    sort_dir: str = "desc",
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 200))
    league = db.query(League).filter(League.league_id == league_id).first() if league_id else None

    query = db.query(Player).filter(Player.active == True)

    if q:
        query = query.filter(Player.full_name.ilike(f"%{q}%"))

    if league and league.roster_positions:
        eligible = eligible_positions_for_roster(json.loads(league.roster_positions))
        if eligible:
            query = query.filter(or_(*[Player.fantasy_positions.ilike(f'%"{pos}"%') for pos in eligible]))

    if position:
        positions = [p for p in position.split(",") if p]
        if positions:
            query = query.filter(Player.position.in_(positions))

    if team:
        teams = [t for t in team.split(",") if t]
        if teams:
            query = query.filter(Player.team.in_(teams))

    if injury_status:
        # "Active" isn't a real stored value - it's NULL or '' in the
        # column, same fallback the player detail view already displays.
        statuses = [s for s in injury_status.split(",") if s]
        conditions = []
        real_statuses = [s for s in statuses if s != "Active"]
        if "Active" in statuses:
            conditions.append(or_(Player.injury_status.is_(None), Player.injury_status == ""))
        if real_statuses:
            conditions.append(Player.injury_status.in_(real_statuses))
        if conditions:
            query = query.filter(or_(*conditions))

    if available_only and league_id:
        rosters = db.query(Roster).filter(Roster.league_id == league_id).all()
        rostered_ids = set()
        for r in rosters:
            if r.players:
                rostered_ids.update(r.players)
        if rostered_ids:
            query = query.filter(Player.player_id.notin_(rostered_ids))

    candidates = query.all()

    points = season_points(db, league, season)

    # Same rescaled values shown on the player detail/draft pages (see
    # scoring.rescaled_trade_values) - computed once for every candidate
    # here so both the table and the sort-by-value/rank options use the
    # same numbers, not FantasyCalc's raw scale.
    value_ppr = league.value_ppr if league and league.value_ppr is not None else 0.5
    value_tep = league.value_tep if league and league.value_tep is not None else 0.0
    include_dynasty = bool(league and league.league_type == "dynasty")

    redraft_values = cached_rescaled_trade_values(db, league, False, value_ppr, value_tep)
    dynasty_values = cached_rescaled_trade_values(db, league, True, value_ppr, value_tep) if include_dynasty else {}

    value_rows = db.query(PlayerValue.player_id, PlayerValue.is_dynasty, PlayerValue.position_rank).filter(
        PlayerValue.ppr == value_ppr, PlayerValue.tep == value_tep,
    ).all()
    redraft_ranks = {player_id: rank for player_id, is_dynasty, rank in value_rows if not is_dynasty}
    dynasty_ranks = {player_id: rank for player_id, is_dynasty, rank in value_rows if is_dynasty}

    # A missing rank sorts as worse than every real one in both
    # directions (last under ascending "best first", first under
    # descending "worst first") - same idea as PAR ranking an
    # unranked player below everyone with a real rank.
    SORT_KEYS = {
        "points": lambda p: points.get(p.player_id, 0) or 0,
        "age": lambda p: p.age if p.age is not None else -1,
        "redraft_value": lambda p: redraft_values.get(p.player_id, 0) or 0,
        "redraft_rank": lambda p: redraft_ranks.get(p.player_id) or 999999,
        "dynasty_value": lambda p: dynasty_values.get(p.player_id, 0) or 0,
        "dynasty_rank": lambda p: dynasty_ranks.get(p.player_id) or 999999,
    }
    sort_key = SORT_KEYS.get(sort_by, SORT_KEYS["points"])
    ranked = sorted(candidates, key=sort_key, reverse=(sort_dir != "asc"))

    total = len(ranked)
    page = []
    for player in ranked[offset:offset + limit]:
        data = player_to_dict(player)
        data["points"] = points.get(player.player_id, 0)
        data["redraft_value"] = redraft_values.get(player.player_id)
        data["redraft_position_rank"] = redraft_ranks.get(player.player_id)
        data["dynasty_value"] = dynasty_values.get(player.player_id) if include_dynasty else None
        data["dynasty_position_rank"] = dynasty_ranks.get(player.player_id) if include_dynasty else None
        page.append(data)

    return {"total": total, "players": page}

@app.get("/players/filter-options")
def get_player_filter_options(db: Session = Depends(get_db)):
    """Distinct position/team/injury-status values actually present among
    active players, for the players page's filter dropdowns - computed
    live rather than hardcoded, since guessing team abbreviations (a
    relocated franchise, a legacy code like 'OAK' still on old rows) or
    every position Sleeper tracks (offensive line splits, IDP, etc.) is
    exactly the kind of thing that quietly goes stale."""
    positions = sorted(p for (p,) in db.query(Player.position).filter(Player.active == True, Player.position.isnot(None)).distinct().all() if p)
    teams = sorted(t for (t,) in db.query(Player.team).filter(Player.active == True, Player.team.isnot(None)).distinct().all() if t)
    statuses = sorted(s for (s,) in db.query(Player.injury_status).filter(Player.active == True, Player.injury_status.isnot(None)).distinct().all() if s)
    return {"positions": positions, "teams": teams, "injury_statuses": statuses}

@app.get("/players/values")
def get_player_values(ids: str, league_id: str | None = None, db: Session = Depends(get_db)):
    """Bulk redraft/dynasty trade value lookup, same resolution rules as
    get_player()'s value fields below - built for pages like the rookie
    draft columns that need this for dozens of players in one request
    instead of one request per player. Registered before /players/{player_id}
    so "values" isn't swallowed as a player_id, same reason /players/browse is."""
    id_list = [i for i in ids.split(",") if i]
    if not id_list:
        return {}

    league = db.query(League).filter(League.league_id == league_id).first() if league_id else None
    value_ppr = league.value_ppr if league and league.value_ppr is not None else 0.5
    value_tep = league.value_tep if league and league.value_tep is not None else 0.0
    include_dynasty = bool(league and league.league_type == "dynasty")

    # redraft_value/dynasty_value are this league's own rebaselined scale
    # (see scoring.rescaled_trade_values), not FantasyCalc's raw number -
    # position_rank is untouched, still FantasyCalc's own per-position rank.
    redraft_values = cached_rescaled_trade_values(db, league, False, value_ppr, value_tep)
    dynasty_values = cached_rescaled_trade_values(db, league, True, value_ppr, value_tep) if include_dynasty else {}

    rows = db.query(PlayerValue).filter(
        PlayerValue.player_id.in_(id_list),
        PlayerValue.ppr == value_ppr,
        PlayerValue.tep == value_tep,
    ).all()

    result = {
        player_id: {
            "redraft_value": None, "redraft_position_rank": None,
            "dynasty_value": None, "dynasty_position_rank": None,
        }
        for player_id in id_list
    }
    for row in rows:
        entry = result[row.player_id]
        if not row.is_dynasty:
            entry["redraft_value"] = redraft_values.get(row.player_id)
            entry["redraft_position_rank"] = row.position_rank
        elif include_dynasty:
            entry["dynasty_value"] = dynasty_values.get(row.player_id)
            entry["dynasty_position_rank"] = row.position_rank
    return result

@app.get("/players/{player_id}")
def get_player(player_id: str, league_id: str | None = None, db: Session = Depends(get_db)):
    player = db.query(Player).filter(Player.player_id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    stats = db.query(Stat).filter(Stat.player_id == player_id).order_by(
        Stat.season.desc(), Stat.week.desc()
    ).all()

    # Which of the 18 FantasyCalc slices (see player_values) to show -
    # the calling league's own value_ppr/value_tep if it has one set, else
    # a reasonable default (half-PPR, no TEP) so this still works without
    # a league in context. Redraft always shows; dynasty only shows
    # additionally when the league is actually a dynasty league.
    league = db.query(League).filter(League.league_id == league_id).first() if league_id else None
    value_ppr = league.value_ppr if league and league.value_ppr is not None else 0.5
    value_tep = league.value_tep if league and league.value_tep is not None else 0.0

    def value_for(is_dynasty):
        return db.query(PlayerValue).filter(
            PlayerValue.player_id == player_id,
            PlayerValue.is_dynasty == is_dynasty,
            PlayerValue.ppr == value_ppr,
            PlayerValue.tep == value_tep,
        ).first()

    redraft = value_for(False)
    dynasty = value_for(True) if league and league.league_type == "dynasty" else None

    # redraft_value/dynasty_value are this league's own rebaselined scale
    # (see scoring.rescaled_trade_values), not FantasyCalc's raw number -
    # position_rank is untouched, still FantasyCalc's own per-position rank.
    redraft_value = cached_rescaled_trade_values(db, league, False, value_ppr, value_tep).get(player_id) if redraft else None
    dynasty_value = cached_rescaled_trade_values(db, league, True, value_ppr, value_tep).get(player_id) if dynasty else None

    return {
        "player": player,
        "stats": stats,
        "redraft_value": redraft_value,
        "redraft_position_rank": redraft.position_rank if redraft else None,
        "dynasty_value": dynasty_value,
        "dynasty_position_rank": dynasty.position_rank if dynasty else None,
    }

@app.get("/league/{league_id}/players/{player_id}/weekly-rank/{season}")
def get_weekly_rank(league_id: str, player_id: str, season: int, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    player = db.query(Player).filter(Player.player_id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if not player.position:
        return {}
    ranks = position_week_ranks(db, league, season, player.position)
    return ranks.get(player_id, {})

@app.get("/league/{league_id}/players/{player_id}/points-above-replacement/{season}")
def get_points_above_replacement(league_id: str, player_id: str, season: int, db: Session = Depends(get_db)):
    """Per-week points above replacement for this player, under this
    league's actual scoring and roster construction - see
    scoring.position_week_par for the methodology."""
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    player = db.query(Player).filter(Player.player_id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if not player.position:
        return {}
    par = cached_position_week_par(db, league, season, player.position)
    return par.get(player_id, {})

@app.get("/league/{league_id}/players/points-above-replacement-totals/{season}")
def get_points_above_replacement_totals(league_id: str, season: int, ids: str, db: Session = Depends(get_db)):
    """Bulk season-total PAR for a list of players, reusing the same
    per-position cache (one query per distinct position among `ids`, not
    one per player) - built for the draft page's rookie-class columns,
    which need this for dozens of players at once."""
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    id_list = [i for i in ids.split(",") if i]
    if not id_list:
        return {}

    positions = dict(db.query(Player.player_id, Player.position).filter(Player.player_id.in_(id_list)).all())
    par_by_position = {}
    totals = {}
    for player_id in id_list:
        position = positions.get(player_id)
        if not position:
            totals[player_id] = 0.0
            continue
        if position not in par_by_position:
            par_by_position[position] = cached_position_week_par(db, league, season, position)
        totals[player_id] = sum(par_by_position[position].get(player_id, {}).values())
    return totals

@app.get("/league/{league_id}/players/points-above-replacement-rank/{season}")
def get_points_above_replacement_rank(league_id: str, season: int, ids: str, db: Session = Depends(get_db)):
    """Overall PAR rank for a season, combined across every PAR-eligible
    position (QB/RB/WR/TE together, not within one position) - lets the
    draft page color a pick by how many other draftable players that
    season's PAR actually outscored, not an arbitrary rate cutoff. A
    player with no PAR data at all that season (never recorded a stat at
    any of those positions) gets no rank, i.e. below everyone who has one."""
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    id_list = [i for i in ids.split(",") if i]
    if not id_list:
        return {}

    totals = []
    for position in replacement_starter_counts(league):
        par = cached_position_week_par(db, league, season, position)
        totals.extend((player_id, sum(weekly.values())) for player_id, weekly in par.items())
    totals.sort(key=lambda t: t[1], reverse=True)

    rank = {player_id: i + 1 for i, (player_id, _) in enumerate(totals)}
    return {player_id: rank.get(player_id) for player_id in id_list}

@app.get("/league/{league_id}/players/{player_id}/stat-breakdown/{week}")
def get_stat_breakdown(league_id: str, player_id: str, week: int, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    stat = db.query(Stat).filter(
        Stat.player_id == player_id, Stat.season == league.season, Stat.week == week, Stat.season_type == "regular"
    ).first()

    # No actual stat line yet (upcoming/in-progress week) - fall back to the
    # projection so the breakdown popup still has something to show.
    projected = False
    source = stat
    if not source:
        source = db.query(Projection).filter(
            Projection.player_id == player_id, Projection.season == league.season,
            Projection.week == week, Projection.season_type == "regular",
        ).first()
        projected = source is not None

    if not source:
        return {"total": 0, "breakdown": [], "projected": False}

    scoring_settings = json.loads(league.scoring_settings) if league.scoring_settings else {}

    breakdown = []
    total = 0.0
    for col in Stat.__table__.columns:
        key = col.name
        if key in NON_STAT_COLUMNS:
            continue
        weight = scoring_settings.get(key)
        value = getattr(source, key)
        if not weight or not value:
            continue
        points = value * weight
        total += points
        breakdown.append({"key": key, "value": value, "weight": weight, "points": points})

    return {"total": total, "breakdown": breakdown, "projected": projected}

@app.get("/leagues/{user_id}")
def get_leagues(user_id: str, season: int | None = None, db: Session = Depends(get_db)):
    leagues = (
        db.query(League)
        .join(LeagueUser, LeagueUser.league_id == League.league_id)
        .filter(LeagueUser.user_id == user_id)
        .all()
    )
    if season is not None:
        return [l for l in leagues if l.season == season]

    # No season given: return each league family's most recent known season,
    # rather than a hardcoded year - not every league rolls over to the new
    # season at the same time, so a fixed year would hide ones that haven't yet.
    all_leagues = db.query(League).all()
    superseded = {l.previous_league_id for l in all_leagues if l.previous_league_id}
    return [l for l in leagues if l.league_id not in superseded]

@app.get("/league/{league_id}")
def get_league(league_id: str, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    is_superseded = db.query(League).filter(League.previous_league_id == league_id).first() is not None
    return {
        **{c.name: getattr(league, c.name) for c in League.__table__.columns},
        "is_current_season": not is_superseded,
    }

def league_chain(db, league_id):
    """Every League row in the same dynasty history as `league_id` - the
    current season plus every season it rolled over from/into. Returns
    None if league_id itself doesn't exist."""
    all_leagues = db.query(League).all()
    by_id = {l.league_id: l for l in all_leagues}
    by_prev = {l.previous_league_id: l for l in all_leagues if l.previous_league_id}

    if league_id not in by_id:
        return None

    chain = {league_id: by_id[league_id]}

    cur = by_id[league_id]
    while cur.previous_league_id and cur.previous_league_id in by_id and cur.previous_league_id not in chain:
        cur = by_id[cur.previous_league_id]
        chain[cur.league_id] = cur

    cur = by_id[league_id]
    while cur.league_id in by_prev and by_prev[cur.league_id].league_id not in chain:
        cur = by_prev[cur.league_id]
        chain[cur.league_id] = cur

    return chain

@app.get("/league/{league_id}/history")
def get_league_history(league_id: str, db: Session = Depends(get_db)):
    chain = league_chain(db, league_id)
    if chain is None:
        raise HTTPException(status_code=404, detail="League not found")

    ordered = sorted(chain.values(), key=lambda l: l.season or 0, reverse=True)
    return [{"league_id": l.league_id, "season": l.season, "name": l.name} for l in ordered]

@app.get("/league/{league_id}/head-to-head")
def get_head_to_head(league_id: str, db: Session = Depends(get_db)):
    """All-time head-to-head records between rosters, across every season in
    this league's history - roster_id is the team identity (not owner_id),
    since Sleeper carries roster_id over across a season rollover but a new
    LeagueUser row gets created each season. Only counts real two-team
    matchups with a final score - a bye week (no matchup_id) or a solo/median
    entry (not exactly two rosters sharing a matchup_id) isn't a head-to-head
    game and is skipped."""
    chain = league_chain(db, league_id)
    if chain is None:
        raise HTTPException(status_code=404, detail="League not found")

    matchups = db.query(Matchup).filter(Matchup.league_id.in_(chain.keys())).all()

    games = {}
    for m in matchups:
        if m.matchup_id is None or m.points is None:
            continue
        key = (m.league_id, m.week, m.matchup_id)
        games.setdefault(key, []).append(m)

    records = {}
    for group in games.values():
        if len(group) != 2:
            continue
        a, b = group
        pair_key = frozenset((a.roster_id, b.roster_id))
        rec = records.setdefault(pair_key, {
            "wins": {a.roster_id: 0, b.roster_id: 0},
            "points": {a.roster_id: 0.0, b.roster_id: 0.0},
            "total": 0,
        })
        if a.points > 0 and b.points > 0:
            rec["total"] += 1
            rec["points"][a.roster_id] += a.points
            rec["points"][b.roster_id] += b.points
        if a.points > b.points:
            rec["wins"][a.roster_id] += 1
        elif b.points > a.points:
            rec["wins"][b.roster_id] += 1

    result = []
    for pair_key, rec in records.items():
        r1, r2 = tuple(pair_key)
        wins1, wins2 = rec["wins"][r1], rec["wins"][r2]
        if wins2 > wins1 or (wins1 == wins2 and r2 < r1):
            r1, r2, wins1, wins2 = r2, r1, wins2, wins1
        result.append({
            "roster_id_1": r1,
            "roster_id_2": r2,
            "wins_1": wins1,
            "wins_2": wins2,
            "points_1": round(rec["points"][r1], 2),
            "points_2": round(rec["points"][r2], 2),
            "total_games": rec["total"],
        })

    return result

class ScoringSettingsUpdate(BaseModel):
    user_id: str
    scoring_settings: dict[str, float]

@app.put("/league/{league_id}/scoring-settings")
def update_scoring_settings(league_id: str, payload: ScoringSettingsUpdate, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    membership = db.query(LeagueUser).filter(
        LeagueUser.league_id == league_id,
        LeagueUser.user_id == payload.user_id,
    ).first()
    if not membership or not membership.commish:
        raise HTTPException(status_code=403, detail="Only the league commissioner can edit scoring settings")

    is_superseded = db.query(League).filter(League.previous_league_id == league_id).first() is not None
    if is_superseded:
        raise HTTPException(status_code=403, detail="Scoring settings for past seasons cannot be edited")

    league.scoring_settings = json.dumps(payload.scoring_settings)
    db.commit()

    # Points/rank caches are keyed by (league_id, ...) and hold up to an hour -
    # without this they'd keep serving points computed under the old settings.
    for cache in (_points_cache, _position_rank_cache):
        for key in [k for k in cache if k[0] == league_id]:
            del cache[key]

    return {"league_id": league_id, "scoring_settings": payload.scoring_settings}

VALUE_TIERS = (0, 0.5, 1.0)

LEAGUE_TYPES = ("redraft", "dynasty")

class ValueSettingsUpdate(BaseModel):
    user_id: str
    value_ppr: float
    value_tep: float
    league_type: str

@app.put("/league/{league_id}/value-settings")
def update_value_settings(league_id: str, payload: ValueSettingsUpdate, db: Session = Depends(get_db)):
    """Which FantasyCalc value slice (see player_values) this league's
    players should be shown with - defaulted from scoring_settings by
    sync_leagues.py, but a commissioner can override it here same as any
    other league setting."""
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    membership = db.query(LeagueUser).filter(
        LeagueUser.league_id == league_id,
        LeagueUser.user_id == payload.user_id,
    ).first()
    if not membership or not membership.commish:
        raise HTTPException(status_code=403, detail="Only the league commissioner can edit value settings")

    is_superseded = db.query(League).filter(League.previous_league_id == league_id).first() is not None
    if is_superseded:
        raise HTTPException(status_code=403, detail="Value settings for past seasons cannot be edited")

    if payload.value_ppr not in VALUE_TIERS or payload.value_tep not in VALUE_TIERS:
        raise HTTPException(status_code=400, detail="value_ppr and value_tep must each be 0, 0.5, or 1")
    if payload.league_type not in LEAGUE_TYPES:
        raise HTTPException(status_code=400, detail="league_type must be 'redraft' or 'dynasty'")

    league.value_ppr = payload.value_ppr
    league.value_tep = payload.value_tep
    league.league_type = payload.league_type
    db.commit()

    return {
        "league_id": league_id,
        "value_ppr": league.value_ppr,
        "value_tep": league.value_tep,
        "league_type": league.league_type,
    }

# Canonical slot order the roster-positions editor writes back in. BN entries
# can sit anywhere in the array without affecting starter-slot indexing (slot
# rows are filtered out and re-derived from this only by count elsewhere), so
# placement here is purely cosmetic/ordering, not functional.
ROSTER_SLOT_ORDER = [
    "QB", "RB", "WR", "TE", "FLEX", "WRRB_FLEX", "REC_FLEX", "SUPER_FLEX",
    "K", "DEF", "BN", "DL", "LB", "DB", "IDP_FLEX",
]

class RosterPositionsUpdate(BaseModel):
    user_id: str
    positions: dict[str, int]

def reconcile_starters(old_positions, new_positions, old_starters):
    """Re-map a starters array from an old roster-slot template to a new one,
    matched by slot type (not raw index) so unrelated starters never appear to
    "slide" into a different-looking slot. Per type: existing assignments are
    kept in their original order up to the new count; a shrunk slot's excess
    players are simply dropped (they fall back to the bench automatically,
    since bench = roster players minus whoever's left in starters); a grown
    slot's new spot is filled with "0" (empty) rather than pulling a player
    into it."""
    old_starter_slots = [s for s in old_positions if s != "BN"]
    new_starter_slots = [s for s in new_positions if s != "BN"]

    old_by_type = {}
    for i, slot in enumerate(old_starter_slots):
        old_by_type.setdefault(slot, []).append(old_starters[i] if i < len(old_starters) else "0")

    consumed = {}
    new_starters = []
    for slot in new_starter_slots:
        idx = consumed.get(slot, 0)
        existing = old_by_type.get(slot, [])
        new_starters.append(existing[idx] if idx < len(existing) else "0")
        consumed[slot] = idx + 1

    return new_starters

@app.put("/league/{league_id}/roster-positions")
def update_roster_positions(league_id: str, payload: RosterPositionsUpdate, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    membership = db.query(LeagueUser).filter(
        LeagueUser.league_id == league_id,
        LeagueUser.user_id == payload.user_id,
    ).first()
    if not membership or not membership.commish:
        raise HTTPException(status_code=403, detail="Only the league commissioner can edit roster settings")

    is_superseded = db.query(League).filter(League.previous_league_id == league_id).first() is not None
    if is_superseded:
        raise HTTPException(status_code=403, detail="Roster settings for past seasons cannot be edited")

    old_positions = json.loads(league.roster_positions) if league.roster_positions else []
    new_positions = []
    for slot in ROSTER_SLOT_ORDER:
        new_positions += [slot] * max(0, int(payload.positions.get(slot, 0)))

    # Every roster's live lineup is built against this same league-wide
    # template, so all of them need remapping, not just the commissioner's.
    for roster in db.query(Roster).filter(Roster.league_id == league_id).all():
        roster.starters = reconcile_starters(old_positions, new_positions, roster.starters or [])

    # Any week that already has its own locally-set lineup (current or a
    # future week someone pre-planned) needs the same remap - a locked/past
    # week is left untouched since it's a historical record, not a plan.
    for matchup in db.query(Matchup).filter(Matchup.league_id == league_id).all():
        if matchup.starters and week_editable(db, league, matchup.week):
            old_m_starters = json.loads(matchup.starters)
            matchup.starters = json.dumps(reconcile_starters(old_positions, new_positions, old_m_starters))

    league.roster_positions = json.dumps(new_positions)
    db.commit()

    # Rescaled trade values are baselined against roster_positions'
    # starter count (see scoring.value_baseline_rank) - without this
    # they'd keep serving values computed under the old roster shape.
    for key in [k for k in _value_cache if k[0] == league_id]:
        del _value_cache[key]

    return {"league_id": league_id, "roster_positions": new_positions}

@app.get("/league/{league_id}/rosters")
def get_rosters(league_id: str, db: Session = Depends(get_db)):
    rosters = db.query(Roster).filter(Roster.league_id == league_id).all()
    return [
        {
            "roster_id": r.roster_id,
            "owner_id": r.owner_id,
            "league_id": r.league_id,
            "players": r.players or [],
            "starters": r.starters or [],
            "settings": {"wins": r.wins, "losses": r.losses, "ties": r.ties, "fpts": r.fpts},
        }
        for r in rosters
    ]

@app.get("/league/{league_id}/rostered-players")
def get_rostered_players(league_id: str, db: Session = Depends(get_db)):
    rosters = db.query(Roster).filter(Roster.league_id == league_id).all()
    player_ids = set()
    for r in rosters:
        if r.players:
            player_ids.update(r.players)
    return sorted(player_ids)

class RosterMove(BaseModel):
    user_id: str
    player_id: str

@app.post("/league/{league_id}/drop-player")
def drop_player(league_id: str, payload: RosterMove, db: Session = Depends(get_db)):
    roster = db.query(Roster).filter(
        Roster.league_id == league_id, Roster.owner_id == payload.user_id
    ).first()
    if not roster:
        raise HTTPException(status_code=404, detail="You don't have a roster in this league")

    players = list(roster.players or [])
    if payload.player_id not in players:
        raise HTTPException(status_code=400, detail="Player is not on your roster")
    players.remove(payload.player_id)
    roster.players = players
    roster.starters = ['0' if s == payload.player_id else s for s in (roster.starters or [])]
    db.commit()

    return {"players": roster.players, "starters": roster.starters}

@app.post("/league/{league_id}/add-player")
def add_player(league_id: str, payload: RosterMove, db: Session = Depends(get_db)):
    roster = db.query(Roster).filter(
        Roster.league_id == league_id, Roster.owner_id == payload.user_id
    ).first()
    if not roster:
        raise HTTPException(status_code=404, detail="You don't have a roster in this league")

    player = db.query(Player).filter(Player.player_id == payload.player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    other_rosters = db.query(Roster).filter(Roster.league_id == league_id).all()
    rostered_ids = set()
    for r in other_rosters:
        if r.players:
            rostered_ids.update(r.players)
    if payload.player_id in rostered_ids:
        raise HTTPException(status_code=400, detail="Player is already rostered in this league")

    players = list(roster.players or [])
    players.append(payload.player_id)
    roster.players = players
    db.commit()

    return {"players": roster.players, "starters": roster.starters or []}

class SlotMove(BaseModel):
    user_id: str
    week: int
    player_id: str
    slot_index: int | None = None  # index into starter slots (roster_positions minus BN); None = bench

@app.post("/league/{league_id}/set-slot")
def set_slot(league_id: str, payload: SlotMove, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    if not week_editable(db, league, payload.week):
        raise HTTPException(status_code=403, detail="This week's lineup can't be edited")

    roster = db.query(Roster).filter(
        Roster.league_id == league_id, Roster.owner_id == payload.user_id
    ).first()
    if not roster:
        raise HTTPException(status_code=404, detail="You don't have a roster in this league")
    if payload.player_id not in (roster.players or []):
        raise HTTPException(status_code=400, detail="Player is not on your roster")

    # Lineups are set independently per week (exactly like Sleeper - setting
    # week 7's lineup during week 1 doesn't touch week 1's), so the starting
    # point is that week's own row, not the live roster, if one exists yet.
    matchup = db.query(Matchup).filter(
        Matchup.league_id == league_id, Matchup.week == payload.week, Matchup.roster_id == roster.roster_id
    ).first()
    base_starters = json.loads(matchup.starters) if matchup and matchup.starters else None

    starter_slots = [p for p in json.loads(league.roster_positions or "[]") if p != "BN"]
    starters = list(base_starters) if base_starters else list(roster.starters or [])
    starters += ["0"] * (len(starter_slots) - len(starters))

    if payload.slot_index is not None:
        if not (0 <= payload.slot_index < len(starter_slots)):
            raise HTTPException(status_code=400, detail="Invalid slot")
        eligible = FLEX_ELIGIBLE_POSITIONS.get(starter_slots[payload.slot_index], [starter_slots[payload.slot_index]])
        player = db.query(Player).filter(Player.player_id == payload.player_id).first()
        player_positions = json.loads(player.fantasy_positions) if player and player.fantasy_positions else ([player.position] if player else [])
        if not any(p in eligible for p in player_positions):
            raise HTTPException(status_code=400, detail=f"Player is not eligible for {starter_slots[payload.slot_index]}")

    source_index = starters.index(payload.player_id) if payload.player_id in starters else None

    if payload.slot_index is None:
        if source_index is not None:
            starters[source_index] = "0"
    else:
        displaced = starters[payload.slot_index]
        starters[payload.slot_index] = payload.player_id
        if source_index is not None:
            # The displaced player only backfills the mover's old slot if they're
            # actually eligible for it - otherwise (e.g. a WR displaced from SFLX
            # can't legally fill a QB-only slot) they go to the bench instead.
            displaced_eligible = displaced == "0"
            if not displaced_eligible:
                displaced_player = db.query(Player).filter(Player.player_id == displaced).first()
                displaced_positions = (
                    json.loads(displaced_player.fantasy_positions)
                    if displaced_player and displaced_player.fantasy_positions
                    else ([displaced_player.position] if displaced_player else [])
                )
                source_eligible = FLEX_ELIGIBLE_POSITIONS.get(starter_slots[source_index], [starter_slots[source_index]])
                displaced_eligible = any(p in source_eligible for p in displaced_positions)
            starters[source_index] = displaced if displaced_eligible else "0"

    if matchup:
        matchup.starters = json.dumps(starters)
    else:
        matchup = Matchup(
            league_id=league_id,
            week=payload.week,
            roster_id=roster.roster_id,
            starters=json.dumps(starters),
        )
        db.add(matchup)

    # Keep the live roster mirror in sync for the current week only, since
    # other things (e.g. Sleeper-facing displays) still read it as "now".
    if payload.week == current_nfl_week():
        roster.starters = starters

    db.commit()

    return {"week": payload.week, "players": roster.players, "starters": starters}

@app.get("/league/{league_id}/matchups/{week}")
def get_matchups(league_id: str, week: int, db: Session = Depends(get_db)):
    matchups = db.query(Matchup).filter(Matchup.league_id == league_id, Matchup.week == week).all()
    return [
        {
            "roster_id": m.roster_id,
            "matchup_id": m.matchup_id,
            "points": m.points,
            "players": json.loads(m.players) if m.players else [],
        }
        for m in matchups
    ]

_nfl_state_cache = {"computed_at": 0, "week": None}

def current_nfl_week():
    """Sleeper's own notion of 'what week is it right now', used to pick the
    upcoming/live matchup rather than a hardcoded or guessed week number.
    League matchups are numbered 1-18 for the regular season only, so
    Sleeper's "week" is only meaningful once season_type is "regular" -
    during preseason it's a preseason week count (e.g. week 2 of preseason)
    that doesn't correspond to any league matchup, so week 1 is used instead."""
    now = time.time()
    if _nfl_state_cache["week"] is not None and now - _nfl_state_cache["computed_at"] < CACHE_TTL_SECONDS:
        return _nfl_state_cache["week"]
    week = _nfl_state_cache["week"] or 1
    try:
        resp = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=10)
        resp.raise_for_status()
        state = resp.json()
        week = state.get("week") or week if state.get("season_type") == "regular" else 1
    except Exception:
        pass
    _nfl_state_cache.update({"computed_at": now, "week": week})
    return week

def week_editable(db, league, week):
    """Lineups can only be edited for the live matchup in the league's current
    season - not a past/completed season, and not a week that's already been
    played. A league can be "complete" before next season's version even
    exists yet, so both signals matter, not just supersession."""
    is_superseded = db.query(League).filter(League.previous_league_id == league.league_id).first() is not None
    return (not is_superseded) and league.status != "complete" and week >= current_nfl_week()

def roster_week_snapshot(db, league, roster, week, editable):
    if not roster:
        return None
    m = db.query(Matchup).filter(
        Matchup.league_id == league.league_id, Matchup.week == week, Matchup.roster_id == roster.roster_id
    ).first()

    # Starters are set per-week independently, like Sleeper's own lineup
    # planning - a locally-set week 7 lineup sticks even while week 1 is
    # still current, so this applies whether or not the week is locked.
    week_starters = json.loads(m.starters) if m and m.starters else None
    starters = week_starters if week_starters else (roster.starters or [])

    # The player pool to pick starters from is always the live roster while
    # editable (you can only start players you currently own), but a locked
    # past week should show that week's actual historical roster instead.
    if editable:
        players = roster.players or []
    else:
        week_players = json.loads(m.players) if m and m.players else None
        players = week_players if week_players else (roster.players or [])

    return {
        "roster_id": roster.roster_id,
        "owner_id": roster.owner_id,
        "starters": starters if starters else (roster.starters or []),
        "players": players if players else (roster.players or []),
    }

# The handful of box-score numbers shown inline under each player, on top of
# their computed fantasy points - just enough to explain the score at a
# glance, not the full stat-breakdown popup's every scored category.
BOX_SCORE_COLUMNS = [
    "rec", "rec_yd", "rec_td",
    "rush_att", "rush_yd", "rush_td",
    "pass_yd", "pass_td", "pass_int",
]

def week_points_and_projections(db, league, week, player_ids):
    week_points = {}
    week_stats = {}
    if player_ids:
        rows = (
            db.query(Stat.player_id, scoring_expression(league), *[getattr(Stat, c) for c in BOX_SCORE_COLUMNS])
            .filter(
                Stat.season == league.season,
                Stat.week == week,
                Stat.season_type == "regular",
                Stat.player_id.in_(player_ids),
            )
            .all()
        )
        for row in rows:
            player_id, pts, *box = row
            week_points[player_id] = pts or 0
            week_stats[player_id] = {col: val or 0 for col, val in zip(BOX_SCORE_COLUMNS, box)}

    # Projected points fill in for players who don't have an actual stat row
    # yet (future/upcoming weeks, or a bye-week/pre-game player this week) -
    # the frontend falls back to these wherever week_points has no entry.
    week_projections = {}
    if player_ids:
        proj_rows = (
            db.query(Projection.player_id, scoring_expression(league, Projection))
            .filter(
                Projection.season == league.season,
                Projection.week == week,
                Projection.season_type == "regular",
                Projection.player_id.in_(player_ids),
            )
            .all()
        )
        week_projections = {player_id: pts or 0 for player_id, pts in proj_rows}

    return week_points, week_stats, week_projections

def matchup_payload(db, league, week, roster_id):
    my_roster = db.query(Roster).filter(
        Roster.league_id == league.league_id, Roster.roster_id == roster_id
    ).first()
    if not my_roster:
        raise HTTPException(status_code=404, detail="Roster not found")

    my_matchup = db.query(Matchup).filter(
        Matchup.league_id == league.league_id, Matchup.week == week, Matchup.roster_id == roster_id
    ).first()

    opp_roster = None
    if my_matchup and my_matchup.matchup_id is not None:
        opp_matchup = db.query(Matchup).filter(
            Matchup.league_id == league.league_id,
            Matchup.week == week,
            Matchup.matchup_id == my_matchup.matchup_id,
            Matchup.roster_id != roster_id,
        ).first()
        if opp_matchup:
            opp_roster = db.query(Roster).filter(
                Roster.league_id == league.league_id, Roster.roster_id == opp_matchup.roster_id
            ).first()

    editable = week_editable(db, league, week)
    my_json = roster_week_snapshot(db, league, my_roster, week, editable)
    opp_json = roster_week_snapshot(db, league, opp_roster, week, editable)

    # Points are computed for both rosters' full player lists (whichever
    # snapshot - historical or live - was picked above), so bench players
    # (mine and the opponent's) show a score too, not just starters.
    relevant_ids = set()
    for rj in (my_json, opp_json):
        if rj:
            relevant_ids.update(p for p in rj["players"] if p and p != '0')

    week_points, week_stats, week_projections = week_points_and_projections(db, league, week, relevant_ids)

    return {
        "week": week,
        "roster_positions": json.loads(league.roster_positions) if league.roster_positions else [],
        "my_roster": my_json,
        "opp_roster": opp_json,
        "week_points": week_points,
        "week_stats": week_stats,
        "week_projections": week_projections,
        "editable": editable,
    }

@app.get("/league/{league_id}/matchup/current")
def get_current_matchup(league_id: str, user_id: str, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    my_roster = db.query(Roster).filter(
        Roster.league_id == league_id, Roster.owner_id == user_id
    ).first()
    if not my_roster:
        raise HTTPException(status_code=404, detail="You don't have a roster in this league")

    return matchup_payload(db, league, current_nfl_week(), my_roster.roster_id)

@app.get("/league/{league_id}/matchup/{week}/{roster_id}")
def get_matchup_for_roster(league_id: str, week: int, roster_id: int, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    return matchup_payload(db, league, week, roster_id)

@app.get("/current-week")
def get_current_week():
    return {"week": current_nfl_week()}

@app.get("/league/{league_id}/roster/{roster_id}/week/{week}")
def get_roster_week(league_id: str, roster_id: int, week: int, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    roster = db.query(Roster).filter(
        Roster.league_id == league_id, Roster.roster_id == roster_id
    ).first()
    if not roster:
        raise HTTPException(status_code=404, detail="Roster not found")

    editable = week_editable(db, league, week)
    snapshot = roster_week_snapshot(db, league, roster, week, editable)

    relevant_ids = {p for p in snapshot["players"] if p and p != '0'}
    week_points, week_stats, week_projections = week_points_and_projections(db, league, week, relevant_ids)

    return {
        "week": week,
        "editable": editable,
        "roster_positions": json.loads(league.roster_positions) if league.roster_positions else [],
        "week_points": week_points,
        "week_stats": week_stats,
        "week_projections": week_projections,
        **snapshot,
    }

@app.get("/league/{league_id}/bracket/{bracket_type}")
def get_bracket(league_id: str, bracket_type: str, db: Session = Depends(get_db)):
    rows = (
        db.query(BracketMatchup)
        .filter(BracketMatchup.league_id == league_id, BracketMatchup.bracket_type == bracket_type)
        .order_by(BracketMatchup.round, BracketMatchup.match_id)
        .all()
    )
    return [
        {
            "match_id": m.match_id,
            "round": m.round,
            "roster_id_1": m.roster_id_1,
            "roster_id_2": m.roster_id_2,
            "winner_roster_id": m.winner_roster_id,
            "loser_roster_id": m.loser_roster_id,
        }
        for m in rows
    ]

@app.get("/league/{league_id}/draft")
def get_draft(league_id: str, db: Session = Depends(get_db)):
    """Every pick from every draft this league has had (a league can have
    more than one - e.g. a startup draft plus a separate annual rookie
    draft), ordered so a multi-draft league's picks still read in a sane
    order: oldest draft first, then pick number within it."""
    rows = (
        db.query(DraftPick)
        .filter(DraftPick.league_id == league_id)
        .order_by(DraftPick.draft_id, DraftPick.pick_no)
        .all()
    )
    return [
        {
            "draft_id": p.draft_id,
            "pick_no": p.pick_no,
            "round": p.round,
            "draft_slot": p.draft_slot,
            "roster_id": p.roster_id,
            "picked_by": p.picked_by,
            "player_id": p.player_id,
            "is_keeper": p.is_keeper,
            "draft_type": p.draft_type,
        }
        for p in rows
    ]

@app.get("/league/{league_id}/users")
def get_users(league_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(LeagueUser, User.avatar)
        .outerjoin(User, User.user_id == LeagueUser.user_id)
        .filter(LeagueUser.league_id == league_id)
        .all()
    )
    return [
        {**{c.name: getattr(lu, c.name) for c in LeagueUser.__table__.columns}, "avatar": avatar}
        for lu, avatar in rows
    ]

@app.get("/account/{display_name}")
def get_account(display_name: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.display_name.ilike(display_name)).first()
    if not user:
        raise HTTPException(status_code=404, detail="No user with that display name")
    return user
