import pandas as pd
import os

date = "2021-09-08"

full_path = os.path.realpath(__file__)
path, _ = os.path.split(full_path)

df = pd.read_parquet(f"{path}/../../raw/delays/2021/{date}.parquet")
df = df.query("is_final == True")

excluded_stations = pd.read_csv(
    f"{path}/../stations-excluded.csv"
)["eva"].astype(str)
df = df[~df["stop_id"].astype(str).isin(excluded_stations)]

df = df.astype({
    "trip_id": "uint64",
    "initial_stop_id": "Int64",
})
df = df[[
    "trip_id",
    "stop_id",
    # "initial_stop_id",
    "stop_sequence",
    "delay",
]]
df = df.drop_duplicates()
# print(df.head(10))
# df.head(100).to_csv(f"{path}/{date}.csv", index=False)
df.head(50000).to_csv(f"{path}/{date}.csv", index=False)
