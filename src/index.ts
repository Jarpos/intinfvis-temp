import "./styles.css";

import * as d3 from "d3";

import { COLORS } from "./colors";
import {
  appendTrainStrecken,
  appendTrainStations,
  localStations,
  icStations,
  loadDelayTripsPerDay,
  aggregateDelayConnections,
  buildStationDelayImpactStats,
} from "./data/bahn";
import type { Connection, DelayDateRange, Station, DelayTrip } from "./data/bahn";
import { appendGermany, geojson, projection } from "./data/geo";
import { HEIGHT, WIDTH, map_svg, tooltip } from "./config";
import { appendWeatherOverlay } from "./weatherOverlay";
import {
  DEFAULT_DATE_RANGE,
  SELECTED_DATE_CHANGE_EVENT,
  WEATHER_DATE_PREVIEW_EVENT,
} from "./dateSync";
import type {
  SelectedDateChangeDetail,
  WeatherDatePreviewDetail,
} from "./dateSync";

const g = map_svg.append("g");
const LOCAL_STATIONS_ZOOM_LEVEL = 2;
let currentZoomTransform = d3.zoomIdentity;
let focusedState: string | null = null;
const focusedStateListeners = new Set<(state: string | null) => void>();
let isClickFocusing = false;
let lastPointer: [number, number] | null = null;
let zoom: d3.ZoomBehavior<SVGSVGElement, undefined>;
let trainConnections: Connection[] = [];
let dailyDelayTrips: { [date: string]: DelayTrip[] } | null = null;
let activeDelayDate: string | null = null;
let previewDelayDate: string | null = null;
let trainDelayRequestKey = "";
let trainDelayLoadToken = 0;
let selectedDelayRange: DelayDateRange = {
  from: formatDateInputValue(DEFAULT_DATE_RANGE.from),
  to: formatDateInputValue(DEFAULT_DATE_RANGE.to),
};
const allStationNames = new Set(localStations.map((station) => station.name));
const selectedStationNames = new Set(allStationNames);
const geoPath = d3.geoPath(projection);
const loadingOverlay = document.getElementById("loading-overlay");
const loadingOverlayTitle =
  loadingOverlay?.querySelector<HTMLElement>(".loader-title") ?? null;
let loadingTaskCount = 0;
let loadingHideTimer: number | null = null;

function beginLoadingTask(message: string) {
  loadingTaskCount += 1;

  if (loadingHideTimer !== null) {
    window.clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }

  if (loadingOverlayTitle) {
    loadingOverlayTitle.textContent = message;
  }

  loadingOverlay?.classList.remove("is-hidden");

  let isComplete = false;

  return () => {
    if (isComplete) {
      return;
    }

    isComplete = true;
    loadingTaskCount = Math.max(0, loadingTaskCount - 1);

    if (loadingTaskCount > 0) {
      return;
    }

    loadingHideTimer = window.setTimeout(() => {
      loadingOverlay?.classList.add("is-hidden");
      loadingHideTimer = null;
    }, 0);
  };
}

const completeInitialLoading = beginLoadingTask("Loading map data...");

function regionKey(state?: string | null, region?: string | null) {
  return state && region ? `${state}|${region}` : null;
}

function stateName(feature: GeoJSON.Feature) {
  return (
    (feature.properties as { NAME_1?: string; name?: string } | null)?.NAME_1 ??
    (feature.properties as { NAME_1?: string; name?: string } | null)?.name ??
    "Unknown"
  );
}

function getMapViewport() {
  return (
    document.getElementById("map-viewport") ??
    document.getElementById("map-panel")
  );
}

function screenPointToSvgPoint(x: number, y: number) {
  const svg = map_svg.node();
  const matrix = svg?.getScreenCTM()?.inverse();

  if (!svg || !matrix) {
    return [x, y] as [number, number];
  }

  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  const transformedPoint = point.matrixTransform(matrix);

  return [transformedPoint.x, transformedPoint.y] as [number, number];
}

