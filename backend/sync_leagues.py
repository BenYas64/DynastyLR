import json
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, SleeperUser, League, UserLeague, Roster, LeagueUser

DEFAULT_USERNAME = "CoolBen9880"
DEFAULT_SEASON = 2025


def upsert(db, model, rows, index_elements):
    if not rows:
        return
    update_cols = {k: v for k, v in rows[0].items() if k not in index_elements}
    stmt = insert(model).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=index_elements,
        set_={col: stmt.excluded[col] for col in update_cols},
    )
    db.execute(stmt)


def sync_user_leagues(username=DEFAULT_USERNAME, season=DEFAULT_SEASON):
    db = SessionLocal()
    try:
        user = requests.get(f"https://api.sleeper.app/v1/user/{username}", timeout=15).json()
        if not user or "user_id" not in user:
            print(f"User '{username}' not found on Sleeper")
            return

        upsert(db, SleeperUser, [{
            "user_id": user["user_id"],
            "username": user.get("username"),
            "display_name": user.get("display_name"),
            "avatar": user.get("avatar"),
        }], ["user_id"])
        db.commit()
        print(f"Synced user {username} ({user['user_id']})")

        leagues = requests.get(
            f"https://api.sleeper.app/v1/user/{user['user_id']}/leagues/nfl/{season}", timeout=15
        ).json()

        for league in leagues:
            league_id = league["league_id"]

            upsert(db, League, [{
                "league_id": league_id,
                "name": league.get("name"),
                "season": season,
                "status": league.get("status"),
                "total_rosters": league.get("total_rosters"),
            }], ["league_id"])

            upsert(db, UserLeague, [{
                "user_id": user["user_id"],
                "league_id": league_id,
                "season": season,
            }], ["user_id", "league_id"])
            db.commit()

            rosters = requests.get(
                f"https://api.sleeper.app/v1/league/{league_id}/rosters", timeout=15
            ).json()
            roster_rows = [
                {
                    "league_id": league_id,
                    "roster_id": r["roster_id"],
                    "owner_id": r.get("owner_id"),
                    "wins": r.get("settings", {}).get("wins"),
                    "losses": r.get("settings", {}).get("losses"),
                    "fpts": r.get("settings", {}).get("fpts"),
                    "players": json.dumps(r.get("players") or []),
                    "starters": json.dumps(r.get("starters") or []),
                }
                for r in rosters
            ]
            upsert(db, Roster, roster_rows, ["league_id", "roster_id"])
            db.commit()

            league_users = requests.get(
                f"https://api.sleeper.app/v1/league/{league_id}/users", timeout=15
            ).json()
            league_user_rows = [
                {
                    "league_id": league_id,
                    "user_id": u["user_id"],
                    "username": u.get("username"),
                    "display_name": u.get("display_name"),
                }
                for u in league_users
            ]
            upsert(db, LeagueUser, league_user_rows, ["league_id", "user_id"])
            db.commit()

            print(f"Synced league '{league.get('name')}' ({league_id}): "
                  f"{len(roster_rows)} rosters, {len(league_user_rows)} users")

        print(f"Done. Synced {len(leagues)} league(s) for {username}.")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    sync_user_leagues()
