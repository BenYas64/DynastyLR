import json
import requests
from database import SessionLocal, League

# CoolBen9880 - leagues get added to the leagues table by discovering every
# league this user is in for a season (Sleeper has no "all leagues containing
# this league_id's chain" lookup, only "all of a user's leagues"), not by
# something adding them automatically when the user joins one on Sleeper.
BEN_USER_ID = "911700661134299136"
CURRENT_SEASON = 2026

# The value tiers player_values is actually stored for (see
# sync_player_values.py) - a league's real scoring_settings rec/TE-bonus
# weight is snapped to whichever of these it's closest to, so every league
# maps onto a combination we actually have data for.
VALUE_TIERS = [0, 0.5, 1.0]

def nearest_value_tier(weight):
    return min(VALUE_TIERS, key=lambda t: abs((weight or 0) - t))

def discover_leagues(season, user_id=BEN_USER_ID):
    """Adds any of this user's leagues for `season` that aren't in the
    leagues table yet - a season rollover or a brand new league both show up
    here, since Sleeper's per-user league list is the only way to find a
    league_id without already knowing it."""
    db = SessionLocal()
    added = 0
    try:
        existing_ids = {row[0] for row in db.query(League.league_id).all()}

        resp = requests.get(f"https://api.sleeper.app/v1/user/{user_id}/leagues/nfl/{season}", timeout=20)
        resp.raise_for_status()
        for l in resp.json():
            league_id = l.get("league_id")
            if league_id in existing_ids:
                continue

            detail_resp = requests.get(f"https://api.sleeper.app/v1/league/{league_id}", timeout=20)
            if detail_resp.status_code != 200:
                print(f"{league_id}: detail request failed ({detail_resp.status_code})")
                continue
            data = detail_resp.json()
            scoring = data.get("scoring_settings") or {}

            db.add(League(
                league_id=league_id,
                name=data.get("name"),
                season=data.get("season"),
                status=data.get("status"),
                total_rosters=data.get("total_rosters"),
                scoring_settings=json.dumps(scoring),
                roster_positions=json.dumps(data.get("roster_positions")),
                playoff_week_start=data.get("settings", {}).get("playoff_week_start"),
                previous_league_id=data.get("previous_league_id"),
                league_median=False,
                value_ppr=nearest_value_tier(scoring.get("rec")),
                value_tep=nearest_value_tier(scoring.get("bonus_rec_te")),
            ))
            db.commit()
            added += 1
            print(f"{league_id}: added ({data.get('name')}, {data.get('season')})")

        print(f"Discovered {added} new league(s)")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

def sync_leagues():
    db = SessionLocal()
    try:
        league_ids = [row[0] for row in db.query(League.league_id).all()]

        for league_id in league_ids:
            resp = requests.get(f"https://api.sleeper.app/v1/league/{league_id}", timeout=20)
            if resp.status_code != 200:
                print(f"{league_id}: request failed ({resp.status_code})")
                continue

            data = resp.json()
            scoring = data.get("scoring_settings") or {}
            league = db.query(League).filter(League.league_id == league_id).first()
            league.scoring_settings = json.dumps(scoring)
            league.roster_positions = json.dumps(data.get("roster_positions"))
            league.playoff_week_start = data.get("settings", {}).get("playoff_week_start")
            # Only fill these in if unset - a commissioner's own choice (via
            # the value-settings page) should never get silently overwritten
            # by a routine sync just because scoring_settings was re-fetched.
            if league.value_ppr is None:
                league.value_ppr = nearest_value_tier(scoring.get("rec"))
            if league.value_tep is None:
                league.value_tep = nearest_value_tier(scoring.get("bonus_rec_te"))
            db.commit()
            print(f"{league_id}: {data.get('name')} updated")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    discover_leagues(CURRENT_SEASON)
    sync_leagues()
