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
)["eva"].astype(str))

def convert_date(date: str):
    delays = pd.read_parquet(f"{path}/../../../../raw/delays/2023/{date}.parquet")
    delays = delays.query("is_final == True")
    # df.head(500).to_csv(f"{path}/{date}.csv")

    delays = delays[delays["category"].isin(TRAIN_CATEGORIES)]
    delays = delays[delays["stop_id"].astype(str).isin(stations)]

    delays = delays.astype({
        "trip_id": "uint64",
        "initial_stop_id": "Int64",
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
    delays.to_csv(f"{path}/{date}.csv", index=False)

for date in dates:
    convert_date(date)
