import json
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, League, Matchup

def weeks_in_season(season):
    return range(1, 19) if season >= 2021 else range(1, 18)

def sync_matchups():
    db = SessionLocal()
    total = 0

    try:
        leagues = db.query(League).all()

        for league in leagues:
            for week in weeks_in_season(league.season):
                url = f"https://api.sleeper.app/v1/league/{league.league_id}/matchups/{week}"
                resp = requests.get(url, timeout=20)
                if resp.status_code != 200:
                    continue

                data = resp.json()
                if not data:
                    continue

                rows = [
                    {
                        "league_id": league.league_id,
                        "week": week,
                        "roster_id": m.get("roster_id"),
                        "matchup_id": m.get("matchup_id"),
                        "points": m.get("points"),
                        "players": json.dumps(m.get("players")),
                    }
                    for m in data
                    if m.get("roster_id") is not None
                ]
                if not rows:
                    continue

                stmt = insert(Matchup).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["league_id", "week", "roster_id"],
                    set_={
                        "matchup_id": stmt.excluded.matchup_id,
                        "points": stmt.excluded.points,
                        "players": stmt.excluded.players,
                    },
                )
                db.execute(stmt)
                db.commit()

                total += len(rows)
                print(f"{league.league_id} week {week}: {len(rows)} rosters")

        print(f"Synced {total} matchup rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_matchups()
