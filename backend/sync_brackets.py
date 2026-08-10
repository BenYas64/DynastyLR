import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, League, BracketMatchup

BRACKET_TYPES = ["winners", "losers"]

def sync_brackets():
    db = SessionLocal()
    total = 0

    try:
        leagues = db.query(League).all()

        for league in leagues:
            for bracket_type in BRACKET_TYPES:
                url = f"https://api.sleeper.app/v1/league/{league.league_id}/{bracket_type}_bracket"
                resp = requests.get(url, timeout=20)
                if resp.status_code != 200:
                    print(f"{league.league_id} {bracket_type}: request failed ({resp.status_code})")
                    continue

                data = resp.json()
                if not data:
                    continue

                rows = [
                    {
                        "league_id": league.league_id,
                        "bracket_type": bracket_type,
                        "match_id": m.get("m"),
                        "round": m.get("r"),
                        "roster_id_1": m.get("t1"),
                        "roster_id_2": m.get("t2"),
                        "winner_roster_id": m.get("w"),
                        "loser_roster_id": m.get("l"),
                    }
                    for m in data
                    if m.get("m") is not None
                ]
                if not rows:
                    continue

                stmt = insert(BracketMatchup).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["league_id", "bracket_type", "match_id"],
                    set_={
                        "round": stmt.excluded.round,
                        "roster_id_1": stmt.excluded.roster_id_1,
                        "roster_id_2": stmt.excluded.roster_id_2,
                        "winner_roster_id": stmt.excluded.winner_roster_id,
                        "loser_roster_id": stmt.excluded.loser_roster_id,
                    },
                )
                db.execute(stmt)
                db.commit()

                total += len(rows)
                print(f"{league.league_id} {bracket_type}: {len(rows)} matches")

        print(f"Synced {total} bracket matches")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_brackets()
