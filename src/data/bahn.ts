import * as d3 from "d3";

import { COLORS } from "../colors";
import { projection } from "./geo";

export function appendTrainStrecken(g: d3.Selection<SVGGElement, undefined, null, undefined>) {
    return g.append("g")
        .selectAll("line")
        .data(connections)
        .join("line")
        .attr("x1", d => projection(stations[d[0]].coords as [number, number])![0])
        .attr("y1", d => projection(stations[d[0]].coords as [number, number])![1])
        .attr("x2", d => projection(stations[d[1]].coords as [number, number])![0])
        .attr("y2", d => projection(stations[d[1]].coords as [number, number])![1])
        .attr("stroke", COLORS.TRAINS.LINES)
        .attr("stroke-width", 2);
}

export function appendTrainStations(g: d3.Selection<SVGGElement, undefined, null, undefined>) {
    return g.append("g")
        .selectAll("circle")
        .data(stations)
        .join("circle")
        .attr("cx", d => projection(d.coords as [number, number])![0])
        .attr("cy", d => projection(d.coords as [number, number])![1])
        .attr("r", ".5")
        .attr("fill", COLORS.TRAINS.STATIONS);
}

export async function loadStations() {
    const stations = await d3.csv(
        "/data/bahn/csv/stations.csv",
        (d) => ({
            name: d.name,
            eva: +d.eva,
            coords: [
                +d.lon, // longitude first
                +d.lat, // latitude second
            ],
        })
    );
    return stations;
}

// Real German stations (lon, lat)
export const stations = await loadStations();

export const connections = [];