function getMapFocusRect() {
  const mapViewport = getMapViewport();
  const viewportRect = mapViewport?.getBoundingClientRect();

  if (!viewportRect) {
    return {
      left: 0,
      top: 0,
      right: WIDTH,
      bottom: HEIGHT,
      width: WIDTH,
      height: HEIGHT,
      centerX: WIDTH / 2,
      centerY: HEIGHT / 2,
    };
  }

  const screenRect = {
    left: viewportRect.left,
    top: viewportRect.top,
    right: viewportRect.right,
    bottom: viewportRect.bottom,
  };

  if (viewportRect) {
    const panelRect = document
      .querySelector<HTMLElement>(".weather-panel")
      ?.getBoundingClientRect();
    const timelineRect = document
      .querySelector<HTMLElement>(".weather-timeline")
      ?.getBoundingClientRect();
    const gap = 16;

    if (
      panelRect &&
      panelRect.width > 0 &&
      panelRect.right > viewportRect.left &&
      panelRect.left < viewportRect.right
    ) {
      screenRect.left = Math.min(
        screenRect.right,
        Math.max(screenRect.left, panelRect.right + gap),
      );
    }

    if (
      timelineRect &&
      timelineRect.height > 0 &&
      timelineRect.top > viewportRect.top &&
      timelineRect.top < viewportRect.bottom
    ) {
      screenRect.bottom = Math.max(
        screenRect.top,
        Math.min(screenRect.bottom, timelineRect.top - gap),
      );
    }
  }

  if (screenRect.right - screenRect.left < 240) {
    screenRect.left = Math.max(viewportRect.left, screenRect.right - 240);
  }

  if (screenRect.bottom - screenRect.top < 240) {
    screenRect.top = Math.max(viewportRect.top, screenRect.bottom - 240);
  }

  const [left, top] = screenPointToSvgPoint(screenRect.left, screenRect.top);
  const [right, bottom] = screenPointToSvgPoint(
    screenRect.right,
    screenRect.bottom,
  );
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function coordinateKey([longitude, latitude]: GeoJSON.Position) {
  return `${longitude.toFixed(5)},${latitude.toFixed(5)}`;
}

function edgeKey(start: GeoJSON.Position, end: GeoJSON.Position) {
  const startKey = coordinateKey(start);
  const endKey = coordinateKey(end);

  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
}

function addRingEdges(
  edges: Map<
    string,
    { start: GeoJSON.Position; end: GeoJSON.Position; count: number }
  >,
  ring: GeoJSON.Position[],
) {
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    const key = edgeKey(start, end);
    const current = edges.get(key);

    if (current) {
      current.count += 1;
    } else {
      edges.set(key, { start, end, count: 1 });
    }
  }
}

function addFeatureEdges(
  edges: Map<
    string,
    { start: GeoJSON.Position; end: GeoJSON.Position; count: number }
  >,
  feature: GeoJSON.Feature,
) {
  const geometry = feature.geometry;

  if (!geometry) {
    return;
  }

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach((ring) => addRingEdges(edges, ring));
  }

  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygon) => {
      polygon.forEach((ring) => addRingEdges(edges, ring));
    });
  }
}

function buildStateBoundaryPaths() {
  const edgesByState = new Map<
    string,
    Map<
      string,
      { start: GeoJSON.Position; end: GeoJSON.Position; count: number }
    >
  >();

  geojson.features.forEach((feature) => {
    const state = stateName(feature);
    const edges = edgesByState.get(state) ?? new Map();

    addFeatureEdges(edges, feature);
    edgesByState.set(state, edges);
  });

  return new Map(
    Array.from(edgesByState, ([state, edges]) => {
      const pathData = Array.from(edges.values())
        .filter((edge) => edge.count === 1)
        .map(({ start, end }) => {
          const projectedStart = projection(start as [number, number]);
          const projectedEnd = projection(end as [number, number]);

          if (!projectedStart || !projectedEnd) {
            return "";
          }

          return `M${projectedStart[0]},${projectedStart[1]}L${projectedEnd[0]},${projectedEnd[1]}`;
        })
        .join("");

      return [state, pathData];
    }),
  );
}

// Germany Map
const germanyAreas = appendGermany(g);

let trainStationsLayer: d3.Selection<
  SVGGElement,
  undefined,
  null,
  undefined
> | null = null;
let highlightedWeatherImpactStationEva: number | null = null;

function setWeatherImpactStationHighlight(stationEva: number | null) {
  highlightedWeatherImpactStationEva = stationEva;

  trainStationsLayer
    ?.selectAll<SVGImageElement, Station>("image.train-station-icon")
    .classed(
      "is-weather-impact-highlighted",
      (station) => station.eva === highlightedWeatherImpactStationEva,
    );
}

// Hourly historic temperature map
const weatherOverlay = await appendWeatherOverlay(g, {
  beginLoadingTask,
  onStationHoverChange: setWeatherImpactStationHighlight,
});

const stateHoverLayer = g
  .append("g")
  .attr("aria-label", "Bundesland hover layer");
const stateHoverAreas = stateHoverLayer
  .selectAll("path")
  .data(geojson.features)
  .join("path")
  .attr("d", geoPath)
  .attr("fill", "transparent")
  .attr("stroke", "transparent")
  .attr("stroke-width", 0)
  .attr("pointer-events", "all");
const stateBoundaryPaths = buildStateBoundaryPaths();
const stateBoundaryLayer = g
  .append("g")
  .attr("aria-label", "Bundesland boundary highlight")
  .attr("pointer-events", "none");
const stateBoundaryAreas = stateBoundaryLayer
  .selectAll("path")
  .data(
    Array.from(stateBoundaryPaths, ([state, pathData]) => ({
      state,
      pathData,
    })),
  )
  .join("path")
  .attr("d", (d) => d.pathData)
  .attr("fill", "none")
  .attr("stroke", "transparent")
  .attr("stroke-linejoin", "round")
  .attr("stroke-linecap", "round")
  .attr("stroke-width", 0);

