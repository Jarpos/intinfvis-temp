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
        "region_name",
        "state_name",
    ]]

def split_by_geojson(
    df: pd.DataFrame,
    geojson_path: str,
    lat_column: str = "lat",
    lon_column: str = "lon",
):
    with open(geojson_path) as f:
        geojson = json.load(f)

    geometries = []
    names = []

    for feature in geojson["features"]:
        geometries.append(prep(shape(feature["geometry"])))
        props = feature.get("properties", {})
        names.append((props.get("NAME_1"), props.get("NAME_2")))

    def match_region(row):
        point = Point(row[lon_column], row[lat_column])

        for geom, (name1, name2) in zip(geometries, names):
            if geom.contains(point):
                return name1, name2
        return None, None

    df = df.copy()
    df[["state_name", "region_name"]] = pd.DataFrame(
        df.apply(match_region, axis=1).tolist(), index=df.index
    )

    mask = df["region_name"].notna()

    return df[mask], df[~mask]


all = pd.read_parquet(f"{path}/../../../raw/stations.parquet")
all = all.query("is_active_ris == True and is_active_iris == True")

german_stations, outside_german_stations = split_by_geojson(
    all, f"{path}/../../geo/1_sehr_hoch.geo.json",
)

stations_regional = german_stations[
    german_stations["available_transports"]
        .astype(str)
        .str.contains("REGIONAL_TRAIN", case=False, na=False)
]

stations_intercity = german_stations[
    german_stations["available_transports"]
        .astype(str)
        .str.contains("INTERCITY_TRAIN", case=False, na=False)
]

excluded_stations = pd.concat([
    outside_german_stations[["eva"]],
    german_stations.loc[
        ~german_stations.index.isin(stations_regional.index)
        & ~german_stations.index.isin(stations_intercity.index),
        ["eva"],
    ],
]).drop_duplicates()

stations_ic = drop_columns(
    german_stations[
        german_stations["available_transports"]
            .astype(str)
            .str.contains(
                "INTERCITY_TRAIN",
                case=False,
                na=False,
                regex=True,
            )
    ]
)

stations_train = drop_columns(
    german_stations[
        german_stations["available_transports"]
            .astype(str)
            .str.contains(
                "REGIONAL_TRAIN|INTERCITY_TRAIN",
                case=False,
                na=False,
                regex=True,
            )
    ]
)

stations_ic.to_csv(f"{path}/stations-ic.csv", index=False)
stations_train.to_csv(f"{path}/stations-train.csv", index=False)
# excluded_stations.to_csv(f"{path}/stations-excluded.csv", index=False)
all.to_csv(f"{path}/all_stations.csv", index=False)
# all.head(100).to_csv(f"{path}/stations.csv", index=False)
