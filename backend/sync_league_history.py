import json
import requests
from database import SessionLocal, League

# Used to discover a league's continuation into a season we don't have a
# league_id for yet (Sleeper only exposes that via a per-user, per-season
# lookup, not a "next" pointer on the league itself).
OWNER_USER_ID = "911700661134299136"

def fetch_league(league_id):
    resp = requests.get(f"https://api.sleeper.app/v1/league/{league_id}", timeout=20)
    if resp.status_code != 200:
        return None
    return resp.json()

def upsert_league(db, league_id, data):
    league = db.query(League).filter(League.league_id == league_id).first()
    if not league:
        league = League(league_id=league_id)
        db.add(league)
    league.name = data.get("name")
    league.season = int(data["season"]) if data.get("season") else None
    league.status = data.get("status")
    league.total_rosters = data.get("total_rosters")
    league.scoring_settings = json.dumps(data.get("scoring_settings"))
    league.roster_positions = json.dumps(data.get("roster_positions"))
    league.playoff_week_start = data.get("settings", {}).get("playoff_week_start")
    prev = data.get("previous_league_id")
    league.previous_league_id = prev if prev and prev != "0" else None
    db.commit()

def sync_league_history():
    db = SessionLocal()
    try:
        known_ids = {row[0] for row in db.query(League.league_id).all()}
        seasons = {row[0] for row in db.query(League.season).all() if row[0]}
        max_season = max(seasons) if seasons else None

        # Forward: check the next season for a continuation of any league we
        # already know, in case it's rolled over and we don't have its new
        # league_id yet.
        if max_season:
            next_season = max_season + 1
            resp = requests.get(
                f"https://api.sleeper.app/v1/user/{OWNER_USER_ID}/leagues/nfl/{next_season}",
                timeout=20,
            )
            if resp.status_code == 200:
                for data in resp.json():
                    prev = data.get("previous_league_id")
                    if prev in known_ids:
                        league_id = data["league_id"]
                        known_ids.add(league_id)
                        upsert_league(db, league_id, data)
                        print(f"discovered rollover: {league_id} ({data.get('name')}, season {data.get('season')})")

        # Backward: walk previous_league_id from everything we know, until no
        # new leagues are found.
        frontier = list(known_ids)
        while frontier:
            league_id = frontier.pop()
            data = fetch_league(league_id)
            if not data:
                continue
            upsert_league(db, league_id, data)

            prev = data.get("previous_league_id")
            if prev and prev != "0" and prev not in known_ids:
                known_ids.add(prev)
                frontier.append(prev)
                print(f"discovered: {prev}")

        print(f"League history now covers {len(known_ids)} league_ids")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_league_history()
