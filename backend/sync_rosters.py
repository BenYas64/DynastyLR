import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, League, Roster

def sync_rosters():
    db = SessionLocal()
    total = 0

    try:
        leagues = db.query(League).all()

        for league in leagues:
            resp = requests.get(f"https://api.sleeper.app/v1/league/{league.league_id}/rosters", timeout=20)
            if resp.status_code != 200:
                print(f"{league.league_id}: request failed ({resp.status_code})")
                continue

            data = resp.json()
            if not data:
                continue

            rows = []
            for r in data:
                settings = r.get("settings") or {}
                fpts = (settings.get("fpts") or 0) + (settings.get("fpts_decimal") or 0) / 100
                rows.append({
                    "league_id": league.league_id,
                    "roster_id": r.get("roster_id"),
                    "owner_id": r.get("owner_id"),
                    "wins": settings.get("wins"),
                    "losses": settings.get("losses"),
                    "ties": settings.get("ties"),
                    "fpts": fpts,
                    "players": r.get("players"),
                    "starters": r.get("starters"),
                })

            stmt = insert(Roster).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["league_id", "roster_id"],
                set_={
                    "owner_id": stmt.excluded.owner_id,
                    "wins": stmt.excluded.wins,
                    "losses": stmt.excluded.losses,
                    "ties": stmt.excluded.ties,
                    "fpts": stmt.excluded.fpts,
                    "players": stmt.excluded.players,
                    "starters": stmt.excluded.starters,
                },
            )
            db.execute(stmt)
            db.commit()

            total += len(rows)
            print(f"{league.league_id}: synced {len(rows)} rosters")

        print(f"Synced {total} roster rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_rosters()
