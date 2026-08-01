import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, Stat

START_SEASON = 2017
END_SEASON = 2025

STAT_FIELDS = [
    "team", "opponent",
    "pts_ppr", "pts_half_ppr", "pts_std",
    "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int",
    "rush_att", "rush_yd", "rush_td",
    "rec", "rec_yd", "rec_td", "rec_tgt",
    "fum_lost",
]

def weeks_in_season(season):
    return range(1, 19) if season >= 2021 else range(1, 18)

def sync_stats(start_season=START_SEASON, end_season=END_SEASON, season_type="regular"):
    db = SessionLocal()
    total = 0

    try:
        for season in range(start_season, end_season + 1):
            for week in weeks_in_season(season):
                url = f"https://api.sleeper.app/v1/stats/nfl/{season_type}/{season}/{week}"
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
                        **{field: s.get(field) for field in STAT_FIELDS},
                    }
                    for player_id, s in data.items()
                ]

                stmt = insert(Stat).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["player_id", "season", "week", "season_type"],
                    set_={field: stmt.excluded[field] for field in STAT_FIELDS},
                )
                db.execute(stmt)
                db.commit()

                total += len(rows)
                print(f"{season} week {week}: {len(rows)} players")

        print(f"Synced {total} stat rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_stats()
