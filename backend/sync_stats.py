import requests
from sqlalchemy.dialects.postgresql import insert
from database import SessionLocal, Stat

CURRENT_SEASON = 2025

# Full-history bounds, for one-off backfills only (e.g. sync_stats(start_season=FULL_HISTORY_START_SEASON, end_season=FULL_HISTORY_END_SEASON)).
# Routine syncs should stick to the current season - rewriting all 9 seasons every
# run is what drained this project's disk I/O budget last time.
FULL_HISTORY_START_SEASON = 2017
FULL_HISTORY_END_SEASON = 2025

STAT_FIELDS = [
    "team", "opponent",
    "pts_ppr", "pts_half_ppr", "pts_std",
    "pass_att", "pass_cmp", "pass_yd", "pass_td", "pass_int",
    "rush_att", "rush_yd", "rush_td",
    "rec", "rec_yd", "rec_td", "rec_tgt",
    "fum_lost",
    # Everything else Sleeper's stats payload carries (kicking, defense/IDP,
    # bonus thresholds, snap counts, etc.), so any league's scoring_settings
    # key can be matched to a column of the same name.
    "anytime_tds", "blk_kick", "blk_kick_ret_td", "blk_kick_ret_yd", "blk_pr_td", "bonus_def_fum_td_50p",
    "bonus_def_int_td_50p", "bonus_fd_qb", "bonus_fd_rb", "bonus_fd_te", "bonus_fd_wr", "bonus_pass_cmp_25",
    "bonus_pass_yd_300", "bonus_pass_yd_400", "bonus_rec_rb", "bonus_rec_te", "bonus_rec_wr", "bonus_rec_yd_100",
    "bonus_rec_yd_200", "bonus_rush_att_20", "bonus_rush_rec_yd_100", "bonus_rush_rec_yd_200", "bonus_rush_yd_100", "bonus_rush_yd_200",
    "bonus_sack_2p", "bonus_tkl_10p", "cmp_pct", "def_2pt", "def_3_and_out", "def_4_and_stop",
    "def_forced_punts", "def_kr", "def_kr_lng", "def_kr_td", "def_kr_yd", "def_kr_ypa",
    "def_pass_def", "def_pr", "def_pr_lng", "def_pr_td", "def_pr_yd", "def_pr_ypa",
    "def_snp", "def_st_ff", "def_st_fum_rec", "def_st_td", "def_st_tkl_solo", "def_td",
    "down_3_att", "down_3_conv", "down_3_pct", "down_4_att", "down_4_conv", "down_4_pct",
    "fan_pts_allow", "fan_pts_allow_def", "fan_pts_allow_k", "fan_pts_allow_qb", "fan_pts_allow_rb", "fan_pts_allow_te",
    "fan_pts_allow_wr", "fd", "ff", "ff_misc", "fg_blkd", "fg_ret_td",
    "fg_ret_yd", "fga", "fgm", "fgm_0_19", "fgm_20_29", "fgm_30_39",
    "fgm_40_49", "fgm_50_59", "fgm_50p", "fgm_60p", "fgm_lng", "fgm_pct",
    "fgm_yds", "fgm_yds_over_30", "fgmiss", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49",
    "fgmiss_50_59", "fgmiss_50p", "fgmiss_60p", "first_td", "fum", "fum_rec",
    "fum_rec_ez_tds", "fum_rec_td", "fum_ret_yd", "g2g_att", "g2g_conv", "g2g_pct",
    "gms_active", "gp", "gs", "idp_blk_kick", "idp_def_td", "idp_ff",
    "idp_fum_rec", "idp_fum_ret_yd", "idp_int", "idp_int_ret_yd", "idp_pass_def", "idp_pass_def_3p",
    "idp_qb_hit", "idp_sack", "idp_sack_yd", "idp_safe", "idp_tkl", "idp_tkl_ast",
    "idp_tkl_loss", "idp_tkl_solo", "int", "int_ret_yd", "kick_pts", "kr",
    "kr_lng", "kr_td", "kr_yd", "kr_ypa", "misc_ret_yd", "misc_td",
    "off_snp", "off_yd", "off_yd_per_play", "opp_fd", "opp_off_yd", "opp_off_yd_per_play",
    "opp_pass_fd", "opp_rush_fd", "pa", "pass_2pt", "pass_air_yd", "pass_cmp_40p",
    "pass_fd", "pass_inc", "pass_int_td", "pass_lng", "pass_rtg", "pass_rush_yd",
    "pass_rz_att", "pass_sack", "pass_sack_yds", "pass_td_40p", "pass_td_50p", "pass_td_lng",
    "pass_ypa", "pass_ypc", "penalty", "penalty_yd", "pos_rank_half_ppr", "pos_rank_ppr",
    "pos_rank_std", "pr", "pr_lng", "pr_td", "pr_yd", "pr_ypa",
    "pts_allow", "pts_allow_0", "pts_allow_1_6", "pts_allow_14_20", "pts_allow_21_27", "pts_allow_28_34",
    "pts_allow_35p", "pts_allow_7_13", "pts_idp", "punt_blkd", "punt_in_20", "punt_net_yd",
    "punt_tb", "punt_yds", "punts", "qb_hit", "rec_0_4", "rec_10_19",
    "rec_20_29", "rec_2pt", "rec_30_39", "rec_40p", "rec_5_9", "rec_air_yd",
    "rec_drop", "rec_fd", "rec_lng", "rec_rz_tgt", "rec_td_40p", "rec_td_50p",
    "rec_td_lng", "rec_yar", "rec_ypr", "rec_ypt", "rush_2pt", "rush_40p",
    "rush_btkl", "rush_fd", "rush_lng", "rush_rec_yd", "rush_rz_att", "rush_td_40p",
    "rush_td_50p", "rush_td_lng", "rush_tkl_loss", "rush_tkl_loss_yd", "rush_yac", "rush_ypa",
    "rz_att", "rz_conv", "rz_pct", "sack", "sack_yd", "sacks",
    "safe", "snp", "sp_fumble_recoveries", "st_ff", "st_fum_rec", "st_snp",
    "st_td", "st_tkl_solo", "td", "tkl", "tkl_ast", "tkl_ast_misc",
    "tkl_loss", "tkl_solo", "tkl_solo_misc", "tm_def_snp", "tm_off_snp", "tm_snp",
    "tm_st_snp", "xp_blkd", "xpa", "xpm", "xpmiss", "yds_allow",
    "yds_allow_0_100", "yds_allow_100_199", "yds_allow_200_299", "yds_allow_300_349", "yds_allow_350_399", "yds_allow_400_449",
    "yds_allow_450_499", "yds_allow_500_549", "yds_allow_550p",
]

def weeks_in_season(season):
    return range(1, 19) if season >= 2021 else range(1, 18)

def sync_stats(start_season=CURRENT_SEASON, end_season=CURRENT_SEASON, season_type="regular"):
    db = SessionLocal()
    total = 0

    try:
        for season in range(start_season, end_season + 1):
            for week in weeks_in_season(season):
                url = f"https://api.sleeper.app/v1/stats/nfl/{season_type}/{season}/{week}"
                resp = requests.get(url, timeout=20)
                if resp.status_code != 200:
                    continue

                data = resp.json()
                if not data:
                    continue

                rows = [
                    {
                        "player_id": player_id,
                        "season": season,
                        "week": week,
                        "season_type": season_type,
                        **{field: s.get(field) for field in STAT_FIELDS},
                    }
                    for player_id, s in data.items()
                ]

                stmt = insert(Stat).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["player_id", "season", "week", "season_type"],
                    set_={field: stmt.excluded[field] for field in STAT_FIELDS},
                )
                db.execute(stmt)
                db.commit()

                total += len(rows)
                print(f"{season} week {week}: {len(rows)} players")

        print(f"Synced {total} stat rows")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    sync_stats()
