import sys
from datetime import date
import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, Projection
from sync_stats import STAT_FIELDS

CURRENT_SEASON = 2026

# Projections cover Sleeper's entire draftable player pool (~9000+), unlike
# actual stats which only exist for players who played that week (a few
# hundred) - one INSERT for all of them at once is >2M bound parameters,
# which silently stalls rather than erroring. Chunking keeps each statement
# reasonably sized and gives visible per-chunk progress.
#
# Projection/Stat rows carry ~270 columns (len(STAT_FIELDS)+4), so a chunk of
# 500 binds ~135,000 parameters in one statement - double Postgres's 65,535
# hard limit, and even when accepted, large enough that Supabase's pooler was
# killing it with "canceling statement due to statement timeout" more often
# than not (seen repeatedly in production - see sync_projections.log). 100
# rows keeps a chunk to ~27,000 parameters, comfortably inside both limits.
CHUNK_SIZE = 100

# Sleeper's raw projections run high on certain fields relative to how they
# actually turn out - scale those down here so stored projections (and the
# fantasy points computed from them) track reality more closely. Add more
# entries as other fields turn out to need the same correction.
FIELD_ADJUSTMENTS = {
    "rush_fd": 0.45,
    "rec_fd": 0.40,
    "pass_fd": 0.40,
}

def adjust(field, value):
    multiplier = FIELD_ADJUSTMENTS.get(field)
    return value * multiplier if multiplier is not None and value is not None else value

# Most of the ~9,400-player draftable pool is deep bench/irrelevant players
# whose projection barely moves week to week, especially for a week that's
# still several weeks out. skip_unchanged (used for the rotation pick - see
# __main__) reads what's already stored first and only writes a row that's
# new, changed teams, or moved by at least this many fantasy points -
# turning a ~9,400-row write into a read plus a handful of actual writes.
NOTICEABLE_CHANGE_THRESHOLD = 0.5
# pts_ppr covers standard-format positions (QB/RB/WR/TE/K/DEF); pts_idp is
# Sleeper's equivalent total for individual defensive players (tackles,
# sacks, etc.), which pts_ppr doesn't include - without it, IDP players'
# changes would be invisible to this check and their rows would never get
# refreshed. pts_half_ppr/pts_std are deliberately not checked separately -
# they're derived from the same underlying stats as pts_ppr, so in practice
# nothing moves one without moving the others too.
CHANGE_DETECTION_FIELDS = ("pts_ppr", "pts_idp")

def upcoming_week():
    """Sleeper's own notion of the current week - same source main.py's
    current_nfl_week() reads. Projections only mean anything once the
    regular season is under way, so preseason/offseason map to week 1."""
    resp = requests.get("https://api.sleeper.app/v1/state/nfl", timeout=10)
    resp.raise_for_status()
    state = resp.json()
    return state.get("week") or 1 if state.get("season_type") == "regular" else 1

