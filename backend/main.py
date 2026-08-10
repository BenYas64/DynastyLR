import json
import time
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from database import get_db, Player, Stat, User, League, Roster, LeagueUser, Matchup

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

NON_STAT_COLUMNS = {"player_id", "season", "week", "season_type", "team", "opponent"}

# FLEX-type roster slots don't literally match a player's fantasy_positions
# (e.g. no player is tagged "FLEX"), so they're expanded to the positions
# eligible to fill them.
FLEX_ELIGIBLE_POSITIONS = {
    "FLEX": ["RB", "WR", "TE"],
    "SUPER_FLEX": ["QB", "RB", "WR", "TE"],
    "WRRB_FLEX": ["WR", "RB"],
    "REC_FLEX": ["WR", "TE"],
}

def eligible_positions_for_roster(roster_positions):
    eligible = set()
    for slot in roster_positions:
        eligible.update(FLEX_ELIGIBLE_POSITIONS.get(slot, [slot]))
    return eligible

def player_to_dict(player):
    return {c.name: getattr(player, c.name) for c in Player.__table__.columns}

def scoring_expression(league):
    """SQL expression for a single stat row's fantasy points: a league's weighted
    scoring_settings if available, otherwise standard PPR."""
    total = Stat.pts_ppr
    if league and league.scoring_settings:
        scoring_settings = json.loads(league.scoring_settings)
        terms = [
            func.coalesce(getattr(Stat, key), 0) * weight
            for key, weight in scoring_settings.items()
            if weight and key not in NON_STAT_COLUMNS and hasattr(Stat, key)
        ]
        if terms:
            total = terms[0]
            for term in terms[1:]:
                total = total + term
    return total

CACHE_TTL_SECONDS = 3600
_points_cache = {}
_position_rank_cache = {}

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

@app.get("/players/browse")
def browse_players(
    q: str = "",
    league_id: str | None = None,
    available_only: bool = False,
    season: int = 2025,
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

    if available_only and league_id:
        rosters = db.query(Roster).filter(Roster.league_id == league_id).all()
        rostered_ids = set()
        for r in rosters:
            if r.players:
                rostered_ids.update(r.players)
        if rostered_ids:
            query = query.filter(Player.player_id.notin_(rostered_ids))

    points = season_points(db, league, season)

    ranked = sorted(
        query.all(),
        key=lambda p: points.get(p.player_id, 0),
        reverse=True,
    )

    total = len(ranked)
    page = []
    for player in ranked[offset:offset + limit]:
        data = player_to_dict(player)
        data["points"] = points.get(player.player_id, 0)
        page.append(data)

    return {"total": total, "players": page}

@app.get("/players/{player_id}")
def get_player(player_id: str, db: Session = Depends(get_db)):
    player = db.query(Player).filter(Player.player_id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    stats = db.query(Stat).filter(Stat.player_id == player_id).order_by(
        Stat.season.desc(), Stat.week.desc()
    ).all()
    return {"player": player, "stats": stats}

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

@app.get("/leagues/{user_id}")
def get_leagues(user_id: str, season: int = 2025, db: Session = Depends(get_db)):
    leagues = (
        db.query(League)
        .join(LeagueUser, LeagueUser.league_id == League.league_id)
        .filter(LeagueUser.user_id == user_id, League.season == season)
        .all()
    )
    return leagues

@app.get("/league/{league_id}")
def get_league(league_id: str, db: Session = Depends(get_db)):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    return league

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

    league.scoring_settings = json.dumps(payload.scoring_settings)
    db.commit()

    # Points/rank caches are keyed by (league_id, ...) and hold up to an hour -
    # without this they'd keep serving points computed under the old settings.
    for cache in (_points_cache, _position_rank_cache):
        for key in [k for k in cache if k[0] == league_id]:
            del cache[key]

    return {"league_id": league_id, "scoring_settings": payload.scoring_settings}

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
            "settings": {"wins": r.wins, "losses": r.losses, "fpts": r.fpts},
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