stateHoverAreas
  .on("mouseenter", function (_, d) {
    const hoveredState = stateName(d);

    if (focusedState) {
      d3.select(this).attr("stroke", "#0f172a").attr("stroke-width", 2);
      return;
    }

    stateBoundaryAreas
      .filter((area) => area.state === hoveredState)
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 2.4)
      .raise();
  })
  .on("mousemove", (event, d) => {
    const point = d3.pointer(event, g.node()) as [number, number];
    weatherOverlay.showTooltipAtPoint(event, point);
  })
  .on("click", (event, d) => {
    event.stopPropagation();
    isClickFocusing = true;
    focusState(stateName(d), true);
  })
  .on("mouseleave", function (_, d) {
    const hoveredState = stateName(d);

    if (focusedState) {
      d3.select(this).attr("stroke", "transparent").attr("stroke-width", 0);
      tooltip.style("display", "none");
      return;
    }

    stateBoundaryAreas
      .filter((area) => area.state === hoveredState)
      .attr("stroke", "transparent")
      .attr("stroke-width", 0);
    tooltip.style("display", "none");
  });

const trainLinesLayer = g.append("g");
trainStationsLayer = g.append("g");
let trainNetworkRenderFrame = 0;

function featuresForState(state: string) {
  return geojson.features.filter((feature) => stateName(feature) === state);
}

function updateMapVisibility() {
  const isStateFocused = !!focusedState;

  germanyAreas.style("display", (feature) =>
    !isStateFocused || stateName(feature) === focusedState ? "" : "none",
  );
  stateHoverAreas
    .style("display", (feature) =>
      !isStateFocused || stateName(feature) === focusedState ? "" : "none",
    )
    .attr("stroke", "transparent")
    .attr("stroke-width", 0);
  stateBoundaryAreas.attr("stroke", "transparent").attr("stroke-width", 0);
}

function transformForState(state: string) {
  const features = featuresForState(state);

  if (features.length === 0) {
    return null;
  }

  const collection = {
    type: "FeatureCollection",
    features,
  } as GeoJSON.FeatureCollection;
  const [[x0, y0], [x1, y1]] = geoPath.bounds(collection);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const focusRect = getMapFocusRect();
  const fitPadding = Math.min(
    150,
    focusRect.width * 0.18,
    focusRect.height * 0.18,
  );
  const usableWidth = Math.max(180, focusRect.width - fitPadding * 2);
  const usableHeight = Math.max(180, focusRect.height - fitPadding * 2);
  const scale = Math.min(
    8,
    Math.max(
      LOCAL_STATIONS_ZOOM_LEVEL,
      Math.min(usableWidth / dx, usableHeight / dy),
    ),
  );
  const translateX = focusRect.centerX - (scale * (x0 + x1)) / 2;
  const translateY = focusRect.centerY - (scale * (y0 + y1)) / 2;

  return d3.zoomIdentity.translate(translateX, translateY).scale(scale);
}

function notifyFocusedStateChanged() {
  focusedStateListeners.forEach((listener) => listener(focusedState));
}

function focusState(state: string | null, zoomToState = false) {
  if (focusedState === state && !zoomToState) {
    return;
  }

  const stateChanged = focusedState !== state;
  focusedState = state;

  if (stateChanged) {
    notifyFocusedStateChanged();
  }

  updateMapVisibility();
  renderTrainNetwork();
  tooltip.style("display", "none");

  if (!state || !zoomToState) {
    return;
  }

  const nextTransform = transformForState(state);

  if (nextTransform) {
    map_svg
      .transition()
      .duration(650)
      .call(zoom.transform, nextTransform)
      .on("end interrupt", () => {
        focusedState = state;
        isClickFocusing = false;
        updateMapVisibility();
        renderTrainNetwork();
      });
  } else {
    isClickFocusing = false;
  }
}

function transformForGermany() {
  const [[x0, y0], [x1, y1]] = geoPath.bounds(geojson);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const focusRect = getMapFocusRect();
  const fitPadding = Math.min(
    40,
    focusRect.width * 0.05,
    focusRect.height * 0.05,
  );
  const usableWidth = Math.max(180, focusRect.width - fitPadding * 2);
  const usableHeight = Math.max(180, focusRect.height - fitPadding * 2);
  const scale = Math.min(usableWidth / dx, usableHeight / dy);
  const translateX = focusRect.centerX - (scale * (x0 + x1)) / 2;
  const translateY = focusRect.centerY - (scale * (y0 + y1)) / 2;

  return d3.zoomIdentity.translate(translateX, translateY).scale(scale);
}

function refitMap(transition = false) {
  if (!zoom) {
    return;
  }

  const nextTransform = focusedState ? transformForState(focusedState) : transformForGermany();

  if (!nextTransform) {
    return;
  }

  if (transition) {
    map_svg
      .transition()
      .duration(350)
      .call(zoom.transform, nextTransform);
  } else {
    map_svg.call(zoom.transform, nextTransform);
  }
}

