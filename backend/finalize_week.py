from database import SessionLocal, League
from scoring import is_current_season, recompute_matchup_points, recompute_season_records
from sync_stats import current_week

def finalize_week():
    """Scheduled Tuesday 1am - the week that just ended (current_week() - 1,
    by which point Sleeper's own state has already rolled over to the next
    week) gets its Matchup.points locked in from final stats and the
    season's wins/losses/ties rebuilt through that week, for every
    current-season league. A later correction (Wednesday 8am) re-runs this
    same recompute via sync_stats.py's --previous-week, so a result
    declared here isn't permanently frozen if the official stats change."""
    db = SessionLocal()
    try:
        week = current_week() - 1
        if week < 1:
            print("No completed week yet this season - nothing to finalize")
            return

        for league in db.query(League).all():
            if not is_current_season(db, league):
                continue
            recompute_matchup_points(db, league, week)
            recompute_season_records(db, league, through_week=week)
            print(f"{league.league_id} ({league.name}): finalized week {week}")
    finally:
        db.close()

if __name__ == "__main__":
    finalize_week()
