from datetime import datetime, timezone
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, PlayerValue

# Matches this project's actual league: half-PPR (rec=0.5 in league
# scoring_settings), Superflex (a SUPER_FLEX roster slot => numQbs=2),
# 12 teams. FantasyCalc returns different values per format, so these
# aren't arbitrary - they're what makes the stored values meaningful for
# this league specifically.
FANTASYCALC_URL = "https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5"

def sync_player_values():
    db = SessionLocal()
    try:
        resp = requests.get(FANTASYCALC_URL, timeout=20, headers={"User-Agent": "DynastyLR/1.0"})
        resp.raise_for_status()
        data = resp.json()

        now = datetime.now(timezone.utc)
        rows = [
            {
                "player_id": entry["player"]["sleeperId"],
                "value": entry.get("value"),
                "overall_rank": entry.get("overallRank"),
                "position_rank": entry.get("positionRank"),
                "trend_30_day": entry.get("trend30Day"),
                "fetched_at": now,
            }
            for entry in data
            # Draft picks come back as entries too (e.g. "2027 1st"), with a
            # synthetic sleeperId like "FP_2027_early_0" that doesn't match
            # any real player - this table is players only.
            for sleeper_id in [entry["player"].get("sleeperId")]
            if entry["player"].get("position") != "PICK" and sleeper_id and sleeper_id.isdigit()
        ]

        stmt = insert(PlayerValue).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["player_id"],
            set_={
                "value": stmt.excluded.value,
                "overall_rank": stmt.excluded.overall_rank,
                "position_rank": stmt.excluded.position_rank,
                "trend_30_day": stmt.excluded.trend_30_day,
                "fetched_at": stmt.excluded.fetched_at,
            },
        )
        db.execute(stmt)
        db.commit()
        print(f"Synced {len(rows)} player values")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_player_values()
