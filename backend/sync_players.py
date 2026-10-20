import json
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, Player

# Same reasoning as sync_projections.py: ~12,000 players x ~40 columns is
# well past Postgres's per-statement bound-parameter limit in one INSERT.
# Chunking keeps each statement sized safely under that and gives visible
# per-chunk progress.
CHUNK_SIZE = 500

def sync_players():
    print("Fetching players from Sleeper...")
    data = requests.get("https://api.sleeper.app/v1/players/nfl", timeout=30).json()

    db = SessionLocal()
    try:
        rows = []
        for player_id, p in data.items():
            if not p.get("position"):
                continue

            fp = p.get("fantasy_positions")
            rows.append({
                "player_id": player_id,
                "first_name": p.get("first_name"),
                "last_name": p.get("last_name"),
                "full_name": p.get("full_name"),
                "position": p.get("position"),
                "fantasy_positions": json.dumps(fp) if fp else None,
                "team": p.get("team"),
                "team_abbr": p.get("team_abbr"),
                "number": p.get("number"),
                "age": p.get("age"),
                "height": str(p.get("height")) if p.get("height") else None,
                "weight": str(p.get("weight")) if p.get("weight") else None,
                "college": p.get("college"),
                "high_school": p.get("high_school"),
                "birth_date": str(p.get("birth_date")) if p.get("birth_date") else None,
                "birth_city": p.get("birth_city"),
                "birth_state": p.get("birth_state"),
                "birth_country": p.get("birth_country"),
                "years_exp": p.get("years_exp"),
                "status": p.get("status"),
                "active": p.get("active"),
                "injury_status": p.get("injury_status"),
                "injury_body_part": p.get("injury_body_part"),
                "injury_notes": p.get("injury_notes"),
                "injury_start_date": str(p.get("injury_start_date")) if p.get("injury_start_date") else None,
                "practice_participation": p.get("practice_participation"),
                "practice_description": p.get("practice_description"),
                "depth_chart_position": p.get("depth_chart_position"),
                "depth_chart_order": p.get("depth_chart_order"),
                "search_rank": p.get("search_rank"),
                "sport": p.get("sport"),
                "sportradar_id": str(p.get("sportradar_id")) if p.get("sportradar_id") else None,
                "espn_id": str(p.get("espn_id")) if p.get("espn_id") else None,
                "yahoo_id": str(p.get("yahoo_id")) if p.get("yahoo_id") else None,
                "rotowire_id": str(p.get("rotowire_id")) if p.get("rotowire_id") else None,
                "rotoworld_id": str(p.get("rotoworld_id")) if p.get("rotoworld_id") else None,
                "fantasy_data_id": str(p.get("fantasy_data_id")) if p.get("fantasy_data_id") else None,
                "stats_id": str(p.get("stats_id")) if p.get("stats_id") else None,
                "gsis_id": p.get("gsis_id"),
                "hashtag": p.get("hashtag"),
                "news_updated": str(p.get("news_updated")) if p.get("news_updated") else None,
                "team_changed_at": str(p.get("team_changed_at")) if p.get("team_changed_at") else None,
            })

        update_fields = [k for k in rows[0].keys() if k != "player_id"] if rows else []

        # Most of the ~12,000 players' bios never change once set (name,
        # college, birthdate, external IDs) - only a smaller set (team,
        # injury status, depth chart, etc.) actually moves day to day.
        # Unlike the wide 271-column Stat/Projection tables, this table is
        # narrow enough that comparing every field directly is still a
        # cheap read - no need for a curated subset or a magnitude
        # threshold, just skip a row that's identical to what's stored.
        existing = {row.player_id: row for row in db.query(Player).all()}

        def changed(row):
            old = existing.get(row["player_id"])
            return old is None or any(row[f] != getattr(old, f) for f in update_fields)

        kept = [r for r in rows if changed(r)]
        skipped = len(rows) - len(kept)
        rows = kept

        for i in range(0, len(rows), CHUNK_SIZE):
            chunk = rows[i:i + CHUNK_SIZE]
            stmt = insert(Player).values(chunk)
            stmt = stmt.on_conflict_do_update(
                index_elements=["player_id"],
                set_={field: stmt.excluded[field] for field in update_fields},
            )
            db.execute(stmt)
            db.commit()

        print(f"Synced {len(rows)} players written, {skipped} unchanged skipped")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_players()
