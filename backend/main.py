from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import requests
from database import get_db, Player

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
