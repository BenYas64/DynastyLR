from sqlalchemy.dialects.postgresql import insert
import requests
from database import SessionLocal, League, User, LeagueUser

def sync_users():
    db = SessionLocal()
    total = 0

    try:
        leagues = db.query(League).all()

        for league in leagues:
            league_id = league.league_id
            resp = requests.get(f"https://api.sleeper.app/v1/league/{league_id}/users", timeout=20)
            if resp.status_code != 200:
                print(f"{league_id}: request failed ({resp.status_code})")
                continue

            users_data = resp.json()

            # commish is set manually in Supabase per league, but a season
            # rollover creates a brand-new league_id (and so a brand-new
            # LeagueUser row) - without this, last year's commissioner would
            # silently lose commish status every single season.
            prev_commish = {}
            if league.previous_league_id:
                prev_commish = {
                    lu.user_id: lu.commish
                    for lu in db.query(LeagueUser).filter(LeagueUser.league_id == league.previous_league_id).all()
                }

            for u in users_data:
                metadata = u.get("metadata") or {}
                user_stmt = insert(User).values(
                    user_id=u.get("user_id"),
                    display_name=u.get("display_name"),
                    avatar=u.get("avatar"),
                )
                user_stmt = user_stmt.on_conflict_do_update(
                    index_elements=["user_id"],
                    set_={
                        "display_name": user_stmt.excluded.display_name,
                        "avatar": user_stmt.excluded.avatar,
                    },
                )
                db.execute(user_stmt)

                # commish itself is deliberately left out of the update set below
                # so an existing membership row's flag is never overwritten by a
                # re-sync - only the initial insert (a genuinely new row) sets it,
                # carried over from last season if this league has one.
                lu_stmt = insert(LeagueUser).values(
                    league_id=league_id,
                    user_id=u.get("user_id"),
                    display_name=u.get("display_name"),
                    team_name=metadata.get("team_name"),
                    team_avatar=metadata.get("avatar"),
                    commish=prev_commish.get(u.get("user_id"), False),
                )
                lu_stmt = lu_stmt.on_conflict_do_update(
                    index_elements=["league_id", "user_id"],
                    set_={
                        "display_name": lu_stmt.excluded.display_name,
                        "team_name": lu_stmt.excluded.team_name,
                        "team_avatar": lu_stmt.excluded.team_avatar,
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
