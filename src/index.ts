import * as d3 from "d3";

import { COLORS } from "./colors";
import { connections, stations } from "./db";

// Declare the chart dimensions and margins.
const width = window.innerWidth;
const height = window.innerHeight * .99;

// https://github.com/isellsoap/deutschlandGeoJSON
//
// "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/refs/heads/main/3_regierungsbezirke/1_sehr_hoch.geo.json"
// "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/refs/heads/main/4_kreise/1_sehr_hoch.geo.json"
const geojson = await d3.json(
    "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/refs/heads/main/3_regierungsbezirke/1_sehr_hoch.geo.json"
) as GeoJSON.FeatureCollection;

const svg = d3.create("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .style("max-width", "100%")
    .style("height", "auto");

const tooltip = d3.create("div")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("background", COLORS.TOOLTIP.BACKGROUND)
    .style("padding", "4px 8px")
    .style("border", `1px solid ${COLORS.TOOLTIP.BORDER}`)
    .style("display", "none");

const projection = d3.geoMercator()
    .fitSize([width, height], geojson);

const path = d3.geoPath(projection);
const g = svg.append("g");

// Germany Map
g.selectAll("path")
    .data(geojson.features)
    .join("path")
    .attr("d", path)
    .attr("fill", COLORS.MAP.NORMAL)
    .attr("stroke", COLORS.MAP.BORDERS)
    .attr("stroke-width", 0.5)
    .on("mouseenter", function (_, d: any) {
        d3.select(this).attr("fill", COLORS.MAP.HIGHTLIGHT);
        tooltip.style("display", "block")
            .text(d.properties?.name ?? `${d.properties?.NAME_1}, ${d.properties?.NAME_2}`);
    })
    .on("mousemove", (event) => {
        tooltip.style("left", `${event.pageX + 10}px`)
               .style("top", `${event.pageY + 10}px`);
    })
    .on("mouseleave", function () {
        d3.select(this).attr("fill", COLORS.MAP.NORMAL);
        tooltip.style("display", "none");
    });

// Train Station Connections
g.append("g")
    .selectAll("line")
    .data(connections)
    .join("line")
    .attr("x1", d => projection(stations[d[0]].coords as [number, number])![0])
    .attr("y1", d => projection(stations[d[0]].coords as [number, number])![1])
    .attr("x2", d => projection(stations[d[1]].coords as [number, number])![0])
    .attr("y2", d => projection(stations[d[1]].coords as [number, number])![1])
    .attr("stroke", COLORS.TRAINS.LINES)
    .attr("stroke-width", 2);

// Train Stations
g.append("g")
    .selectAll("circle")
    .data(stations)
    .join("circle")
    .attr("cx", d => projection(d.coords as [number, number])![0])
    .attr("cy", d => projection(d.coords as [number, number])![1])
    .attr("r", 4)
    .attr("fill", COLORS.TRAINS.STATIONS)
    .on("mouseenter", function (_, d) {
        d3.select(this).attr("fill", COLORS.MAP.HIGHTLIGHT);
        tooltip.style("display", "block")
            .text(d.name);
    })
    .on("mousemove", (event) => {
        tooltip.style("left", `${event.pageX + 10}px`)
               .style("top", `${event.pageY + 10}px`);
    })
    .on("mouseleave", function () {
        d3.select(this).attr("fill", COLORS.TRAINS.STATIONS);
        tooltip.style("display", "none");
    });

const zoom = d3
    .zoom<SVGSVGElement, undefined>()
    .scaleExtent([1, 20])
    .on("zoom", (event) => g.attr("transform", event.transform));

svg.call(zoom);
document.body.append(svg.node()!);
document.body.append(tooltip.node()!);
