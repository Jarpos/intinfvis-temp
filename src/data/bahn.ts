import * as d3 from "d3";

import { COLORS } from "../colors";
import circleStationIcon from "../images/icons/circle-filled.svg";
import squareStationIcon from "../images/icons/square-filled.svg";
import starStationIcon from "../images/icons/star-filled.svg";
import triangleStationIcon from "../images/icons/triangle-filled.svg";
import { projection } from "./geo";

export interface StationCsvColumns {
  eva: number;
  name: string;
  lat: number;
  lon: number;
  region_name: string;
  state_name: string;
  quay_count: number;
  mobility_accessibility: boolean;
  audible_accessibility: boolean;
  visual_accessibility: boolean;
  tactile_accessibility: boolean;
}

export interface Station extends StationCsvColumns {
  coords: [number, number];
  region: string;
  state: string;
}

export type DelayDateRange = {
  from: string;
  to: string;
};

export type DelayTrip = {
  from_stop_id: number;
  to_stop_id: number;
  avg_delay: number;
  entries_count: number;
};

type DelaySummary = {
  region_name: string;
  date: string;
};

function stationIconForQuayCount(quayCount: number) {
  if (Number.isFinite(quayCount) && quayCount >= 1 && quayCount <= 4) {
    return circleStationIcon;
  }

  if (Number.isFinite(quayCount) && quayCount >= 5 && quayCount <= 19) {
    return squareStationIcon;
  }

  if (Number.isFinite(quayCount) && quayCount > 19) {
    return starStationIcon;
  }

  return triangleStationIcon;
}

function stationIconSizeMultiplier(quayCount: number) {
  if (Number.isFinite(quayCount) && quayCount >= 5 && quayCount <= 19) {
    return 1.5;
  }

  if (Number.isFinite(quayCount) && quayCount > 19) {
    return 2;
  }

  return 1;
}

