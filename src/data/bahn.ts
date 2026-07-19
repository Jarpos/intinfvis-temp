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
  delay_count: number;
  avg_delay: number;
  entries_count: number;
};

type DelaySummary = {
  region_name: string;
  date: string;
};

function stationIconForQuayCount(quayCount: number) {
  if (Number.isFinite(quayCount) && quayCount >= 1 && quayCount <= 4) {
    return triangleStationIcon;
  }

  if (Number.isFinite(quayCount) && quayCount >= 5 && quayCount <= 19) {
    return squareStationIcon;
  }

  if (Number.isFinite(quayCount) && quayCount > 19) {
    return starStationIcon;
  }

  return circleStationIcon;
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
  const maxDelayCount = d3.max(
    filteredConnections,
    (connection) => connection.delayCount,
  ) ?? 0;
  const lineWidthForDelayCount = d3
    .scaleLinear()
    .domain([0, Math.max(1, maxDelayCount)])
    .range([0.75, 6])
    .clamp(true);

  return g
    .selectAll<SVGLineElement, Connection>("line.train-delay-line")
    .data(filteredConnections, (d) => `${d.source.eva}-${d.target.eva}`)
    .join("line")
    .attr("class", "train-delay-line")
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
    .attr("stroke-width", (d) => lineWidthForDelayCount(d.delayCount))
    .attr("stroke-opacity", 0.9)
    .attr("pointer-events", "stroke")
    .attr("vector-effect", "non-scaling-stroke");
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
  delayCount: number;
};

export type DelayDirection = "incoming" | "outgoing" | "both";

export type StationDelayImpactStats = {
  station: Station;
  delayCount: number;
  weightedDelay: number;
};

export type StationDelayAddedStats = {
  station: Station;
  delayAdded: number;
  entriesCount: number;
  incomingEntriesCount: number;
  outgoingEntriesCount: number;
  incomingAvgDelay: number | null;
  outgoingAvgDelay: number | null;
};

