import json
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

def season_points_subquery(db, league, season):
    """Per-player summed points for the season: a league's weighted scoring_settings
    if available, otherwise standard PPR."""
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

    return (
        db.query(Stat.player_id, func.sum(total).label("points"))
        .filter(Stat.season == season, Stat.season_type == "regular")
        .group_by(Stat.player_id)
        .subquery()
    )

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

    points_subq = season_points_subquery(db, league, season)
    query = query.outerjoin(points_subq, Player.player_id == points_subq.c.player_id)

    total = query.count()

    rows = (
        query
        .add_columns(points_subq.c.points)
        .order_by(points_subq.c.points.desc().nullslast())
        .offset(offset)
        .limit(limit)
        .all()
    )

    players = []
    for player, points in rows:
        data = player_to_dict(player)
        data["points"] = points or 0
        players.append(data)

    return {"total": total, "players": players}

@app.get("/players/{player_id}")
def get_player(player_id: str, db: Session = Depends(get_db)):
    player = db.query(Player).filter(Player.player_id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    stats = db.query(Stat).filter(Stat.player_id == player_id).order_by(
        Stat.season.desc(), Stat.week.desc()
    ).all()
    return {"player": player, "stats": stats}

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
    return db.query(LeagueUser).filter(LeagueUser.league_id == league_id).all()

@app.get("/user/{username}")
def get_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username.ilike(username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.get("/account/{display_name}")
def get_account(display_name: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.display_name.ilike(display_name)).first()
    if not user:
        raise HTTPException(status_code=404, detail="No user with that display name")
    return user
