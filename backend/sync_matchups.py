import json
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, League, Matchup, Stat
from scoring import is_current_season, expected_points_from_stats

def weeks_in_season(season):
    return range(1, 19) if season >= 2021 else range(1, 18)

# How far a historical week's frozen Sleeper score can drift from what our
# own synced stats say before it's worth a look - 3.0 cleanly caught both
# known real cases (a provider stats delay Sleeper never retroactively
# recomputed - see commit 6d1b77c's investigation) with zero false
# positives across every other 2023-2025 roster-week when tested.
MISMATCH_THRESHOLD = 3.0

def check_frozen_points(db, league, week, rows):
    """Sleeper's own matchup score for a historical (non-current-season)
    week is a frozen snapshot computed whenever that week closed - it never
    gets retroactively recomputed if the underlying player stats are
    corrected afterward (which our own stats sync does pick up). Compares
    each roster's just-imported `points` against expected_points_from_stats
    for that roster's starters and prints a warning on a big enough gap, so
    a repull surfaces this instead of it sitting wrong until someone
    happens to notice. Silently skipped if we have no stats for this
    season/week at all yet (nothing to compare against, not a real
    mismatch)."""
    has_stats = db.query(Stat.player_id).filter(
        Stat.season == league.season, Stat.week == week, Stat.season_type == "regular",
    ).first() is not None
    if not has_stats:
        return

    for row in rows:
        starters = json.loads(row["starters"]) if row["starters"] else []
        starter_ids = [s for s in starters if s and s != "0"]
        if not starter_ids:
            continue
        expected = expected_points_from_stats(db, league, week, starter_ids)
        actual = row["points"] or 0.0
        if abs(expected - actual) >= MISMATCH_THRESHOLD:
            print(
                f"  MISMATCH: {league.name} ({league.season}) week {week} roster {row['roster_id']}: "
                f"Sleeper says {actual}, stats imply {round(expected, 1)}"
            )

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
                is_current = is_current_season(db, league)
                if not is_current:
                    set_["points"] = stmt.excluded.points
                stmt = stmt.on_conflict_do_update(
                    index_elements=["league_id", "week", "roster_id"],
                    set_=set_,
                )
                db.execute(stmt)
                db.commit()

                total += len(rows)
                print(f"{league.league_id} week {week}: {len(rows)} rosters")

                if not is_current:
                    check_frozen_points(db, league, week, rows)

        print(f"Synced {total} matchup rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_matchups()
