import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, Projection
from sync_stats import STAT_FIELDS, weeks_in_season

CURRENT_SEASON = 2026

def sync_projections(season=CURRENT_SEASON, season_type="regular"):
    db = SessionLocal()
    total = 0

    try:
        for week in weeks_in_season(season):
            url = f"https://api.sleeper.app/v1/projections/nfl/{season_type}/{season}/{week}"
            resp = requests.get(url, timeout=20)
            if resp.status_code != 200:
                continue

            data = resp.json()
            if not data:
                continue

            rows = [
                {
                    "player_id": player_id,
                    "season": season,
                    "week": week,
                    "season_type": season_type,
                    **{field: p.get(field) for field in STAT_FIELDS},
                }
                for player_id, p in data.items()
            ]

            stmt = insert(Projection).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["player_id", "season", "week", "season_type"],
                set_={field: stmt.excluded[field] for field in STAT_FIELDS},
            )
            db.execute(stmt)
            db.commit()

            total += len(rows)
            print(f"{season} week {week}: {len(rows)} players")

        print(f"Synced {total} projection rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_projections()
