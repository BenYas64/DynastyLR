import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, TeamBye

# Every league this app tracks is 2023 or later (see League.season) - widen
# if an older season is ever added.
START_SEASON = 2023
END_SEASON = 2026

def sync_schedule(start_season=START_SEASON, end_season=END_SEASON):
    """Derives each NFL team's single regular-season bye week per season
    from Sleeper's real game-by-game schedule - undocumented endpoint (not
    under /v1/), found by testing, not from published Sleeper API docs, so
    treat it as liable to disappear. A bye is simply the one week in the
    season a team appears in neither a game's home nor away slot; every
    team has exactly one (verified against 2023-2026 before this script
    was written - see the per-game-average PAR/points work this feeds)."""
    db = SessionLocal()
    total = 0
    try:
        for season in range(start_season, end_season + 1):
            resp = requests.get(f"https://api.sleeper.app/schedule/nfl/regular/{season}", timeout=20)
            if resp.status_code != 200:
                print(f"{season}: schedule endpoint returned {resp.status_code}, skipped")
                continue
            games = resp.json()
            if not games:
                continue

            teams_by_week = {}
            for g in games:
                teams_by_week.setdefault(g["week"], set()).update([g["home"], g["away"]])
            all_teams = {t for teams in teams_by_week.values() for t in teams}
            weeks = sorted(teams_by_week.keys())

            rows = []
            for team in all_teams:
                bye_weeks = [w for w in weeks if team not in teams_by_week[w]]
                if len(bye_weeks) != 1:
                    print(f"{season} {team}: expected exactly 1 bye week, found {bye_weeks} - skipped")
                    continue
                rows.append({"season": season, "team": team, "week": bye_weeks[0]})

            if not rows:
                continue

            stmt = insert(TeamBye).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["season", "team"],
                set_={"week": stmt.excluded.week},
            )
            db.execute(stmt)
            db.commit()

            total += len(rows)
            print(f"{season}: {len(rows)} team byes synced")

        print(f"Synced {total} team-bye rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_schedule()
