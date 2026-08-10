import requests
from database import SessionLocal, Player, init_db
import json

def sync_players():
    print("Fetching players from Sleeper...")
    data = requests.get("https://api.sleeper.app/v1/players/nfl").json()
    
    db = SessionLocal()
    count = 0
    
    try:
        for player_id, p in data.items():
            if not p.get("position"):
                continue

            player = db.query(Player).filter(Player.player_id == player_id).first()
            
            fp = p.get("fantasy_positions")
            fp_str = json.dumps(fp) if fp else None

            if player:
                # Update existing
                player.first_name = p.get("first_name")
                player.last_name = p.get("last_name")
                player.full_name = p.get("full_name")
                player.position = p.get("position")
                player.fantasy_positions = fp_str
                player.team = p.get("team")
                player.team_abbr = p.get("team_abbr")
                player.number = p.get("number")
                player.age = p.get("age")
                player.height = str(p.get("height")) if p.get("height") else None
                player.weight = str(p.get("weight")) if p.get("weight") else None
                player.college = p.get("college")
                player.high_school = p.get("high_school")
                player.birth_date = str(p.get("birth_date")) if p.get("birth_date") else None
                player.birth_city = p.get("birth_city")
                player.birth_state = p.get("birth_state")
                player.birth_country = p.get("birth_country")
                player.years_exp = p.get("years_exp")
                player.status = p.get("status")
                player.active = p.get("active")
                player.injury_status = p.get("injury_status")
                player.injury_body_part = p.get("injury_body_part")
                player.injury_notes = p.get("injury_notes")
                player.injury_start_date = str(p.get("injury_start_date")) if p.get("injury_start_date") else None
                player.practice_participation = p.get("practice_participation")
                player.practice_description = p.get("practice_description")
                player.depth_chart_position = p.get("depth_chart_position")
                player.depth_chart_order = p.get("depth_chart_order")
                player.search_rank = p.get("search_rank")
                player.sport = p.get("sport")
                player.sportradar_id = str(p.get("sportradar_id")) if p.get("sportradar_id") else None
                player.espn_id = str(p.get("espn_id")) if p.get("espn_id") else None
                player.yahoo_id = str(p.get("yahoo_id")) if p.get("yahoo_id") else None
                player.rotowire_id = str(p.get("rotowire_id")) if p.get("rotowire_id") else None
                player.rotoworld_id = str(p.get("rotoworld_id")) if p.get("rotoworld_id") else None
                player.fantasy_data_id = str(p.get("fantasy_data_id")) if p.get("fantasy_data_id") else None
                player.stats_id = str(p.get("stats_id")) if p.get("stats_id") else None
                player.gsis_id = p.get("gsis_id")
                player.hashtag = p.get("hashtag")
                player.news_updated = str(p.get("news_updated")) if p.get("news_updated") else None
                player.team_changed_at = str(p.get("team_changed_at")) if p.get("team_changed_at") else None
            else:
                # Insert new
                new_player = Player(
                    player_id=player_id,
                    first_name=p.get("first_name"),
                    last_name=p.get("last_name"),
                    full_name=p.get("full_name"),
                    position=p.get("position"),
                    fantasy_positions=fp_str,
                    team=p.get("team"),
                    team_abbr=p.get("team_abbr"),
                    number=p.get("number"),
                    age=p.get("age"),
                    height=str(p.get("height")) if p.get("height") else None,
                    weight=str(p.get("weight")) if p.get("weight") else None,
                    college=p.get("college"),
                    high_school=p.get("high_school"),
                    birth_date=str(p.get("birth_date")) if p.get("birth_date") else None,
                    birth_city=p.get("birth_city"),
                    birth_state=p.get("birth_state"),
                    birth_country=p.get("birth_country"),
                    years_exp=p.get("years_exp"),
                    status=p.get("status"),
                    active=p.get("active"),
                    injury_status=p.get("injury_status"),
                    injury_body_part=p.get("injury_body_part"),
                    injury_notes=p.get("injury_notes"),
                    injury_start_date=str(p.get("injury_start_date")) if p.get("injury_start_date") else None,
                    practice_participation=p.get("practice_participation"),
                    practice_description=p.get("practice_description"),
                    depth_chart_position=p.get("depth_chart_position"),
                    depth_chart_order=p.get("depth_chart_order"),
                    search_rank=p.get("search_rank"),
                    sport=p.get("sport"),
                    sportradar_id=str(p.get("sportradar_id")) if p.get("sportradar_id") else None,
                    espn_id=str(p.get("espn_id")) if p.get("espn_id") else None,
                    yahoo_id=str(p.get("yahoo_id")) if p.get("yahoo_id") else None,
                    rotowire_id=str(p.get("rotowire_id")) if p.get("rotowire_id") else None,
                    rotoworld_id=str(p.get("rotoworld_id")) if p.get("rotoworld_id") else None,
                    fantasy_data_id=str(p.get("fantasy_data_id")) if p.get("fantasy_data_id") else None,
                    stats_id=str(p.get("stats_id")) if p.get("stats_id") else None,
                    gsis_id=p.get("gsis_id"),
                    hashtag=p.get("hashtag"),
                    news_updated=str(p.get("news_updated")) if p.get("news_updated") else None,
                    team_changed_at=str(p.get("team_changed_at")) if p.get("team_changed_at") else None,
                )
                db.add(new_player)
            count += 1

        db.commit()
        print(f"Synced {count} players successfully")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_players()
