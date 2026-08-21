import sys
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

# Sleeper's raw projections run high on certain fields relative to how they
# actually turn out - scale those down here so stored projections (and the
# fantasy points computed from them) track reality more closely. Add more
# entries as other fields turn out to need the same correction.
FIELD_ADJUSTMENTS = {
    "rush_fd": 0.45,
    "rec_fd": 0.40,
    "pass_fd": 0.40,
}

def adjust(field, value):
    multiplier = FIELD_ADJUSTMENTS.get(field)
    return value * multiplier if multiplier is not None and value is not None else value

def upcoming_week():
    """Sleeper's own notion of the current week - same source main.py's
    current_nfl_week() reads. Projections only mean anything once the
    regular season is under way, so preseason/offseason map to week 1."""
    resp = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=10)
    resp.raise_for_status()
    state = resp.json()
    return state.get("week") or 1 if state.get("season_type") == "regular" else 1

def sync_projections(season=CURRENT_SEASON, season_type="regular", weeks=None):
    db = SessionLocal()
    total = 0

    try:
        for week in (weeks if weeks is not None else [upcoming_week()]):
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
                            **{field: adjust(field, p.get(field)) for field in STAT_FIELDS},
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
    # Daily runs (cron) just need the upcoming week refreshed; --all-weeks
    # (run weekly, e.g. Monday) rebuilds the full season - projections for
    # already-played weeks still shift as Sleeper updates ROS estimates.
    if "--all-weeks" in sys.argv:
        sync_projections(weeks=weeks_in_season(CURRENT_SEASON))
    else:
        sync_projections()