document.addEventListener("weather-impact-layout-change", () => {
  window.requestAnimationFrame(() => refitMap(true));
});

function stateAtViewportCenter() {
  const focusRect = getMapFocusRect();
  const mapPoint = currentZoomTransform.invert([
    focusRect.centerX,
    focusRect.centerY,
  ]);
  const coordinates = projection.invert?.(mapPoint);

  if (!coordinates) {
    return null;
  }

  const containingFeature = geojson.features.find((feature) =>
    d3.geoContains(feature, coordinates),
  );

  return containingFeature ? stateName(containingFeature) : null;
}

function stateAtScreenPoint(point: [number, number]) {
  const mapPoint = currentZoomTransform.invert(point);
  const coordinates = projection.invert?.(mapPoint);

  if (!coordinates) {
    return null;
  }

  const containingFeature = geojson.features.find((feature) =>
    d3.geoContains(feature, coordinates),
  );

  return containingFeature ? stateName(containingFeature) : null;
}

function mergeStationsByEva(...stationGroups: Station[][]) {
  const stationsByEva = new Map<number, Station>();

  stationGroups.flat().forEach((station) => {
    if (!stationsByEva.has(station.eva)) {
      stationsByEva.set(station.eva, station);
    }
  });

  return Array.from(stationsByEva.values());
}

function delayRegionsForFocusedState() {
  if (!focusedState) {
    return [];
  }

  return Array.from(
    new Set(
      localStations
        .filter((station) => station.state === focusedState)
        .map((station) => station.region)
        .filter((region): region is string => !!region),
    ),
  ).sort();
}

function trainDelayKey(range: DelayDateRange, regionNames: string[]) {
  return [range.from, range.to, ...regionNames].join("|");
}

function setTrainDelayRange(range: DelayDateRange) {
  if (
    selectedDelayRange.from === range.from &&
    selectedDelayRange.to === range.to
  ) {
    return;
  }

  selectedDelayRange = range;
  trainDelayRequestKey = "";
  renderTrainNetwork();
}

function requestTrainDelayConnections() {
  const regionNames = delayRegionsForFocusedState();
  const requestKey = trainDelayKey(selectedDelayRange, regionNames);

  if (requestKey === trainDelayRequestKey) {
    return;
  }

  trainDelayRequestKey = requestKey;
  trainConnections = [];
  dailyDelayTrips = null;

  const requestToken = ++trainDelayLoadToken;

  loadDelayTripsPerDay(selectedDelayRange, regionNames)
    .then((tripsPerDay) => {
      if (requestToken !== trainDelayLoadToken) {
        return;
      }

      dailyDelayTrips = tripsPerDay;
      const allTrips = Object.values(tripsPerDay).flat();
      trainConnections = aggregateDelayConnections(allTrips);
      renderTrainNetwork();
    })
    .catch((error) => {
      if (requestToken !== trainDelayLoadToken) {
        return;
      }

      console.error("Failed to load train delay data", error);
    });
}

function positionTooltip(event: MouseEvent) {
  tooltip
    .style("left", `${event.pageX + 10}px`)
    .style("top", `${event.pageY + 10}px`);
}

function showSectionDelayTooltip(event: MouseEvent, connection: Connection) {
  const routeLine = document.createElement("div");
  routeLine.textContent = `${connection.source.name} - ${connection.target.name}`;

  const delayLine = document.createElement("div");
  delayLine.textContent = `Avg delay: ${(connection.delay / 60).toFixed(1)} min`;

  const delayCountLine = document.createElement("div");
  delayCountLine.textContent = `Delay count: ${formatDelayCount(
    connection.delayCount,
  )}`;

  tooltip.node()?.replaceChildren(routeLine, delayLine, delayCountLine);
  tooltip.style("display", "block").style("background", COLORS.TOOLTIP.BACKGROUND);
  positionTooltip(event);
}

type DirectionalStationDelayStats = {
  delayCount: number;
  weightedDelay: number;
};

type StationDelayStats = {
  total: DirectionalStationDelayStats;
  incoming: DirectionalStationDelayStats;
  outgoing: DirectionalStationDelayStats;
};

function createDirectionalStationDelayStats(): DirectionalStationDelayStats {
  return {
    delayCount: 0,
    weightedDelay: 0,
  };
}

function createStationDelayStats(): StationDelayStats {
  return {
    total: createDirectionalStationDelayStats(),
    incoming: createDirectionalStationDelayStats(),
    outgoing: createDirectionalStationDelayStats(),
  };
}

function stationDelayStatsForEva(
  statsByEva: Map<number, StationDelayStats>,
  eva: number,
) {
  let stats = statsByEva.get(eva);

  if (!stats) {
    stats = createStationDelayStats();
    statsByEva.set(eva, stats);
  }

  return stats;
}

