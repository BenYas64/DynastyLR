import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, League, TradedPick
from scoring import is_current_season

def sync_traded_picks():
    """Future draft-pick ownership, from Sleeper's /league/{league_id}/traded_picks.
    Only meaningful for each dynasty chain's current/active league - that's
    the only league_id Sleeper keeps this endpoint up to date for (see
    TradedPick's docstring). Full delete-then-reinsert per league rather than
    an upsert: a pick traded back to its original owner just disappears from
    Sleeper's response, and an upsert alone wouldn't remove that stale row."""
    db = SessionLocal()
    total = 0
    try:
        leagues = db.query(League).all()

        for league in leagues:
            if not is_current_season(db, league):
                continue

            resp = requests.get(f"https://api.sleeper.app/v1/league/{league.league_id}/traded_picks", timeout=20)
            if resp.status_code != 200:
                print(f"{league.league_id}: request failed ({resp.status_code})")
                continue

            picks = resp.json()

            db.query(TradedPick).filter(TradedPick.league_id == league.league_id).delete()

            if picks:
                rows = [
                    {
                        "league_id": league.league_id,
                        "season": int(p["season"]),
                        "round": p["round"],
                        "roster_id": p["roster_id"],
                        "owner_id": p["owner_id"],
                    }
                    for p in picks
                ]
                stmt = insert(TradedPick).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["league_id", "season", "round", "roster_id"],
                    set_={"owner_id": stmt.excluded.owner_id},
                )
                db.execute(stmt)

            db.commit()
            total += len(picks)
            print(f"{league.league_id}: {len(picks)} traded picks")

        print(f"Synced {total} traded pick rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_traded_picks()
