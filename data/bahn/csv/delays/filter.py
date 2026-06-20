import os
import pandas as pd

dates = [
    "2023-01-28",
    "2023-01-29",
    "2023-01-30",
    "2023-01-31",
]

# WBA = Waldbahn (kleine bahnen. irrelevant)
TRAIN_CATEGORIES = {
    "ICE", "IC", "EC", "RE", "RB", "S", "U", "IRE"
}

full_path = os.path.realpath(__file__)
path, _ = os.path.split(full_path)

ic_stations = set(
    pd.read_csv(f"{path}/../stations-ic.csv")["eva"].astype(int)
)

stations = pd.read_csv(f"{path}/../stations-train.csv")
station_region = stations.set_index("eva")["region_name"]


def build_sections(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["trip_id", "stop_sequence"]).copy()

    df["next_stop_id"] = df.groupby("trip_id")["stop_id"].shift(-1)
    df["next_delay"] = df.groupby("trip_id")["delay"].shift(-1)

    sections = df.dropna(subset=["next_stop_id"]).copy()

    sections["from_stop_id"] = sections["stop_id"].astype(int)
    sections["to_stop_id"] = sections["next_stop_id"].astype(int)
    sections["avg_delay"] = (sections["delay"] + sections["next_delay"]) / 2

    sections = (
        sections
        .groupby(["from_stop_id", "to_stop_id"], as_index=False)
        .agg(
            avg_delay=("avg_delay", "mean"),
            median_delay=("avg_delay", "median"),
            max_delay=("avg_delay", "max"),
        )
    )

    return sections.astype({
        "avg_delay": "int",
        "median_delay": "int",
        "max_delay": "int",
    })


def add_region(df: pd.DataFrame, stop_column: str) -> pd.DataFrame:
    df = df.copy()
    df["region_name"] = df[stop_column].map(station_region)
    return df


def write_by_region(
    df: pd.DataFrame,
    base_dir: str,
    date: str,
):
    for region, df_region in df.groupby("region_name"):
        if pd.isna(region):
            region = "unknown"

        out_dir = f"{base_dir}/{region}"
        os.makedirs(out_dir, exist_ok=True)

        df_region.to_csv(
            f"{out_dir}/{date}.csv",
            index=False,
        )


def process_delays(delays: pd.DataFrame) -> pd.DataFrame:
    delays = delays[delays["category"].isin(TRAIN_CATEGORIES)]

    delays = delays.astype({
        "trip_id": "uint64",
        "initial_stop_id": "Int64",
    })

    return build_sections(delays)


def convert_date(date: str):
    delays = pd.read_parquet(
        f"{path}/../../../../raw/delays/2023/{date}.parquet"
    )

    delays = delays.query("is_final == True")

    os.makedirs(f"{path}/ic", exist_ok=True)
    os.makedirs(f"{path}/non_ic", exist_ok=True)

    ic_delays = delays[
        delays["stop_id"].astype(int).isin(ic_stations)
    ]

    non_ic_delays = delays[
        ~delays["stop_id"].astype(int).isin(ic_stations)
    ]

    # IC sections
    ic_sections = process_delays(ic_delays)

    ic_sections.to_csv(
        f"{path}/ic/{date}.csv",
        index=False,
    )

    # Non-IC sections grouped by region
    non_ic_sections = process_delays(non_ic_delays)
    non_ic_sections = add_region(
        non_ic_sections,
        "from_stop_id",
    )

    write_by_region(
        non_ic_sections,
        f"{path}/non_ic",
        date,
    )


for date in dates:
    convert_date(date)