function buildStationDelayStats(
  trips: DelayTrip[],
  visibleStations: Station[],
) {
  const statsByEva = new Map<number, StationDelayStats>();
  const incomingStats = buildStationDelayImpactStats(
    trips,
    visibleStations,
    "incoming",
  );
  const outgoingStats = buildStationDelayImpactStats(
    trips,
    visibleStations,
    "outgoing",
  );
  const totalStats = buildStationDelayImpactStats(
    trips,
    visibleStations,
    "both",
  );

  visibleStations.forEach((station) => {
    const sourceStats = stationDelayStatsForEva(
      statsByEva,
      station.eva,
    );
    const total = totalStats.get(station.eva);
    const incoming = incomingStats.get(station.eva);
    const outgoing = outgoingStats.get(station.eva);

    if (total) {
      sourceStats.total.delayCount = total.delayCount;
      sourceStats.total.weightedDelay = total.weightedDelay;
    }

    if (incoming) {
      sourceStats.incoming.delayCount = incoming.delayCount;
      sourceStats.incoming.weightedDelay = incoming.weightedDelay;
    }

    if (outgoing) {
      sourceStats.outgoing.delayCount = outgoing.delayCount;
      sourceStats.outgoing.weightedDelay = outgoing.weightedDelay;
    }
  });

  return statsByEva;
}

function formatAverageDelay(stats: DirectionalStationDelayStats) {
  if (stats.delayCount <= 0) {
    return "N/A";
  }

  return `${(stats.weightedDelay / stats.delayCount / 60).toFixed(1)} min`;
}

function formatDelayCount(count: number) {
  return count.toLocaleString("de-DE");
}

function showStationDelayTooltip(
  event: MouseEvent,
  station: Station,
  stationDelayStats: StationDelayStats,
) {
  const stationNameLine = document.createElement("div");
  stationNameLine.textContent = station.name;

  const totalDelayCountLine = document.createElement("div");
  totalDelayCountLine.textContent = `Section delay count: ${formatDelayCount(
    stationDelayStats.total.delayCount,
  )}`;

  const totalDelayLine = document.createElement("div");
  totalDelayLine.textContent = `Avg section delay: ${formatAverageDelay(
    stationDelayStats.total,
  )}`;

  const incomingDelayCountLine = document.createElement("div");
  incomingDelayCountLine.textContent = `Incoming delay count: ${formatDelayCount(
    stationDelayStats.incoming.delayCount,
  )}`;

  const outgoingDelayCountLine = document.createElement("div");
  outgoingDelayCountLine.textContent = `Outgoing delay count: ${formatDelayCount(
    stationDelayStats.outgoing.delayCount,
  )}`;

  const incomingDelayLine = document.createElement("div");
  incomingDelayLine.textContent = `Avg incoming delay: ${formatAverageDelay(
    stationDelayStats.incoming,
  )}`;

  const outgoingDelayLine = document.createElement("div");
  outgoingDelayLine.textContent = `Avg outgoing delay: ${formatAverageDelay(
    stationDelayStats.outgoing,
  )}`;

  tooltip
    .node()
    ?.replaceChildren(
      stationNameLine,
      totalDelayCountLine,
      totalDelayLine,
      incomingDelayCountLine,
      outgoingDelayCountLine,
      incomingDelayLine,
      outgoingDelayLine,
    );
  tooltip.style("display", "block").style("background", COLORS.TOOLTIP.BACKGROUND);
  positionTooltip(event);
}

