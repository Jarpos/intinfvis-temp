import * as d3 from "d3";

import { COLORS } from "./colors";
import { appendTrainStrecken, appendTrainStations, connections, stations } from "./data/bahn";
import { appendGermany, geojson, projection } from "./data/geo";
import { HEIGHT, WIDTH, map_svg, tooltip } from "./config";
import { appendWeatherOverlay } from "./weatherOverlay";

const g = map_svg.append("g");

// Germany Map
appendGermany(g)
    .on("mouseenter", function (_, d) {
        d3.select(this).attr("fill", COLORS.MAP.HIGHLIGHT);
        tooltip.style("display", "block")
            .text(d.properties?.name ?? `${d.properties?.NAME_2}, ${d.properties?.NAME_1}`);
    })
    .on("mousemove", (event) => {
        tooltip.style("left", `${event.pageX + 10}px`)
               .style("top", `${event.pageY + 10}px`);
    })
    .on("mouseleave", function () {
        d3.select(this).attr("fill", COLORS.MAP.NORMAL);
        tooltip.style("display", "none");
    });

// Hourly historic temperature map
appendWeatherOverlay(g);

// Train Station Connections
appendTrainStrecken(g);

// Train Stations
appendTrainStations(g)
    .on("mouseenter", function (_, d) {
        d3.select(this).attr("fill", COLORS.MAP.HIGHLIGHT);
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
    .scaleExtent([.75, 20])
    .on("zoom", (event) => g.attr("transform", event.transform));
map_svg.call(zoom);

document.body.append(map_svg.node()!);
document.body.append(tooltip.node()!);
