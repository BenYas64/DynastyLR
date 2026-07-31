from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "postgresql://postgres.xzztltkhgdywqryqbsov:duxrok-Xajmaj-kohpa0@aws-0-us-east-2.pooler.supabase.com:5432/postgres"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Player(Base):
    __tablename__ = "players"
    player_id = Column(String, primary_key=True)
    first_name = Column(String)
    last_name = Column(String)
    full_name = Column(String)
    position = Column(String)
    fantasy_positions = Column(String)
    team = Column(String)
    team_abbr = Column(String)
    number = Column(Integer)
    age = Column(Integer)
    height = Column(String)
    weight = Column(String)
    college = Column(String)
    high_school = Column(String)
    birth_date = Column(String)
    birth_city = Column(String)
    birth_state = Column(String)
    birth_country = Column(String)
    years_exp = Column(Integer)
    status = Column(String)
    active = Column(Boolean)
    injury_status = Column(String)
    injury_body_part = Column(String)
    injury_notes = Column(String)
    injury_start_date = Column(String)
    practice_participation = Column(String)
    practice_description = Column(String)
    depth_chart_position = Column(String)
    depth_chart_order = Column(Integer)
    search_rank = Column(Integer)
    sport = Column(String)
    sportradar_id = Column(String)
    espn_id = Column(String)
    yahoo_id = Column(String)
    rotowire_id = Column(String)
    rotoworld_id = Column(String)
    fantasy_data_id = Column(String)
    stats_id = Column(String)
    gsis_id = Column(String)
    hashtag = Column(String)
    news_updated = Column(String)
    team_changed_at = Column(String)

class Roster(Base):
    __tablename__ = "rosters"
    roster_id = Column(Integer, primary_key=True)
    owner_id = Column(String)
    league_id = Column(String)
    wins = Column(Integer)
    losses = Column(Integer)
    fpts = Column(Float)
    players = Column(Text)
    starters = Column(Text)

class LeagueUser(Base):
    __tablename__ = "league_users"
    user_id = Column(String, primary_key=True)
    username = Column(String)
    display_name = Column(String)
    league_id = Column(String)

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
