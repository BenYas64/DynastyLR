import json
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, League, Matchup
from scoring import is_current_season

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
                        "starters": json.dumps(m.get("starters")),
                    }
                    for m in data
                    if m.get("roster_id") is not None
                ]
                if not rows:
                    continue

                stmt = insert(Matchup).values(rows)
                set_ = {
                    "matchup_id": stmt.excluded.matchup_id,
                    "players": stmt.excluded.players,
                    "starters": stmt.excluded.starters,
                }
                # The current season's points are computed in-app from live
                # stats (see scoring.recompute_matchup_points, called from
                # sync_stats.py/finalize_week.py) - a manual re-run here
                # shouldn't clobber that with Sleeper's own (often stale)
                # import. Completed/historical seasons keep importing points
                # as-is, since nothing recomputes those.
                if not is_current_season(db, league):
                    set_["points"] = stmt.excluded.points
                stmt = stmt.on_conflict_do_update(
                    index_elements=["league_id", "week", "roster_id"],
                    set_=set_,
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
