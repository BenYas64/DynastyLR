import sys
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, Projection
from sync_stats import STAT_FIELDS

CURRENT_SEASON = 2026

# Projections cover Sleeper's entire draftable player pool (~9000+), unlike
# actual stats which only exist for players who played that week (a few
# hundred) - one INSERT for all of them at once is >2M bound parameters,
# which silently stalls rather than erroring. Chunking keeps each statement
# reasonably sized and gives visible per-chunk progress.
#
# Projection/Stat rows carry ~270 columns (len(STAT_FIELDS)+4), so a chunk of
# 500 binds ~135,000 parameters in one statement - double Postgres's 65,535
# hard limit, and even when accepted, large enough that Supabase's pooler was
# killing it with "canceling statement due to statement timeout" more often
# than not (seen repeatedly in production - see sync_projections.log). 100
# rows keeps a chunk to ~27,000 parameters, comfortably inside both limits.
CHUNK_SIZE = 100

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
                    # str(e) on a SQLAlchemy statement error includes the full
                    # compiled SQL and every bound parameter - for a ~27,000-
                    # parameter chunk that's a multi-hundred-KB line. The
                    # actual error is always the first line; the rest is noise
                    # that once blew a log file up to 145MB in six weeks.
                    reason = str(e).splitlines()[0] if str(e) else repr(e)
                    print(f"{season} week {week}: attempt {attempt + 1} failed ({type(e).__name__}: {reason})")

        print(f"Synced {total} projection rows")
    except Exception as e:
        db.rollback()
        reason = str(e).splitlines()[0] if str(e) else repr(e)
        print(f"Error: {type(e).__name__}: {reason}")
    finally:
        db.close()

if __name__ == "__main__":
    # Daily runs (cron) just need the upcoming week refreshed. --all-weeks
    # (run weekly, e.g. Monday) rebuilds every remaining week's ROS estimate,
    # not the whole season - once a week is actually played, real stats take
    # over for it (week_points_and_projections only falls back to a
    # projection when there's no stat row) and its projection is never read
    # again, so rewriting all 18 weeks every run was pure waste that grew as
    # the season went on. Confirmed as the main driver of a Supabase
    # disk-IO-budget incident on 2026-10-19.
    if "--all-weeks" in sys.argv:
        sync_projections(weeks=range(upcoming_week(), 19))
    else:
        sync_projections()