function renderTrainNetwork() {
  requestTrainDelayConnections();

  if (!trainStationsLayer) {
    return;
  }

  const shouldShowLocalStations = !!focusedState;
  const visibleIcStations = icStations.filter((station) => {
    if (!selectedStationNames.has(station.name)) {
      return false;
    }

    if (focusedState && station.state !== focusedState) {
      return false;
    }

    return true;
  });
  const visibleLocalStations = shouldShowLocalStations
    ? localStations.filter((station) => {
        if (!selectedStationNames.has(station.name)) {
          return false;
        }

        if (station.state !== focusedState) {
          return false;
        }

        return true;
      })
    : [];
  const visibleStations = mergeStationsByEva(
    visibleIcStations,
    visibleLocalStations,
  );
  const visibleStationNames = new Set(
    visibleStations.map((station) => station.name),
  );
  const stationRadius = shouldShowLocalStations ? 0.5 : 2.2;
  const stationFill = shouldShowLocalStations
    ? COLORS.TRAINS.STATIONS
    : "#0f172a";

  const dateToRender = previewDelayDate || activeDelayDate;
  let displayConnections = trainConnections;
  let displayTrips = dailyDelayTrips ? Object.values(dailyDelayTrips).flat() : [];
  if (dateToRender && dailyDelayTrips) {
    displayTrips = dailyDelayTrips[dateToRender] ?? [];
    displayConnections = aggregateDelayConnections(
      displayTrips,
    );
  }
  const stationDelayStatsByEva = buildStationDelayStats(
    displayTrips,
    visibleStations,
  );

  appendTrainStrecken(trainLinesLayer, displayConnections, visibleStationNames)
    .on("mouseenter", function (event, d) {
      d3.select(this).classed("is-section-delay-hovered", true).raise();
      showSectionDelayTooltip(event, d);
    })
    .on("mousemove", (event) => {
      positionTooltip(event);
    })
    .on("mouseleave", function () {
      d3.select(this).classed("is-section-delay-hovered", false);
      tooltip.style("display", "none");
    });
  appendTrainStations(
    trainStationsLayer,
    visibleStations,
    stationRadius,
    stationFill,
  )
    .classed(
      "is-weather-impact-highlighted",
      (station) => station.eva === highlightedWeatherImpactStationEva,
    )
    .on("mouseenter", function (event, d) {
      weatherOverlay.setHoveredStation(d.eva);
      d3.select(this)
        .attr("opacity", 1)
        .style(
          "filter",
          "brightness(0) saturate(100%) invert(83%) sepia(94%) saturate(1058%) hue-rotate(358deg) brightness(101%) contrast(106%)",
        );
      showStationDelayTooltip(
        event,
        d,
        stationDelayStatsByEva.get(d.eva) ?? createStationDelayStats(),
      );
    })
    .on("mousemove", (event) => {
      positionTooltip(event);
    })
    .on("mouseleave", function () {
      weatherOverlay.setHoveredStation(null);
      d3.select(this)
        .attr("opacity", this.getAttribute("data-station-opacity") ?? 1)
        .style("filter", null);
      tooltip.style("display", "none");
    });

  if (!previewDelayDate) {
    weatherOverlay.updateData(visibleStations, focusedState, dailyDelayTrips);
  }
}

function scheduleTrainNetworkRender() {
  if (trainNetworkRenderFrame) {
    return;
  }

  trainNetworkRenderFrame = window.requestAnimationFrame(() => {
    trainNetworkRenderFrame = 0;
    renderTrainNetwork();
  });
}

function setElementDisplay(selector: string, visible: boolean) {
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    element.style.display = visible ? "" : "none";
  });
}

function applyTemperatureView() {
  setElementDisplay(".weather-panel, .weather-timeline", true);
  d3.selectAll<SVGGElement, unknown>(
    ".weather-overlay-layer, .weather-boundary-layer",
  ).style("display", "");

  trainLinesLayer.style("display", "");
  trainStationsLayer?.style("display", "");
  stateHoverLayer.style("display", "").style("pointer-events", "all");
  stateBoundaryLayer.style("display", "");
  updateMapVisibility();

  tooltip.style("display", "none");

  renderTrainNetwork();
}

function getRequiredElement<T extends HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