def sync_projections(season=CURRENT_SEASON, season_type="regular", weeks=None, skip_unchanged=False):
    db = SessionLocal()
    total = 0
    total_skipped = 0

    try:
        for week in (weeks if weeks is not None else [upcoming_week()]):
            # A transient connection drop on one week (e.g. a Supabase blip
            # mid-chunk) shouldn't abort the whole multi-minute run - retry
            # that week a couple times, then move on rather than losing every
            # week after it.
            for attempt in range(3):
                try:
                    url = f"https://api.sleeper.app/v1/projections/nfl/{season_type}/{season}/{week}"
                    resp = requests.get(url, timeout=20)
                    if resp.status_code != 200:
                        break

                    data = resp.json()
                    if not data:
                        break

                    rows = [
                        {
                            "player_id": player_id,
                            "season": season,
                            "week": week,
                            "season_type": season_type,
                            **{field: adjust(field, p.get(field)) for field in STAT_FIELDS},
                        }
                        for player_id, p in data.items()
                    ]

                    skipped = 0
                    if skip_unchanged:
                        existing = {
                            row.player_id: row
                            for row in db.query(
                                Projection.player_id, Projection.team,
                                *[getattr(Projection, f) for f in CHANGE_DETECTION_FIELDS],
                            ).filter(
                                Projection.season == season, Projection.week == week, Projection.season_type == season_type,
                            ).all()
                        }

                        def changed(row):
                            old = existing.get(row["player_id"])
                            if old is None or old.team != row["team"]:
                                return True
                            return any(
                                abs((row.get(f) or 0) - (getattr(old, f) or 0)) >= NOTICEABLE_CHANGE_THRESHOLD
                                for f in CHANGE_DETECTION_FIELDS
                            )

                        kept = [r for r in rows if changed(r)]
                        skipped = len(rows) - len(kept)
                        rows = kept

                    for i in range(0, len(rows), CHUNK_SIZE):
                        chunk = rows[i:i + CHUNK_SIZE]
                        stmt = insert(Projection).values(chunk)
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["player_id", "season", "week", "season_type"],
                            set_={field: stmt.excluded[field] for field in STAT_FIELDS},
                        )
                        db.execute(stmt)
                        db.commit()

                    total += len(rows)
                    total_skipped += skipped
                    suffix = f", {skipped} unchanged skipped" if skip_unchanged else ""
                    print(f"{season} week {week}: {len(rows)} players written{suffix}")
                    break
                except Exception as e:
                    db.rollback()
                    # str(e) on a SQLAlchemy statement error includes the full
                    # compiled SQL and every bound parameter - for a ~27,000-
                    # parameter chunk that's a multi-hundred-KB line. The
                    # actual error is always the first line; the rest is noise
                    # that once blew a log file up to 145MB in six weeks.
                    reason = str(e).splitlines()[0] if str(e) else repr(e)
                    print(f"{season} week {week}: attempt {attempt + 1} failed ({type(e).__name__}: {reason})")

        skip_suffix = f" ({total_skipped} unchanged skipped)" if skip_unchanged else ""
        print(f"Synced {total} projection rows{skip_suffix}")
    except Exception as e:
        db.rollback()
        reason = str(e).splitlines()[0] if str(e) else repr(e)
        print(f"Error: {type(e).__name__}: {reason}")
    finally:
        db.close()

if __name__ == "__main__":
    # --all-weeks is for a manual one-off rebuild only (e.g. after changing
    # FIELD_ADJUSTMENTS) - no longer scheduled on cron. A weekly all-remaining
    # -weeks rebuild (even excluding already-played weeks) still concentrated
    # a multi-minute, ~100k-row write into a single day, and that one day's
    # disk I/O was still enough to trip a Supabase budget warning on
    # 2026-10-19 even after excluding played weeks. Spreading the same total
    # work across every day instead, with enough extra weeks picked each
    # day to guarantee a full cycle through all remaining weeks within 7
    # days (see below) - keeps each day's write small instead of bursty,
    # which is what actually matters for a burst-credit-style IO budget
    # (concentration, not total volume per se).
    if "--all-weeks" in sys.argv:
        sync_projections(weeks=range(upcoming_week(), 19))
    elif "--current-week" in sys.argv:
        # For scheduling close to each kickoff window (Thu/Sun/Mon) so a
        # late inactive/game-day designation has a chance to be reflected
        # before that window's games start - cheaper than the daily default
        # on purpose, since this runs several times a day across the week.
        sync_projections(weeks=[upcoming_week()], skip_unchanged=True)
    else:
        # skip_unchanged applies here too, not just the rotation pick below -
        # of the ~9,400 players Sleeper returns, only ~1,700 active-roster +
        # ~450 practice-squad players (~2,150) ever have a real non-zero
        # projection; the rest are free agents/inactive players projecting
        # ~0 every week regardless. It doesn't risk missing a real change -
        # anything that moved by >=NOTICEABLE_CHANGE_THRESHOLD, changed
        # teams, or is new still writes immediately - it only skips rows
        # that are genuinely identical to what's already stored.
        wk = upcoming_week()
        sync_projections(weeks=[wk], skip_unchanged=True)

        # One extra week per day only guaranteed full coverage within a
        # week once <=7 weeks remained - early/mid season (e.g. 12 future
        # weeks) it took 12 days to cycle through. Scale how many extra
        # weeks get picked today so a full cycle always finishes within 7
        # days regardless of how many remain, while still spreading them
        # evenly rather than bursting.
        future_weeks = [w for w in range(wk, 19) if w != wk]
        if future_weeks:
            extra_count = -(-len(future_weeks) // 7)  # ceil division
            start = (date.today().toordinal() * extra_count) % len(future_weeks)
            weeks_today = sorted({future_weeks[(start + i) % len(future_weeks)] for i in range(extra_count)})
            sync_projections(weeks=weeks_today, skip_unchanged=True)
