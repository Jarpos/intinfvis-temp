import pandas as pd
import os
import json
from shapely.geometry import shape, Point
from shapely.prepared import prep

full_path = os.path.realpath(__file__)
path, _ = os.path.split(full_path)

def drop_columns(df: pd.DataFrame):
    return df[[
        "eva",
        "name",
        "lat",
        "lon",
    ]]

def split_by_geojson(
    df: pd.DataFrame,
    geojson_path: str,
    lat_column: str = "lat",
    lon_column: str = "lon",
):
    with open(geojson_path) as f:
        geojson = json.load(f)

    geometries = [
        prep(shape(feature["geometry"]))
        for feature in geojson["features"]
    ]

    mask = df.apply(
        lambda row: any(
            geometry.contains(Point(row[lon_column], row[lat_column]))
            for geometry in geometries
        ),
        axis=1,
    )

    return df[mask], df[~mask]


all = pd.read_parquet(f"{path}/../raw/stations.parquet")
all = all.query("is_active_ris == True and is_active_iris == True")

german_stations, outside_german_stations = split_by_geojson(
    all, f"{path}/../../geo/1_sehr_hoch.geo.json",
)

exclude_trains_not_regional = all[
    ~all["available_transports"]
        .str.contains(r"\b.*REGIONAL_TRAIN.*\b", case=False, na=False, regex=True)
]

exclude_trains_intercity = all[
    ~all["available_transports"]
        .str.contains(r"\b.*INTERCITY_TRAIN.*\b", case=False, na=False, regex=True)
]

stations = drop_columns(german_stations)
excluded_stations = outside_german_stations[["eva"]]

stations.to_csv(f"{path}/stations-filtered.csv", index=False)
excluded_stations.to_csv(f"{path}/stations-excluded.csv", index=False)
# all.head(100).to_csv(f"{path}/stations.csv", index=False)
