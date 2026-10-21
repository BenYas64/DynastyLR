from datetime import datetime, timezone
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, PlayerValue

# Fixed for every combo - every league in this project is 12 teams,
# Superflex (numQbs=2). PPR/TEP are the only axes that vary per league
# (see League.value_ppr/value_tep), so those are the only ones multiplied
# out here.
NUM_TEAMS = 12
NUM_QBS = 2
PPR_VALUES = [0, 0.5, 1]
# FantasyCalc's real query values, reverse-engineered from their own JS
# bundle (not documented) - "none"/"te+"/"te++", mapped from our stored
# numeric tiers 0/0.5/1.0.
TEP_PARAM_BY_TIER = {0: "none", 0.5: "te+", 1.0: "te++"}

def sync_player_values():
    db = SessionLocal()
    total = 0
    try:
        now = datetime.now(timezone.utc)
        for is_dynasty in (True, False):
            for ppr in PPR_VALUES:
                for tep_tier, tep_param in TEP_PARAM_BY_TIER.items():
                    # tep's real values ("te+", "te++") contain a literal
                    # "+" that a hand-built query string sends unencoded -
                    # the server then reads it as a space (standard query
                    # string convention) and 404s. params= lets requests
                    # percent-encode it correctly (%2B).
                    resp = requests.get(
                        "https://api.fantasycalc.com/values/current",
                        params={
                            "isDynasty": "true" if is_dynasty else "false",
                            "numQbs": NUM_QBS,
                            "numTeams": NUM_TEAMS,
                            "ppr": ppr,
                            "tep": tep_param,
                        },
                        timeout=20,
                        headers={"User-Agent": "DynastyLR/1.0"},
                    )
                    if resp.status_code != 200:
                        print(f"dynasty={is_dynasty} ppr={ppr} tep={tep_param}: request failed ({resp.status_code})")
                        continue
                    data = resp.json()

                    rows = [
                        {
                            "player_id": sleeper_id,
                            "is_dynasty": is_dynasty,
                            "ppr": ppr,
                            "tep": tep_tier,
                            "value": entry.get("value"),
                            "overall_rank": entry.get("overallRank"),
                            "position_rank": entry.get("positionRank"),
                            "trend_30_day": entry.get("trend30Day"),
                            "fetched_at": now,
                        }
                        for entry in data
                        # Draft picks come back as entries too (e.g. "2027
                        # 1st"), with a synthetic sleeperId like
                        # "FP_2027_early_0" that doesn't match any real
                        # player - this table is players only.
                        for sleeper_id in [entry["player"].get("sleeperId")]
                        if entry["player"].get("position") != "PICK" and sleeper_id and sleeper_id.isdigit()
                    ]
                    if not rows:
                        continue

                    stmt = insert(PlayerValue).values(rows)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["player_id", "is_dynasty", "ppr", "tep"],
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
                    total += len(rows)
                    print(f"dynasty={is_dynasty} ppr={ppr} tep={tep_param}: {len(rows)} players")

        print(f"Synced {total} player value rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_player_values()
