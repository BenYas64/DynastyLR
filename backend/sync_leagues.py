import json
import requests
from database import SessionLocal, League

def sync_leagues():
    db = SessionLocal()
    try:
        league_ids = [row[0] for row in db.query(League.league_id).all()]

        for league_id in league_ids:
            resp = requests.get(f"https://api.sleeper.app/v1/league/{league_id}", timeout=20)
            if resp.status_code != 200:
                print(f"{league_id}: request failed ({resp.status_code})")
                continue

            data = resp.json()
            league = db.query(League).filter(League.league_id == league_id).first()
            league.scoring_settings = json.dumps(data.get("scoring_settings"))
            league.roster_positions = json.dumps(data.get("roster_positions"))
            db.commit()
            print(f"{league_id}: {data.get('name')} updated")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_leagues()
