import pandas as pd
import os

full_path = os.path.realpath(__file__)
path, _ = os.path.split(full_path)

df = pd.read_csv(f"{path}/stations.csv")
# print(df.count())
df = df.query("is_active_ris == True or is_active_iris == True")
# print(dff.count())
# print(df["available_transports"])

train_rows = df[
    df["available_transports"]
        # .str.contains(r"\b.*TRAIN.*\b", case=False, na=False, regex=True)
        .str.contains(r"\b.*REGIONAL_TRAIN.*\b", case=False, na=False, regex=True)
]
other_rows = df[
    ~df["available_transports"]
        .str.contains(r"\b.*REGIONAL_TRAIN.*\b", case=False, na=False, regex=True)
]
other_rows = other_rows[[
    "eva"
]]
# print(train_rows.count())
# print(other_rows.count())
train_rows.to_csv(f"{path}/stations-filtered.csv", index=False)
other_rows.to_csv(f"{path}/stations-excluded.csv", index=False)