function setupStationFilterPanel() {
  const searchInput = getRequiredElement<HTMLInputElement>("#station-search");
  const countText = getRequiredElement<HTMLParagraphElement>("#station-count");
  const list = getRequiredElement<HTMLDivElement>("#station-list");
  const selectAllButton = getRequiredElement<HTMLButtonElement>(
    "#select-all-stations",
  );
  const clearButton = getRequiredElement<HTMLButtonElement>("#clear-stations");
  let selectedState: string | null = null;
  let selectedRegion: string | null = null;

  function stationState(station: Station) {
    return station.state ?? "Unknown";
  }

  function stationRegion(station: Station) {
    return station.region ?? "Unknown";
  }

  function sortByName<T extends { name: string }>(items: T[]) {
    return items.sort((left, right) =>
      left.name.localeCompare(right.name, "de-DE"),
    );
  }

  function stationsForCurrentRegion() {
    return localStations.filter(
      (station) =>
        stationState(station) === selectedState &&
        stationRegion(station) === selectedRegion,
    );
  }

  function syncListToFocusedState(state: string | null) {
    if (selectedState === state) {
      return;
    }

    selectedState = state;
    selectedRegion = null;
    renderStationList();
  }

  function makeDrillRow(
    label: string,
    count: number,
    onClick: () => void,
    secondaryLabel?: string,
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-2 text-left",
      "text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-300",
    ].join(" ");
    button.addEventListener("click", onClick);

    const textWrap = document.createElement("span");
    textWrap.className = "min-w-0";

    const title = document.createElement("span");
    title.className = "block truncate text-sm font-semibold";
    title.textContent = label;
    textWrap.append(title);

    if (secondaryLabel) {
      const subtitle = document.createElement("span");
      subtitle.className = "block truncate text-xs font-medium text-slate-400";
      subtitle.textContent = secondaryLabel;
      textWrap.append(subtitle);
    }

    const badge = document.createElement("span");
    badge.className =
      "rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500";
    badge.textContent = count.toLocaleString("de-DE");

    button.append(textWrap, badge);
    return button;
  }

  function makeBackButton(label: string, onClick: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "mb-2 rounded-md px-2 py-1 text-sm font-semibold text-sky-700 transition hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-300";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function appendStationCheckbox(station: Station, showLocation = false) {
    const label = document.createElement("label");
    label.className = [
      "flex cursor-pointer items-start gap-3 rounded-md px-1 py-2 text-base font-semibold",
      "text-slate-600 transition hover:bg-slate-50",
    ].join(" ");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedStationNames.has(station.name);
    checkbox.className = [
      "mt-0.5 h-6 w-6 rounded border-slate-300 accent-sky-600",
      "focus:ring-2 focus:ring-sky-300",
    ].join(" ");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedStationNames.add(station.name);
      } else {
        selectedStationNames.delete(station.name);
      }

      renderTrainNetwork();
      renderStationList();
    });

    const textWrap = document.createElement("span");
    textWrap.className = "min-w-0";

    const name = document.createElement("span");
    name.className = "block truncate";
    name.textContent = station.name;
    textWrap.append(name);

    if (showLocation) {
      const location = document.createElement("span");
      location.className = "block truncate text-xs font-medium text-slate-400";
      location.textContent = [
        stationState(station),
        stationRegion(station),
      ].join(", ");
      textWrap.append(location);
    }

    label.append(checkbox, textWrap);
    list.append(label);
  }

  function renderStationList() {
    const query = searchInput.value.trim().toLowerCase();

    countText.textContent = `${selectedStationNames.size} of ${allStationNames.size} selected`;
    list.replaceChildren();

    if (query) {
      const visibleStations = sortByName(
        localStations.filter((station) =>
          station.name.toLowerCase().includes(query),
        ),
      );

      countText.textContent = `Search results - ${visibleStations.length.toLocaleString("de-DE")} stations`;
      visibleStations.forEach((station) =>
        appendStationCheckbox(station, true),
      );

      if (visibleStations.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "px-1 py-6 text-sm font-medium text-slate-400";
        emptyState.textContent = "No stations found.";
        list.append(emptyState);
      }

      return;
    }

    if (!selectedState) {
      const stateRows = sortByName(
        Array.from(
          d3.rollup(
            localStations,
            (stateStations) => stateStations.length,
            stationState,
          ),
          ([name, count]) => ({ name, count }),
        ),
      );

      stateRows.forEach(({ name, count }) => {
        list.append(
          makeDrillRow(name, count, () => {
            focusState(name, true);
          }),
        );
      });

      if (stateRows.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "px-1 py-6 text-sm font-medium text-slate-400";
        emptyState.textContent = "No Bundesland found.";
        list.append(emptyState);
      }

      return;
    }

    if (!selectedRegion) {
      list.append(
        makeBackButton("Back to Bundesland", () => {
          focusState(null, false);
        }),
      );

      const stateStations = localStations.filter(
        (station) => stationState(station) === selectedState,
      );
      const regionRows = sortByName(
        Array.from(
          d3.rollup(
            stateStations,
            (regionStations) => regionStations.length,
            stationRegion,
          ),
          ([name, count]) => ({ name, count }),
        ),
      );

      countText.textContent = `${selectedState} - ${stateStations.length.toLocaleString("de-DE")} stations`;

      regionRows.forEach(({ name, count }) => {
        list.append(
          makeDrillRow(
            name,
            count,
            () => {
              selectedRegion = name;
              renderStationList();
            },
            selectedState ?? undefined,
          ),
        );
      });

      if (regionRows.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "px-1 py-6 text-sm font-medium text-slate-400";
        emptyState.textContent = "No Regierungsbezirk found.";
        list.append(emptyState);
      }

      return;
    }

    list.append(
      makeBackButton("Back to Regierungsbezirk", () => {
        selectedRegion = null;
        renderStationList();
      }),
    );

    const visibleStations = sortByName(stationsForCurrentRegion());

    countText.textContent = `${selectedRegion}, ${selectedState} - ${visibleStations.length.toLocaleString("de-DE")} stations`;

    visibleStations.forEach((station) => appendStationCheckbox(station));

    if (visibleStations.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.className = "px-1 py-6 text-sm font-medium text-slate-400";
      emptyState.textContent = "No stations found.";
      list.append(emptyState);
    }
  }

  searchInput.addEventListener("input", renderStationList);
  selectAllButton.addEventListener("click", () => {
    localStations.forEach((station) => selectedStationNames.add(station.name));
    renderTrainNetwork();
    renderStationList();
  });
  clearButton.addEventListener("click", () => {
    selectedStationNames.clear();
    renderTrainNetwork();
    renderStationList();
  });
  focusedStateListeners.add(syncListToFocusedState);
  syncListToFocusedState(focusedState);

  renderStationList();
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function setupTimeRangePicker(initialRange: { from: Date; to: Date }) {
  const fromInput = getRequiredElement<HTMLInputElement>("#from-date");
  const toInput = getRequiredElement<HTMLInputElement>("#to-date");

  const initialFromDate = startOfDay(initialRange.from);
  const initialToDate = startOfDay(initialRange.to);

  let fromDate = initialFromDate;
  let toDate = initialToDate;
  let selectedDate = initialFromDate;

  function syncInputs() {
    fromInput.value = formatDateInputValue(fromDate);
    toInput.value = formatDateInputValue(toDate);
  }

  function ensureSelectedDateInRange() {
    if (selectedDate < fromDate || selectedDate > toDate) {
      selectedDate = fromDate;
    }
  }

  function notifySelectedDateChange() {
    ensureSelectedDateInRange();
    activeDelayDate = formatDateInputValue(selectedDate);
    previewDelayDate = null;
    setTrainDelayRange({
      from: formatDateInputValue(fromDate),
      to: formatDateInputValue(toDate),
    });

    document.dispatchEvent(
      new CustomEvent<SelectedDateChangeDetail>(SELECTED_DATE_CHANGE_EVENT, {
        detail: {
          from: formatDateInputValue(fromDate),
          to: formatDateInputValue(toDate),
          selected: formatDateInputValue(selectedDate),
          source: "time-range",
        },
      }),
    );
  }

  function setDateRange(nextFromDate: Date, nextToDate: Date) {
    fromDate = startOfDay(nextFromDate);
    toDate = startOfDay(nextToDate);
    syncInputs();
  }

  function updateFromInput(value: string) {
    const nextDate = parseDateInputValue(value);

    if (!nextDate) {
      return;
    }

    fromDate = startOfDay(nextDate);

    if (fromDate > toDate) {
      toDate = fromDate;
    }

    syncInputs();
    notifySelectedDateChange();
  }

  function updateToInput(value: string) {
    const nextDate = parseDateInputValue(value);

    if (!nextDate) {
      return;
    }

    toDate = startOfDay(nextDate);

    if (toDate < fromDate) {
      fromDate = toDate;
    }

    syncInputs();
    notifySelectedDateChange();
  }

  fromInput.addEventListener("change", () => updateFromInput(fromInput.value));
  toInput.addEventListener("change", () => updateToInput(toInput.value));
  document.addEventListener(SELECTED_DATE_CHANGE_EVENT, ((event: Event) => {
    const { from, to, selected, source } = (
      event as CustomEvent<SelectedDateChangeDetail>
    ).detail;

    if (source === "time-range") {
      return;
    }

    const nextFromDate = parseDateInputValue(from);
    const nextToDate = parseDateInputValue(to);
    const nextSelectedDate = parseDateInputValue(selected);

    if (nextFromDate && nextToDate) {
      setDateRange(nextFromDate, nextToDate);

      if (source === "weather-timeline") {
        if (nextSelectedDate) {
          selectedDate = startOfDay(nextSelectedDate);
        }
        activeDelayDate = selected;
        renderTrainNetwork();
      } else {
        activeDelayDate = null;
        setTrainDelayRange({
          from: formatDateInputValue(fromDate),
          to: formatDateInputValue(toDate),
        });
      }
    }
  }) as EventListener);

  document.addEventListener(WEATHER_DATE_PREVIEW_EVENT, ((event: Event) => {
    const { selected } = (event as CustomEvent<WeatherDatePreviewDetail>)
      .detail;

    previewDelayDate = selected;
    renderTrainNetwork();
  }) as EventListener);

  syncInputs();
}

