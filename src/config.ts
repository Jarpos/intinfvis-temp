import * as d3 from "d3";

import { COLORS } from "./colors";

// Declare the chart dimensions and margins.
export const WIDTH = window.innerWidth;
export const HEIGHT = window.innerHeight * .99;

export const map_svg = d3.create("svg")
    .attr("width", WIDTH)
    .attr("height", HEIGHT)
    .attr("viewBox", [0, 0, WIDTH, HEIGHT])
    .style("display", "block")
    .style("width", "100%")
    .style("height", "100%")
    .style("max-width", "100%")
    .style("max-height", "100%");

export const tooltip = d3.create("div")
    .style("position", "absolute")
    .style("z-index", "3000")
    .style("pointer-events", "none")
    .style("background", COLORS.TOOLTIP.BACKGROUND)
    .style("padding", "4px 8px")
    .style("border", `1px solid ${COLORS.TOOLTIP.BORDER}`)
    .style("display", "none");
