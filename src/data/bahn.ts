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
        .attr("r", 4)
        .attr("fill", COLORS.TRAINS.STATIONS);
}

// Real German stations (lon, lat)
export const stations = [
    { name: "Hamburg Hbf", coords: [10.006, 53.552] },
    { name: "Berlin Hbf", coords: [13.369, 52.525] },
    { name: "Hannover Hbf", coords: [9.741, 52.377] },
    { name: "Bremen Hbf", coords: [8.813, 53.083] },
    { name: "Dortmund Hbf", coords: [7.466, 51.517] },
    { name: "Köln Hbf", coords: [6.959, 50.943] },
    { name: "Frankfurt Hbf", coords: [8.663, 50.107] },
    { name: "Mannheim Hbf", coords: [8.467, 49.479] },
    { name: "Stuttgart Hbf", coords: [9.182, 48.783] },
    { name: "Nürnberg Hbf", coords: [11.082, 49.446] },
    { name: "Leipzig Hbf", coords: [12.383, 51.346] },
    { name: "Dresden Hbf", coords: [13.732, 51.040] },
    { name: "München Hbf", coords: [11.558, 48.140] },
    { name: "Kiel Hbf", coords: [10.139, 54.314] },
    { name: "Rostock Hbf", coords: [12.133, 54.088] },
    { name: "Magdeburg Hbf", coords: [11.635, 52.131] },
    { name: "Erfurt Hbf", coords: [11.037, 50.973] },
    { name: "Kassel-Wilhelmshöhe", coords: [9.447, 51.312] },
    { name: "Fulda Hbf", coords: [9.684, 50.555] },
    { name: "Würzburg Hbf", coords: [9.936, 49.802] },
    { name: "Karlsruhe Hbf", coords: [8.402, 48.993] },
    { name: "Freiburg (Breisgau) Hbf", coords: [7.842, 47.998] },
    { name: "Augsburg Hbf", coords: [10.886, 48.365] },
];

export const connections = [
    [0, 3],    // Hamburg - Bremen
    [3, 2],    // Bremen - Hannover
    [2, 1],    // Hannover - Berlin
    [1, 10],   // Berlin - Leipzig
    [10, 11],  // Leipzig - Dresden
    [2, 4],    // Hannover - Dortmund
    [4, 5],    // Dortmund - Köln
    [5, 6],    // Köln - Frankfurt
    [6, 7],    // Frankfurt - Mannheim
    [7, 8],    // Mannheim - Stuttgart
    [8, 9],    // Stuttgart - Nürnberg
    [9, 12],   // Nürnberg - München
    [6, 10],   // Frankfurt - Leipzig (ICE Sprinter corridor)
    [1, 11],   // Berlin - Dresden
    [13, 0],   // Kiel - Hamburg
    [14, 1],   // Rostock - Berlin
    [1, 15],   // Berlin - Magdeburg
    [15, 2],   // Magdeburg - Hannover
    [2, 17],   // Hannover - Kassel
    [17, 18],  // Kassel - Fulda
    [18, 6],   // Fulda - Frankfurt
    [10, 16],  // Leipzig - Erfurt
    [16, 18],  // Erfurt - Fulda
    [18, 19],  // Fulda - Würzburg
    [19, 9],   // Würzburg - Nürnberg
    [7, 20],   // Mannheim - Karlsruhe
    [20, 21],  // Karlsruhe - Freiburg
    [9, 22],   // Nürnberg - Augsburg
    [22, 12],  // Augsburg - München
    [6, 17],   // Frankfurt - Kassel
    [16, 17],  // Erfurt - Kassel
];
