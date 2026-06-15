```sh
parquet-tools csv data/bahn/raw/stations.parquet > data/bahn/csv/stations.csv
```

Some lines looked like this:
```csv
8000263,EMSTP,51.956566,7.635715,Münster(Westf)Hbf,True,True,[],"['HIGH_SPEED_TRAIN' 'INTERCITY_TRAIN' 'INTER_REGIONAL_TRAIN'
 'REGIONAL_TRAIN']",245694.0
```
had to find/replace with: `\n ` -> ` ` to fix

then ran `python data/bahn/csv/filter.py`

# Ideas for pre-processing
- Check if station is within Germany (as per GeoJSON)
- Delays nach "category" filtern
- Delay Times per Strecke (per Day)
- Nach Zoom Level & Regierungsbezirk (große Bahnhöfe von weit weg, kleine nur von nah dran)
