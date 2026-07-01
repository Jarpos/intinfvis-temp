import * as d3 from "d3";

import { COLORS } from "../colors";
import { projection } from "./geo";

export type Station = {
  name: string;
  coords: number[];
  eva: number;
  region?: string;
  state?: string;
};

//now filters connections using a fast Set.has check (O(1) per connection), reducing rendering calculations
export function appendTrainStrecken(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
  selectedStationNames = new Set(icStations.map((station) => station.name)),
) {
  const filteredConnections = connections.filter(
    (c) =>
      selectedStationNames.has(c.source.name) &&
      selectedStationNames.has(c.target.name),
  );

  return (
    g
      .selectAll("line")
      .data(filteredConnections, (d: any) => `${d.source.eva}-${d.target.eva}`)
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
      .attr("stroke-width", 0.9)
      .attr("stroke-opacity", 0.9)
      .attr("vector-effect", "non-scaling-stroke")
  );
}

export function appendTrainStations(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
  visibleStations: Station[] = icStations,
  radius = 0.5,
  fill = COLORS.TRAINS.STATIONS,
) {
  return g
    .selectAll("circle")
    .data(visibleStations, (d) => (d as Station).name)
    .join("circle")
    .attr("cx", (d) => projection(d.coords as [number, number])![0])
    .attr("cy", (d) => projection(d.coords as [number, number])![1])
    .attr("r", radius)
    .attr("fill", fill);
}

export async function loadIcStations() {
  // TODO: Pull out link root into global scope
  return d3.csv("/data/bahn/csv/stations-ic.csv", (d) => ({
    name: d.name,
    eva: +d.eva,
    region: d.region_name,
    state: d.state_name,
    coords: [
      +d.lon, // longitude first
      +d.lat, // latitude second
    ],
  }));
}

export async function loadLocalStations() {
  // TODO: Pull out link root into global scope
  return d3.csv("/data/bahn/csv/stations-train.csv", (d) => ({
    name: d.name,
    eva: +d.eva,
    region: d.region_name,
    state: d.state_name,
    coords: [
      +d.lon, // longitude first
      +d.lat, // latitude second
    ],
  }));
}

// Real German stations (lon, lat)
export const icStations = await loadIcStations();
export const localStations = await loadLocalStations();

export const trips = await d3
  // TODO: Pull out link root into global scope
  .csv("/data/bahn/csv/delays/ic/2023-01-30.csv", (d) => ({
    from_stop_id: +d.from_stop_id,
    to_stop_id: +d.to_stop_id,
    avg_delay: +d.avg_delay,
  }));

export type Connection = {
  source: Station;
  target: Station;
  delay: number;
};

const stationByEva = new Map(icStations.map((s) => [s.eva, s]));
const connections: Connection[] = trips
  .map((t) => ({
    source: stationByEva.get(t.from_stop_id) as Station,
    target: stationByEva.get(t.to_stop_id) as Station,
    delay: t.avg_delay,
  }))
  .filter((c) => !!c.target && !!c.source);
