import * as d3 from "d3";

import { COLORS } from "../colors";
import { projection } from "./geo";

export type Station = {
  name: string;
  coords: number[];
  eva: number;
};

//now filters connections using a fast Set.has check (O(1) per connection), reducing rendering calculations
export function appendTrainStrecken(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
  selectedStationNames = new Set(stations.map((station) => station.name)),
) {
  const filteredConnections = connections.filter(
    (c) =>
      selectedStationNames.has(c.sourceName) &&
      selectedStationNames.has(c.targetName),
  );

  return (
    g
      .selectAll("line")
      .data(
        filteredConnections,
        (d: any) => `${d.source.eva}-${d.target.eva}`,
      )
      .join("line")
      .attr("x1", (d) => projection(d.source.coords as [number, number])![0])
      .attr("y1", (d) => projection(d.source.coords as [number, number])![1])
      .attr("x2", (d) => projection(d.target.coords as [number, number])![0])
      .attr("y2", (d) => projection(d.target.coords as [number, number])![1])
      // .attr("stroke", COLORS.TRAINS.LINES)
      .attr("stroke", (d) =>
        d.delay >= 300
          ? "#d73027"
          : d.delay >= 120
            ? "#fc8d59"
            : d.delay >= 60
              ? "#fee08b"
              : "#1a9850",
      )
      .attr("stroke-width", 0.5)
  );
}

export function appendTrainStations(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
  visibleStations: Station[] = stations,
) {
  return g
    .selectAll("circle")
    .data(visibleStations, (d) => (d as Station).name)
    .join("circle")
    .attr("cx", (d) => projection(d.coords as [number, number])![0])
    .attr("cy", (d) => projection(d.coords as [number, number])![1])
    .attr("r", ".5")
    .attr("fill", COLORS.TRAINS.STATIONS);
}

export async function loadStations() {
  const stations = await d3.csv("/data/bahn/csv/stations.csv", (d) => ({
    name: d.name,
    eva: +d.eva,
    coords: [
      +d.lon, // longitude first
      +d.lat, // latitude second
    ],
  }));
  return stations;
}

// Real German stations (lon, lat)
export const stations = await loadStations();

export const trips = await d3
  .csv("/data/bahn/csv/delays/2021-09-08.csv", (d) => ({
    trip_id: d.trip_id,
    stop_id: d.stop_id,
    stop_sequence: +d.stop_sequence,
    delay: +d.delay,
  }))
  .then((data) => {
    const trips = d3.group(data, (d) => d.trip_id);
    const tripList = Array.from(trips, ([trip_id, stops]) => ({
      trip_id,
      stops: stops
        .sort((a, b) => a.stop_sequence - b.stop_sequence)
        .map((d) => ({
          stop_id: +d.stop_id,
          stop_sequence: d.stop_sequence,
          delay: d.delay,
        })),
    }));
    return tripList;
  });

const stationByEva = new Map(stations.map((s) => [String(s.eva), s]));

export type Connection = {
  source: Station;
  target: Station;
  sourceName: string;
  targetName: string;
  delay: number;
};

//Instead of calculating connection paths and scanning the entire stations array (O(M * N)) on every single selection check, we precompute connections and their corresponding station names on module load.
export const connections: Connection[] = trips.flatMap((trip) =>
  trip.stops
    .slice(0, -1)
    .map((stop, i) => {
      const source = stationByEva.get(String(stop.stop_id));
      const target = stationByEva.get(String(trip.stops[i + 1].stop_id));
      if (!source || !target) return null;
      return {
        source,
        target,
        sourceName: source.name,
        targetName: target.name,
        delay: trip.stops[i + 1].delay,
      };
    })
    .filter((d): d is Connection => d !== null),
);
