import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, Projection
from sync_stats import STAT_FIELDS, weeks_in_season

CURRENT_SEASON = 2026

# Projections cover Sleeper's entire draftable player pool (~9000+), unlike
# actual stats which only exist for players who played that week (a few
# hundred) - one INSERT for all of them at once is >2M bound parameters,
# which silently stalls rather than erroring. Chunking keeps each statement
# reasonably sized and gives visible per-chunk progress.
CHUNK_SIZE = 500

def sync_projections(season=CURRENT_SEASON, season_type="regular", weeks=None):
    db = SessionLocal()
    total = 0

    try:
        for week in (weeks if weeks is not None else weeks_in_season(season)):
            # A transient connection drop on one week (e.g. a Supabase blip
            # mid-chunk) shouldn't abort the whole multi-minute run - retry
            # that week a couple times, then move on rather than losing every
            # week after it.
            for attempt in range(3):
                try:
                    url = f"https://api.sleeper.app/v1/projections/nfl/{season_type}/{season}/{week}"
                    resp = requests.get(url, timeout=20)
                    if resp.status_code != 200:
                        break

                    data = resp.json()
                    if not data:
                        break

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

                    for i in range(0, len(rows), CHUNK_SIZE):
                        chunk = rows[i:i + CHUNK_SIZE]
                        stmt = insert(Projection).values(chunk)
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["player_id", "season", "week", "season_type"],
                            set_={field: stmt.excluded[field] for field in STAT_FIELDS},
                        )
                        db.execute(stmt)
                        db.commit()

                    total += len(rows)
                    print(f"{season} week {week}: {len(rows)} players")
                    break
                except Exception as e:
                    db.rollback()
                    print(f"{season} week {week}: attempt {attempt + 1} failed ({e})")

        print(f"Synced {total} projection rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_projections()
