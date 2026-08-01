import requests
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
                url = f"https://api.sleeper.app/v1/stats/nfl/{season}/{week}?season_type={season_type}"
                resp = requests.get(url)
                if resp.status_code != 200:
                    continue

                data = resp.json()
                if not data:
                    continue

                for player_id, s in data.items():
                    stat = db.query(Stat).filter(
                        Stat.player_id == player_id,
                        Stat.season == season,
                        Stat.week == week,
                        Stat.season_type == season_type,
                    ).first()

                    if not stat:
                        stat = Stat(
                            player_id=player_id,
                            season=season,
                            week=week,
                            season_type=season_type,
                        )
                        db.add(stat)

                    for field in STAT_FIELDS:
                        setattr(stat, field, s.get(field))

                total += len(data)
                print(f"{season} week {week}: {len(data)} players")

            db.commit()

        print(f"Synced {total} stat rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_stats()
