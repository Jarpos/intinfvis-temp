import * as d3 from "d3";

import { COLORS } from "../colors";
import * as config from "../config";

// https://github.com/isellsoap/deutschlandGeoJSON
//
// "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/refs/heads/main/3_regierungsbezirke/1_sehr_hoch.geo.json"
// "https://raw.githubusercontent.com/isellsoap/deutschlandGeoJSON/refs/heads/main/4_kreise/1_sehr_hoch.geo.json"
//
// https://github.com/leakyMirror/map-of-europe/tree/master
export const geojson = await d3.json("/data/geo/1_sehr_hoch.geo.json") as GeoJSON.FeatureCollection;

export const projection = d3.geoMercator()
    .fitSize([config.WIDTH, config.HEIGHT], geojson);

export function appendGermany(g: d3.Selection<SVGGElement, undefined, null, undefined>) {
    const path = d3.geoPath(projection);
    return g.append("g")
        .selectAll("path")
        .data(geojson.features)
        .join("path")
        .attr("d", path)
        .attr("fill", COLORS.MAP.NORMAL)
        .attr("stroke", COLORS.MAP.BORDERS)
        .attr("stroke-width", 0.5)
}