renderTrainNetwork();

map_svg.on("mousemove", (event) => {
  lastPointer = d3.pointer(event, map_svg.node()) as [number, number];
});

zoom = d3
  .zoom<SVGSVGElement, undefined>()
  .scaleExtent([0.75, 20])
  .on("zoom", (event) => {
    currentZoomTransform = event.transform;
    g.attr("transform", currentZoomTransform.toString());

    if (isClickFocusing) {
      updateMapVisibility();
      scheduleTrainNetworkRender();
      return;
    }

    if (currentZoomTransform.k >= LOCAL_STATIONS_ZOOM_LEVEL && !focusedState) {
      const centerState =
        (lastPointer ? stateAtScreenPoint(lastPointer) : null) ??
        stateAtViewportCenter();

      if (centerState) {
        focusState(centerState, false);
      }
    }

    if (currentZoomTransform.k < LOCAL_STATIONS_ZOOM_LEVEL && focusedState) {
      focusState(null, false);
    }

    updateMapVisibility();
    scheduleTrainNetworkRender();
  });
map_svg.call(zoom);
setupStationFilterPanel();
setupTimeRangePicker(DEFAULT_DATE_RANGE);
applyTemperatureView();

const mapViewport = getRequiredElement<HTMLElement>("#map-viewport");
mapViewport.append(map_svg.node()!);

// Center and fit the Germany map to the visual area initially
refitMap(false);

window.addEventListener("resize", () => {
  refitMap(false);
});

document.body.append(tooltip.node()!);

completeInitialLoading();
