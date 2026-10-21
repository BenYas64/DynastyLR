import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, League, DraftPick

def sync_drafts():
    db = SessionLocal()
    total = 0

    try:
        leagues = db.query(League).all()

        for league in leagues:
            resp = requests.get(f"https://api.sleeper.app/v1/league/{league.league_id}/drafts", timeout=20)
            if resp.status_code != 200:
                print(f"{league.league_id}: request failed ({resp.status_code})")
                continue

            drafts = resp.json()
            if not drafts:
                continue

            for draft in drafts:
                draft_id = draft.get("draft_id")
                picks_resp = requests.get(f"https://api.sleeper.app/v1/draft/{draft_id}/picks", timeout=20)
                if picks_resp.status_code != 200:
                    print(f"{league.league_id} draft {draft_id}: picks request failed ({picks_resp.status_code})")
                    continue

                picks = picks_resp.json()
                if not picks:
                    continue

                rows = [
                    {
                        "league_id": league.league_id,
                        "draft_id": draft_id,
                        "pick_no": p.get("pick_no"),
                        "round": p.get("round"),
                        "draft_slot": p.get("draft_slot"),
                        "roster_id": p.get("roster_id"),
                        "picked_by": p.get("picked_by"),
                        "player_id": p.get("player_id"),
                        "is_keeper": p.get("is_keeper"),
                    }
                    for p in picks
                ]

                stmt = insert(DraftPick).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["league_id", "draft_id", "pick_no"],
                    set_={
                        "round": stmt.excluded.round,
                        "draft_slot": stmt.excluded.draft_slot,
                        "roster_id": stmt.excluded.roster_id,
                        "picked_by": stmt.excluded.picked_by,
                        "player_id": stmt.excluded.player_id,
                        "is_keeper": stmt.excluded.is_keeper,
                    },
                )
                db.execute(stmt)
                db.commit()

                total += len(rows)
                print(f"{league.league_id} draft {draft_id}: {len(rows)} picks")

        print(f"Synced {total} draft pick rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_drafts()