type DelayConnectionAggregate = {
  source: Station;
  target: Station;
  weightedDelay: number;
  delayCount: number;
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
    delay_count: Number(d.delay_count),
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

function delayCountForTrip(trip: DelayTrip) {
  return Number.isFinite(trip.delay_count) && trip.delay_count > 0
    ? trip.delay_count
    : 0;
}

function entriesCountForTrip(trip: DelayTrip) {
  return Number.isFinite(trip.entries_count) && trip.entries_count > 0
    ? trip.entries_count
    : 0;
}

function orderedStationPair(source: Station, target: Station) {
  return source.eva <= target.eva
    ? { source, target }
    : { source: target, target: source };
}

function addTripToConnectionAggregate(
  connectionsByEdge: Map<string, DelayConnectionAggregate>,
  source: Station,
  target: Station,
  trip: DelayTrip,
  delayCount: number,
) {
  const ordered = orderedStationPair(source, target);
  const key = `${ordered.source.eva}-${ordered.target.eva}`;
  const current = connectionsByEdge.get(key);

  if (current) {
    current.weightedDelay += trip.avg_delay * delayCount;
    current.delayCount += delayCount;
  } else {
    connectionsByEdge.set(key, {
      source: ordered.source,
      target: ordered.target,
      weightedDelay: trip.avg_delay * delayCount,
      delayCount,
    });
  }
}

export function aggregateDelayConnections(trips: DelayTrip[]) {
  const connectionsByEdge = new Map<string, DelayConnectionAggregate>();

  trips.forEach((trip) => {
    const source = stationByEva.get(trip.from_stop_id);
    const target = stationByEva.get(trip.to_stop_id);
    const delayCount = delayCountForTrip(trip);

    if (!source || !target || !Number.isFinite(trip.avg_delay) || delayCount <= 0) {
      return;
    }

    addTripToConnectionAggregate(
      connectionsByEdge,
      source,
      target,
      trip,
      delayCount,
    );
  });

  return Array.from(connectionsByEdge.values()).map(
    ({ source, target, weightedDelay, delayCount }) => ({
      source,
      target,
      delay: weightedDelay / delayCount,
      delayCount,
    }),
  );
}

export function buildStationDelayImpactStats(
  trips: DelayTrip[],
  visibleStations: Station[],
  direction: DelayDirection,
) {
  const visibleStationsByEva = new Map(
    visibleStations.map((station) => [station.eva, station]),
  );
  const visibleConnections = aggregateDelayConnections(trips).filter(
    (connection) =>
      visibleStationsByEva.has(connection.source.eva) &&
      visibleStationsByEva.has(connection.target.eva),
  );

  const statsByEva = new Map<number, StationDelayImpactStats>();
  function addConnection(station: Station, connection: Connection) {
    const current =
      statsByEva.get(station.eva) ??
      ({
        station,
        delayCount: 0,
        weightedDelay: 0,
      } satisfies StationDelayImpactStats);

    current.delayCount += connection.delayCount;
    current.weightedDelay += connection.delay * connection.delayCount;
    statsByEva.set(station.eva, current);
  }

  visibleConnections.forEach((connection) => {
    const isSelfConnection = connection.source.eva === connection.target.eva;

    if (direction === "both") {
      addConnection(connection.source, connection);

      if (!isSelfConnection) {
        addConnection(connection.target, connection);
      }

      return;
    }

    if (isSelfConnection) {
      return;
    }

    if (direction === "outgoing") {
      addConnection(connection.source, connection);
    }

    if (direction === "incoming") {
      addConnection(connection.target, connection);
    }
  });

  return statsByEva;
}

export function buildStationDelayAddedStats(
  trips: DelayTrip[],
  visibleStations: Station[],
) {
  type DirectionStats = {
    entriesCount: number;
    weightedDelay: number;
  };
  type StationAccumulator = {
    station: Station;
    incoming: DirectionStats;
    outgoing: DirectionStats;
  };

  const visibleStationsByEva = new Map(
    visibleStations.map((station) => [station.eva, station]),
  );
  const statsByEva = new Map<number, StationAccumulator>();

  function stationStats(station: Station) {
    let stats = statsByEva.get(station.eva);

    if (!stats) {
      stats = {
        station,
        incoming: { entriesCount: 0, weightedDelay: 0 },
        outgoing: { entriesCount: 0, weightedDelay: 0 },
      };
      statsByEva.set(station.eva, stats);
    }

    return stats;
  }

  trips.forEach((trip) => {
    if (
      trip.from_stop_id === trip.to_stop_id ||
      !Number.isFinite(trip.avg_delay)
    ) {
      return;
    }

    const entriesCount = entriesCountForTrip(trip);

    if (entriesCount <= 0) {
      return;
    }

    const source = visibleStationsByEva.get(trip.from_stop_id);
    const target = visibleStationsByEva.get(trip.to_stop_id);

    if (!source || !target) {
      return;
    }

    const weightedDelay = trip.avg_delay * entriesCount;
    const sourceStats = stationStats(source);
    const targetStats = stationStats(target);

    sourceStats.outgoing.entriesCount += entriesCount;
    sourceStats.outgoing.weightedDelay += weightedDelay;
    targetStats.incoming.entriesCount += entriesCount;
    targetStats.incoming.weightedDelay += weightedDelay;
  });

  const result = new Map<number, StationDelayAddedStats>();

  statsByEva.forEach((stats, eva) => {
    const incomingAvgDelay =
      stats.incoming.entriesCount > 0
        ? stats.incoming.weightedDelay / stats.incoming.entriesCount
        : null;
    const outgoingAvgDelay =
      stats.outgoing.entriesCount > 0
        ? stats.outgoing.weightedDelay / stats.outgoing.entriesCount
        : null;

    let delayAdded: number | null = null;

    if (incomingAvgDelay !== null && outgoingAvgDelay !== null) {
      delayAdded = outgoingAvgDelay - incomingAvgDelay;
    } else if (outgoingAvgDelay !== null) {
      delayAdded = outgoingAvgDelay;
    } else if (incomingAvgDelay !== null) {
      delayAdded = incomingAvgDelay;
    }

    if (delayAdded === null || !Number.isFinite(delayAdded)) {
      return;
    }

    result.set(eva, {
      station: stats.station,
      delayAdded,
      entriesCount:
        stats.incoming.entriesCount + stats.outgoing.entriesCount,
      incomingEntriesCount: stats.incoming.entriesCount,
      outgoingEntriesCount: stats.outgoing.entriesCount,
      incomingAvgDelay,
      outgoingAvgDelay,
    });
  });

  return result;
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

export async function loadDelayTripsPerDay(
  range: DelayDateRange,
  nonIcRegions: string[] = [],
) {
  const availableDates = await loadAvailableDelayDates();
  const dates = delayDatesInRange(availableDates, range);
  const regionNames = Array.from(new Set(nonIcRegions)).sort();
  const regionNameSet = new Set(regionNames);

  const results: { [date: string]: DelayTrip[] } = {};

  await Promise.all(
    dates.map(async (date) => {
      const icUrl = `/data/bahn/csv/delays/ic/${date}.csv`;
      const nonIcUrls =
        regionNames.length > 0
          ? (
              await loadDelaySummaryRows(date)
            )
              .filter((summary) => regionNameSet.has(summary.region_name))
              .map(
                (summary) =>
                  `/data/bahn/csv/delays/non_ic/${delayRegionPathSegment(summary.region_name)}/${summary.date}.csv`,
              )
          : [];

      const urls = [icUrl, ...nonIcUrls];
      const delayRows = await Promise.all(
        urls.map((url) => loadDelayRows(url)),
      );

      results[date] = delayRows.flat();
    }),
  );

  return results;
}
