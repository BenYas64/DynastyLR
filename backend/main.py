import json
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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

@app.get("/players")
def get_players(db: Session = Depends(get_db)):
    players = db.query(Player).filter(Player.active == True).all()
    return players

@app.get("/players/search")
def search_players(q: str, db: Session = Depends(get_db)):
    players = db.query(Player).filter(
        Player.active == True,
        Player.full_name.ilike(f"%{q}%")
    ).limit(20).all()
    return players

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