function opacityForStationFill(fill: string) {
  const hexAlpha = fill.match(/^#[\da-f]{8}$/i)?.[0].slice(7, 9);

  if (!hexAlpha) {
    return 1;
  }

  return Number.parseInt(hexAlpha, 16) / 255;
}

function parseCsvBoolean(value: string | undefined) {
  return value === "true" || value === "1";
}

function parseStationRow(d: Record<string, string | undefined>): Station {
  const lat = Number(d.lat);
  const lon = Number(d.lon);
  const regionName = d.region_name ?? "";
  const stateName = d.state_name ?? "";

  return {
    eva: Number(d.eva),
    name: d.name ?? "",
    lat,
    lon,
    region_name: regionName,
    state_name: stateName,
    quay_count: Number(d.quay_count),
    mobility_accessibility: parseCsvBoolean(d.mobility_accessibility),
    audible_accessibility: parseCsvBoolean(d.audible_accessibility),
    visual_accessibility: parseCsvBoolean(d.visual_accessibility),
    tactile_accessibility: parseCsvBoolean(d.tactile_accessibility),
    region: regionName,
    state: stateName,
    coords: [
      lon, // longitude first
      lat, // latitude second
    ],
  };
}

//now filters connections using a fast Set.has check (O(1) per connection), reducing rendering calculations
export function appendTrainStrecken(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
  connections: Connection[],
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
  const baseIconSize = radius * 2.4;
  const iconOpacity = opacityForStationFill(fill);

  return g
    .selectAll<SVGImageElement, Station>("image.train-station-icon")
    .data(visibleStations, (d) => (d as Station).name)
    .join("image")
    .attr("class", "train-station-icon")
    .attr("href", (d) => stationIconForQuayCount(d.quay_count))
    .attr("x", (d) => {
      const iconSize = baseIconSize * stationIconSizeMultiplier(d.quay_count);

      return projection(d.coords as [number, number])![0] - iconSize / 2;
    })
    .attr("y", (d) => {
      const iconSize = baseIconSize * stationIconSizeMultiplier(d.quay_count);

      return projection(d.coords as [number, number])![1] - iconSize / 2;
    })
    .attr(
      "width",
      (d) => baseIconSize * stationIconSizeMultiplier(d.quay_count),
    )
    .attr(
      "height",
      (d) => baseIconSize * stationIconSizeMultiplier(d.quay_count),
    )
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("opacity", iconOpacity)
    .attr("data-station-opacity", iconOpacity);
}

export async function loadIcStations() {
  // TODO: Pull out link root into global scope
  return d3.csv("/data/bahn/csv/stations-ic.csv", parseStationRow);
}

export async function loadLocalStations() {
  // TODO: Pull out link root into global scope
  return d3.csv("/data/bahn/csv/stations-train.csv", parseStationRow);
}

// Real German stations (lon, lat)
export const icStations = await loadIcStations();
export const localStations = await loadLocalStations();

export type Connection = {
  source: Station;
  target: Station;
  delay: number;
};

type DelayConnectionAggregate = {
  source: Station;
  target: Station;
  weightedDelay: number;
  entries: number;
};

const stationByEva = new Map(
  [...localStations, ...icStations].map((station) => [station.eva, station]),
);
const delayRowsByUrl = new Map<string, Promise<DelayTrip[]>>();
const delaySummariesByUrl = new Map<string, Promise<DelaySummary[]>>();
let availableDelayDatesPromise: Promise<Set<string>> | null = null;

function parseDelayRow(d: Record<string, string | undefined>): DelayTrip {
  return {
    from_stop_id: Number(d.from_stop_id),
    to_stop_id: Number(d.to_stop_id),
    avg_delay: Number(d.avg_delay),
    entries_count: Number(d.entries_count),
  };
}

function parseDelaySummaryRow(
  d: Record<string, string | undefined>,
): DelaySummary {
  return {
    region_name: d.region_name ?? "",
    date: d.date ?? "",
  };
}

function loadAvailableDelayDates() {
  availableDelayDatesPromise ??= d3
    .json<string[]>("/data/bahn/csv/delays/dates.json")
    .then((dates) => new Set(dates ?? []));

  return availableDelayDatesPromise;
}

function loadDelayRows(url: string) {
  const cachedRows = delayRowsByUrl.get(url);

  if (cachedRows) {
    return cachedRows;
  }

  const rows = d3.csv(url, parseDelayRow).catch(() => []);
  delayRowsByUrl.set(url, rows);

  return rows;
}

function loadDelaySummaryRows(date: string) {
  const url = `/data/bahn/csv/delays/summaries/summary-${date}.csv`;
  const cachedRows = delaySummariesByUrl.get(url);

  if (cachedRows) {
    return cachedRows;
  }

  const rows = d3.csv(url, parseDelaySummaryRow).catch(() => []);
  delaySummariesByUrl.set(url, rows);

  return rows;
}

function delayDatesInRange(availableDates: Set<string>, range: DelayDateRange) {
  return Array.from(availableDates)
    .filter((date) => date >= range.from && date <= range.to)
    .sort();
}

function delayRegionPathSegment(regionName: string) {
  return encodeURIComponent(regionName);
}

function aggregateDelayConnections(trips: DelayTrip[]) {
  const connectionsByEdge = new Map<string, DelayConnectionAggregate>();

  trips.forEach((trip) => {
    const source = stationByEva.get(trip.from_stop_id);
    const target = stationByEva.get(trip.to_stop_id);

    if (!source || !target || !Number.isFinite(trip.avg_delay)) {
      return;
    }

    const key = `${source.eva}-${target.eva}`;
    const entries =
      Number.isFinite(trip.entries_count) && trip.entries_count > 0
        ? trip.entries_count
        : 1;
    const current = connectionsByEdge.get(key);

    if (current) {
      current.weightedDelay += trip.avg_delay * entries;
      current.entries += entries;
    } else {
      connectionsByEdge.set(key, {
        source,
        target,
        weightedDelay: trip.avg_delay * entries,
        entries,
      });
    }
  });

  return Array.from(connectionsByEdge.values()).map(
    ({ source, target, weightedDelay, entries }) => ({
      source,
      target,
      delay: weightedDelay / entries,
    }),
  );
}

export async function loadDelayConnections(
  range: DelayDateRange,
  nonIcRegions: string[] = [],
) {
  const availableDates = await loadAvailableDelayDates();
  const dates = delayDatesInRange(availableDates, range);
  const regionNames = Array.from(new Set(nonIcRegions)).sort();
  const regionNameSet = new Set(regionNames);
  const icUrls = dates.map((date) => `/data/bahn/csv/delays/ic/${date}.csv`);
  const nonIcUrls =
    regionNames.length > 0
      ? (
          await Promise.all(
            dates.map(async (date) => {
              const summaries = await loadDelaySummaryRows(date);

              return summaries
                .filter((summary) => regionNameSet.has(summary.region_name))
                .map(
                  (summary) =>
                    `/data/bahn/csv/delays/non_ic/${delayRegionPathSegment(summary.region_name)}/${summary.date}.csv`,
                );
            }),
          )
        ).flat()
      : [];
  const delayRows = await Promise.all(
    [...icUrls, ...nonIcUrls].map((url) => loadDelayRows(url)),
  );

  return aggregateDelayConnections(delayRows.flat());
}
