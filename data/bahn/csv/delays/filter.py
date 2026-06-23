import os
import pandas as pd

full_path = os.path.realpath(__file__)
path, _ = os.path.split(full_path)

def flatten(xss):
    return [x for xs in xss for x in xs]

years = ["2023"]
dates = list(
    map(
        lambda f: f.split('.')[0],
        flatten([os.listdir(f"{path}/../../../../raw/delays/{year}/") for year in years])
    )
)

# WBA = Waldbahn (kleine bahnen. irrelevant)
TRAIN_CATEGORIES = {
    "ICE", "IC", "EC", "RE", "RB", "S", "U", "IRE"
}

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
    sections["section_delay"] = (sections["delay"] + sections["next_delay"]) / 2
    sections["is_delayed"] = sections["section_delay"] > 0

    sections = (
        sections
        .groupby(["from_stop_id", "to_stop_id"], as_index=False)
        .agg(
            delay_count=("is_delayed", "sum"),
            entries_count=("is_delayed", "size"),
            avg_delay=("section_delay", "mean"),
            median_delay=("section_delay", "median"),
            max_delay=("section_delay", "max"),
        )
    )

    sections[["avg_delay", "median_delay", "max_delay"]] = (
        sections[["avg_delay", "median_delay", "max_delay"]]
        .round()
        .astype(int)
    )

    return sections


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


def build_region_summary(
    sections: pd.DataFrame,
    date: str,
) -> pd.DataFrame:
    return (
        sections
            .groupby("region_name", as_index=False)
            .apply(
                lambda g: pd.Series({
                    "section_count": len(g),
                    "delay_count": g["delay_count"].sum(),
                    "avg_delay": (
                        (g["avg_delay"] * g["entries_count"]).sum()
                        / g["entries_count"].sum()
                    ),
                    "median_delay": g["median_delay"].median(),
                    "max_delay": g["max_delay"].max(),
                    "total_entries": g["entries_count"].sum(),
                })
            )
            .assign(date=date)
            .reset_index(drop=True)
    )


def convert_date(year: str, date: str):
    os.makedirs(f"{path}/ic", exist_ok=True)
    os.makedirs(f"{path}/non_ic", exist_ok=True)
    os.makedirs(f"{path}/summaries", exist_ok=True)

    delays = pd.read_parquet(
        f"{path}/../../../../raw/delays/{year}/{date}.parquet"
    )
    delays = delays.query("is_final == True")

    ic_delays = delays[
        delays["stop_id"].astype(int).isin(ic_stations)
    ]

    non_ic_delays = delays[
        ~delays["stop_id"].astype(int).isin(ic_stations)
    ]

    ic_sections = process_delays(ic_delays)
    ic_sections.to_csv(
        f"{path}/ic/{date}.csv",
        index=False,
    )

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

    region_summary = build_region_summary(
        non_ic_sections,
        date,
    )

    region_summary.to_csv(
        f"{path}/summaries/summary-{date}.csv",
        index=False,
    )


for date in dates:
    print(f"Processing year {date[:4]} date {date}")
    convert_date(date[:4], date)

pd.Series(dates).to_json(f"{path}/dates.json", orient="values", indent=2)
