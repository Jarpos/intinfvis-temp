import pandas as pd
import os

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

stations = set(pd.read_csv(
    f"{path}/../stations-filtered.csv"
)["eva"].astype(int))

def convert_date(date: str):
    delays = pd.read_parquet(f"{path}/../../../../raw/delays/2023/{date}.parquet")
    delays = delays.query("is_final == True")
    # df.head(500).to_csv(f"{path}/{date}.csv")

    delays = delays[delays["category"].isin(TRAIN_CATEGORIES)]
    delays = delays[delays["stop_id"].astype(int).isin(stations)]

    delays = delays.astype({
        "trip_id": "uint64",
        "initial_stop_id": "Int64",
    })

    delays = delays.sort_values(["trip_id", "stop_sequence"])
    delays["next_stop_id"] = delays.groupby("trip_id")["stop_id"].shift(-1)
    delays["next_delay"] = delays.groupby("trip_id")["delay"].shift(-1)

    sections = delays.dropna(subset=["next_stop_id"]).copy()
    sections["from_stop_id"] = sections["stop_id"].astype(int)
    sections["to_stop_id"] = sections["next_stop_id"].astype(int)
    sections["avg_delay"] = (sections["delay"] + sections["next_delay"]) / 2

    # aggregate across trips: same section can appear many times
    sections = (
        sections
            .groupby(["from_stop_id", "to_stop_id"], as_index=False)
            .agg(
                avg_delay=("avg_delay", "mean"),
                median_delay=("avg_delay", "median"),
                max_delay=("avg_delay", "max"),
            )
    )

    sections = sections.astype({
        "avg_delay": "int",
        "median_delay": "int",
        "max_delay": "int",
    })

    delays = delays[[
        "trip_id",
        "stop_id",
        # "initial_stop_id",
        "stop_sequence",
        "delay",
        "category",
        "operator",
    ]]

    # df = df.drop_duplicates()
    # print(df.head(10))
    # df.head(100).to_csv(f"{path}/{date}.csv", index=False)
    # delays.to_csv(f"{path}/{date}.csv", index=False)
    sections.to_csv(f"{path}/{date}.csv", index=False)

for date in dates:
    convert_date(date)
