from sqlalchemy.dialects.postgresql import insert
import requests
from database import SessionLocal, League, User, LeagueUser

def sync_users():
    db = SessionLocal()
    total = 0

    try:
        league_ids = [row[0] for row in db.query(League.league_id).all()]

        for league_id in league_ids:
            resp = requests.get(f"https://api.sleeper.app/v1/league/{league_id}/users", timeout=20)
            if resp.status_code != 200:
                print(f"{league_id}: request failed ({resp.status_code})")
                continue

            users_data = resp.json()

            for u in users_data:
                user_stmt = insert(User).values(
                    user_id=u.get("user_id"),
                    username=u.get("username"),
                    display_name=u.get("display_name"),
                    avatar=u.get("avatar"),
                )
                user_stmt = user_stmt.on_conflict_do_update(
                    index_elements=["user_id"],
                    set_={
                        "username": user_stmt.excluded.username,
                        "display_name": user_stmt.excluded.display_name,
                        "avatar": user_stmt.excluded.avatar,
                    },
                )
                db.execute(user_stmt)

                # commish is set manually in Supabase - deliberately left out of the
                # update set so an existing membership row's flag is never touched,
                # only username/display_name stay in sync. New rows default to
                # false via the column's server-side default.
                lu_stmt = insert(LeagueUser).values(
                    league_id=league_id,
                    user_id=u.get("user_id"),
                    username=u.get("username"),
                    display_name=u.get("display_name"),
                )
                lu_stmt = lu_stmt.on_conflict_do_update(
                    index_elements=["league_id", "user_id"],
                    set_={
                        "username": lu_stmt.excluded.username,
                        "display_name": lu_stmt.excluded.display_name,
                    },
                )
                db.execute(lu_stmt)

            db.commit()
            total += len(users_data)
            print(f"{league_id}: synced {len(users_data)} users")

        print(f"Synced {total} league membership rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_users()
