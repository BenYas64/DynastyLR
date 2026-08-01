from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import requests
from database import get_db, Player, Stat

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
def get_leagues(user_id: str):
    response = requests.get(f"https://api.sleeper.app/v1/user/{user_id}/leagues/nfl/2025")
    return response.json()

@app.get("/league/{league_id}/rosters")
def get_rosters(league_id: str):
    response = requests.get(f"https://api.sleeper.app/v1/league/{league_id}/rosters")
    return response.json()

@app.get("/league/{league_id}/matchups/{week}")
def get_matchups(league_id: str, week: int):
    response = requests.get(f"https://api.sleeper.app/v1/league/{league_id}/matchups/{week}")
    return response.json()

@app.get("/league/{league_id}/users")
def get_users(league_id: str):
    response = requests.get(f"https://api.sleeper.app/v1/league/{league_id}/users")
    return response.json()

@app.get("/user/{username}")
def get_user(username: str):
    response = requests.get(f"https://api.sleeper.app/v1/user/{username}")
    return response.json()
