import "./styles.css";

import * as d3 from "d3";

import { COLORS } from "./colors";
import {
  appendTrainStrecken,
  appendTrainStations,
  localStations,
  stations,
} from "./data/bahn";
import type { Station } from "./data/bahn";
import { appendGermany, geojson, projection } from "./data/geo";
import { HEIGHT, WIDTH, map_svg, tooltip } from "./config";
import { appendWeatherOverlay } from "./weatherOverlay";
import { DEFAULT_DATE_RANGE, SELECTED_DATE_CHANGE_EVENT } from "./dateSync";
import type { SelectedDateChangeDetail } from "./dateSync";

const g = map_svg.append("g");
const LOCAL_STATIONS_ZOOM_LEVEL = 2;
let currentZoomTransform = d3.zoomIdentity;
let focusedState: string | null = null;
let isClickFocusing = false;
let lastPointer: [number, number] | null = null;
let zoom: d3.ZoomBehavior<SVGSVGElement, undefined>;
const allStationNames = new Set(localStations.map((station) => station.name));
const selectedStationNames = new Set(allStationNames);
const stationCountByState = d3.rollup(
  localStations,
  (stateStations) => stateStations.length,
  (station) => station.state ?? "Unknown",
);
const stationCountByRegion = d3.rollup(
  localStations,
  (regionStations) => regionStations.length,
  (station) => regionKey(station.state, station.region) ?? "Unknown",
);
const geoPath = d3.geoPath(projection);

function regionKey(state?: string | null, region?: string | null) {
  return state && region ? `${state}|${region}` : null;
}

function stateName(feature: GeoJSON.Feature) {
  return (
    (feature.properties as { NAME_1?: string; name?: string } | null)
      ?.NAME_1 ??
    (feature.properties as { NAME_1?: string; name?: string } | null)?.name ??
    "Unknown"
  );
}

function regionName(feature: GeoJSON.Feature) {
  return (
    (feature.properties as { NAME_2?: string } | null)?.NAME_2 ?? "Unknown"
  );
}

function showStateTooltip(event: MouseEvent, state: string) {
  const stationCount = stationCountByState.get(state) ?? 0;

  tooltip
    .style("display", "block")
    .style("background", "rgba(255, 255, 255, 0.96)")
    .style("border", "1px solid rgba(15, 23, 42, 0.16)")
    .style("border-radius", "12px")
    .style("box-shadow", "0 18px 38px rgba(15, 23, 42, 0.18)")
    .style("padding", "14px 16px")
    .style("min-width", "220px")
    .style("color", "#1f2937")
    .style("font-family", "Inter, ui-sans-serif, system-ui, sans-serif")
    .style("left", `${event.pageX + 16}px`)
    .style("top", `${event.pageY + 16}px`)
    .html(
      [
        `<div style="font-size: 18px; font-weight: 800; margin-bottom: 10px;">${state}</div>`,
        `<div style="display: grid; grid-template-columns: 1fr auto; gap: 6px 18px; font-size: 15px;">`,
        `<span style="color: #6b7280;">Stations</span>`,
        `<strong>${stationCount.toLocaleString("de-DE")}</strong>`,
        `</div>`,
      ].join(""),
    );
}

function showRegionTooltip(event: MouseEvent, state: string, region: string) {
  const stationCount =
    stationCountByRegion.get(regionKey(state, region) ?? "Unknown") ?? 0;

  tooltip
    .style("display", "block")
    .style("background", "rgba(255, 255, 255, 0.96)")
    .style("border", "1px solid rgba(15, 23, 42, 0.16)")
    .style("border-radius", "12px")
    .style("box-shadow", "0 18px 38px rgba(15, 23, 42, 0.18)")
    .style("padding", "14px 16px")
    .style("min-width", "240px")
    .style("color", "#1f2937")
    .style("font-family", "Inter, ui-sans-serif, system-ui, sans-serif")
    .style("left", `${event.pageX + 16}px`)
    .style("top", `${event.pageY + 16}px`)
    .html(
      [
        `<div style="font-size: 18px; font-weight: 800; margin-bottom: 4px;">${region}</div>`,
        `<div style="font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 10px;">${state}</div>`,
        `<div style="display: grid; grid-template-columns: 1fr auto; gap: 6px 18px; font-size: 15px;">`,
        `<span style="color: #6b7280;">Stations</span>`,
        `<strong>${stationCount.toLocaleString("de-DE")}</strong>`,
        `</div>`,
      ].join(""),
    );
}

function coordinateKey([longitude, latitude]: GeoJSON.Position) {
  return `${longitude.toFixed(5)},${latitude.toFixed(5)}`;
}

function edgeKey(
  start: GeoJSON.Position,
  end: GeoJSON.Position,
) {
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
    Map<string, { start: GeoJSON.Position; end: GeoJSON.Position; count: number }>
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

// Hourly historic temperature map
appendWeatherOverlay(g);

const stateHoverLayer = g
  .append("g")
  .attr("aria-label", "Bundesland hover layer");
type ViewMode = "temperature" | "stations";
let activeViewMode: ViewMode = "temperature";
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
  .data(Array.from(stateBoundaryPaths, ([state, pathData]) => ({
    state,
    pathData,
  })))
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
    const state = stateName(d);

    if (focusedState) {
      showRegionTooltip(event, state, regionName(d));
      return;
    }

    showStateTooltip(event, state);
  })
  .on("click", (event, d) => {
    if (activeViewMode !== "stations") {
      return;
    }

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
const trainStationsLayer = g.append("g");
let trainNetworkRenderFrame = 0;

function featuresForState(state: string) {
  return geojson.features.filter((feature) => stateName(feature) === state);
}

function updateMapVisibility() {
  const isStateFocused = activeViewMode === "stations" && !!focusedState;

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
  const mapPanel = document.getElementById("map-panel");
  const viewportWidth = mapPanel?.clientWidth || WIDTH;
  const viewportHeight = mapPanel?.clientHeight || HEIGHT;
  const fitPadding = 150;
  const usableWidth = Math.max(240, viewportWidth - fitPadding * 2);
  const usableHeight = Math.max(240, viewportHeight - fitPadding * 2);
  const scale = Math.min(
    8,
    Math.max(
      LOCAL_STATIONS_ZOOM_LEVEL,
      Math.min(usableWidth / dx, usableHeight / dy),
    ),
  );
  const translateX = viewportWidth / 2 - (scale * (x0 + x1)) / 2;
  const translateY = viewportHeight / 2 - (scale * (y0 + y1)) / 2;

  return d3.zoomIdentity.translate(translateX, translateY).scale(scale);
}

function focusState(state: string | null, zoomToState = false) {
  if (focusedState === state && !zoomToState) {
    return;
  }

  focusedState = state;
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

function stateAtViewportCenter() {
  const mapPanel = document.getElementById("map-panel");
  const viewportWidth = mapPanel?.clientWidth || WIDTH;
  const viewportHeight = mapPanel?.clientHeight || HEIGHT;
  const mapPoint = currentZoomTransform.invert([
    viewportWidth / 2,
    viewportHeight / 2,
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

function regionBoundsIntersectViewport(
  feature: GeoJSON.Feature,
  padding = 64,
) {
  const [[minX, minY], [maxX, maxY]] = geoPath.bounds(feature);
  const screenMinX = currentZoomTransform.applyX(minX);
  const screenMaxX = currentZoomTransform.applyX(maxX);
  const screenMinY = currentZoomTransform.applyY(minY);
  const screenMaxY = currentZoomTransform.applyY(maxY);

  return (
    screenMaxX >= -padding &&
    screenMinX <= WIDTH + padding &&
    screenMaxY >= -padding &&
    screenMinY <= HEIGHT + padding
  );
}

function visibleRegionKeys() {
  const visibleRegions = new Set<string>();

  geojson.features.forEach((feature) => {
    if (!regionBoundsIntersectViewport(feature)) {
      return;
    }

    const properties = feature.properties as
      | { NAME_1?: string; NAME_2?: string }
      | null;
    const key = regionKey(properties?.NAME_1, properties?.NAME_2);

    if (key) {
      visibleRegions.add(key);
    }
  });

  return visibleRegions;
}

function stationIsInViewport(station: Station) {
  const projected = projection(station.coords as [number, number]);

  if (!projected) {
    return false;
  }

  const [x, y] = projected;
  const screenX = currentZoomTransform.applyX(x);
  const screenY = currentZoomTransform.applyY(y);

  return screenX >= 0 && screenX <= WIDTH && screenY >= 0 && screenY <= HEIGHT;
}

function renderTrainNetwork() {
  const shouldShowLocalStations =
    currentZoomTransform.k >= LOCAL_STATIONS_ZOOM_LEVEL;
  const stationSource = shouldShowLocalStations ? localStations : stations;
  const localVisibleRegionKeys = shouldShowLocalStations
    ? visibleRegionKeys()
    : null;
  const visibleStations = stationSource.filter((station) => {
    if (!selectedStationNames.has(station.name)) {
      return false;
    }

    if (focusedState && station.state !== focusedState) {
      return false;
    }

    if (!shouldShowLocalStations) {
      return true;
    }

    const key = regionKey(station.state, station.region);

    if (!key || !localVisibleRegionKeys?.has(key)) {
      return false;
    }

    return stationIsInViewport(station);
  });
  const visibleStationNames = new Set(
    visibleStations.map((station) => station.name),
  );
  const stationRadius = shouldShowLocalStations ? 0.5 : 2.2;
  const stationFill = shouldShowLocalStations
    ? COLORS.TRAINS.STATIONS
    : "#0f172a";

  appendTrainStrecken(trainLinesLayer, visibleStationNames);
  appendTrainStations(
    trainStationsLayer,
    visibleStations,
    stationRadius,
    stationFill,
  )
    .on("mouseenter", function (_, d) {
      d3.select(this).attr("fill", COLORS.MAP.HIGHLIGHT);
      const locationParts = [d.state, d.region].filter(Boolean);
      tooltip
        .style("display", "block")
        .text(
          locationParts.length > 0
            ? `${d.name} - ${locationParts.join(", ")}`
            : d.name,
        );
    })
    .on("mousemove", (event) => {
      tooltip
        .style("left", `${event.pageX + 10}px`)
        .style("top", `${event.pageY + 10}px`);
    })
    .on("mouseleave", function () {
      d3.select(this).attr("fill", COLORS.TRAINS.STATIONS);
      tooltip.style("display", "none");
    });
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

function applyViewMode(mode: ViewMode) {
  activeViewMode = mode;
  const showTemperature = mode === "temperature";
  const showStations = mode === "stations";

  setElementDisplay(".weather-panel, .weather-timeline", showTemperature);
  d3.selectAll<SVGGElement, unknown>(
    ".weather-overlay-layer, .weather-boundary-layer",
  ).style("display", showTemperature ? "" : "none");

  trainLinesLayer.style(
    "display",
    showTemperature || showStations ? "" : "none",
  );
  trainStationsLayer.style("display", showStations ? "" : "none");
  stateHoverLayer
    .style("display", showStations ? "" : "none")
    .style("pointer-events", showStations ? "all" : "none");
  stateBoundaryLayer.style("display", showStations ? "" : "none");
  updateMapVisibility();

  tooltip.style("display", "none");

  renderTrainNetwork();
}

function setupViewModeControl() {
  const control = document.createElement("label");
  control.className = "view-mode-control";
  control.style.position = "fixed";
  control.style.top = "16px";
  control.style.left = "50%";
  control.style.transform = "translateX(-50%)";
  control.style.zIndex = "40";
  control.style.display = "flex";
  control.style.alignItems = "center";
  control.style.gap = "10px";
  control.style.border = "1px solid rgba(15, 23, 42, 0.14)";
  control.style.borderRadius = "8px";
  control.style.background = "rgba(255, 255, 255, 0.94)";
  control.style.boxShadow = "0 12px 28px rgba(15, 23, 42, 0.14)";
  control.style.padding = "8px 10px";
  control.style.color = "#334155";
  control.style.font = "700 13px Inter, ui-sans-serif, system-ui, sans-serif";

  const text = document.createElement("span");
  text.textContent = "View";

  const select = document.createElement("select");
  select.value = activeViewMode;
  select.style.height = "32px";
  select.style.border = "1px solid #cbd5e1";
  select.style.borderRadius = "6px";
  select.style.background = "#ffffff";
  select.style.padding = "0 28px 0 8px";
  select.style.color = "#0f172a";
  select.style.font = "700 13px Inter, ui-sans-serif, system-ui, sans-serif";

  [
    ["temperature", "Temperature"],
    ["stations", "Station count"],
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  });

  select.addEventListener("change", () => {
    applyViewMode(select.value as ViewMode);
  });

  control.append(text, select);
  document.body.append(control);
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

  function renderStationList() {
    const query = searchInput.value.trim().toLowerCase();
    const visibleStations = localStations.filter((station) =>
      station.name.toLowerCase().includes(query),
    );

    countText.textContent = `${selectedStationNames.size} of ${allStationNames.size} selected`;
    list.replaceChildren();

    //Limited the number of rendered DOM elements in the station checkbox list to 200 (from ~10,000+) to ensure the UI remains responsive even when the user searches for common terms that match many stations. Added a message indicating how many stations are not shown and encouraging users to refine their search for better results.
    const renderLimit = 200;
    const stationsToRender = visibleStations.slice(0, renderLimit);

    stationsToRender.forEach((station) => {
      const label = document.createElement("label");
      label.className = [
        "flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 text-base font-semibold",
        "text-slate-600 transition hover:bg-slate-50",
      ].join(" ");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedStationNames.has(station.name);
      checkbox.className = [
        "h-6 w-6 rounded border-slate-300 accent-sky-600",
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

      const name = document.createElement("span");
      name.textContent = station.name;

      label.append(checkbox, name);
      list.append(label);
    });

    if (visibleStations.length > renderLimit) {
      const remainingCount = visibleStations.length - renderLimit;
      const truncationMessage = document.createElement("div");
      truncationMessage.className =
        "px-1 py-3 text-xs font-semibold text-slate-400 text-center border-t border-slate-100 mt-2";
      truncationMessage.textContent = `... and ${remainingCount.toLocaleString()} more. Refine your search to find specific stations.`;
      list.append(truncationMessage);
    }

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

function sameDay(left: Date, right: Date) {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

function addMonths(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function setupTimeRangePicker(initialRange: { from: Date; to: Date }) {
  const fromInput = getRequiredElement<HTMLInputElement>("#from-date");
  const toInput = getRequiredElement<HTMLInputElement>("#to-date");
  const monthLabel =
    getRequiredElement<HTMLParagraphElement>("#calendar-month");
  const calendarDays = getRequiredElement<HTMLDivElement>("#calendar-days");
  const previousMonthButton =
    getRequiredElement<HTMLButtonElement>("#previous-month");
  const nextMonthButton = getRequiredElement<HTMLButtonElement>("#next-month");

  const today = startOfDay(new Date());
  const initialFromDate = startOfDay(initialRange.from);
  const initialToDate = startOfDay(initialRange.to);

  let fromDate = initialFromDate;
  let toDate = initialToDate;
  let activeBoundary: "from" | "to" = "from";
  let displayedMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);

  function syncInputs() {
    fromInput.value = formatDateInputValue(fromDate);
    toInput.value = formatDateInputValue(toDate);
  }

  function notifySelectedDateChange(selectedDate: Date) {
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
    displayedMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    activeBoundary = "to";
    syncInputs();
    renderCalendar();
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

    displayedMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    syncInputs();
    renderCalendar();
    notifySelectedDateChange(fromDate);
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

    displayedMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    syncInputs();
    renderCalendar();
    notifySelectedDateChange(toDate);
  }

  function renderCalendar() {
    const monthFormatter = new Intl.DateTimeFormat("en", {
      month: "long",
      year: "numeric",
    });
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();
    const firstWeekdayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    monthLabel.textContent = monthFormatter.format(displayedMonth);
    calendarDays.replaceChildren();

    for (let index = 0; index < firstWeekdayOffset; index += 1) {
      calendarDays.append(document.createElement("span"));
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const isFromDate = sameDay(date, fromDate);
      const isToDate = sameDay(date, toDate);
      const isInRange = date > fromDate && date < toDate;
      const isToday = sameDay(date, today);
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = String(day);
      button.ariaLabel = `Select ${formatDateInputValue(date)}`;
      button.className = [
        "h-8 rounded-md text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-sky-300",
        isFromDate || isToDate
          ? "bg-sky-600 text-white hover:bg-sky-700"
          : isInRange
            ? "bg-sky-100 text-sky-800 hover:bg-sky-200"
            : "bg-white text-slate-600 hover:bg-slate-100",
        isToday && !isFromDate && !isToDate ? "ring-1 ring-sky-400" : "",
      ].join(" ");

      button.addEventListener("click", () => {
        if (activeBoundary === "from") {
          fromDate = date;

          if (fromDate > toDate) {
            toDate = fromDate;
          }

          activeBoundary = "to";
          notifySelectedDateChange(fromDate);
        } else {
          toDate = date;

          if (toDate < fromDate) {
            fromDate = toDate;
          }

          activeBoundary = "from";
          notifySelectedDateChange(toDate);
        }

        syncInputs();
        renderCalendar();
      });

      calendarDays.append(button);
    }
  }

  fromInput.addEventListener("focus", () => {
    activeBoundary = "from";
  });
  toInput.addEventListener("focus", () => {
    activeBoundary = "to";
  });
  fromInput.addEventListener("change", () => updateFromInput(fromInput.value));
  toInput.addEventListener("change", () => updateToInput(toInput.value));
  previousMonthButton.addEventListener("click", () => {
    displayedMonth = addMonths(displayedMonth, -1);
    renderCalendar();
  });
  nextMonthButton.addEventListener("click", () => {
    displayedMonth = addMonths(displayedMonth, 1);
    renderCalendar();
  });
  document.addEventListener(SELECTED_DATE_CHANGE_EVENT, ((event: Event) => {
    const { from, to, source } = (
      event as CustomEvent<SelectedDateChangeDetail>
    ).detail;

    if (source === "time-range") {
      return;
    }

    const nextFromDate = parseDateInputValue(from);
    const nextToDate = parseDateInputValue(to);

    if (nextFromDate && nextToDate) {
      setDateRange(nextFromDate, nextToDate);
    }
  }) as EventListener);

  syncInputs();
  renderCalendar();
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

    if (
      activeViewMode === "stations" &&
      currentZoomTransform.k >= LOCAL_STATIONS_ZOOM_LEVEL &&
      !focusedState
    ) {
      const centerState =
        (lastPointer ? stateAtScreenPoint(lastPointer) : null) ??
        stateAtViewportCenter();

      if (centerState) {
        focusState(centerState, false);
      }
    }

    if (
      activeViewMode === "stations" &&
      currentZoomTransform.k < LOCAL_STATIONS_ZOOM_LEVEL &&
      focusedState
    ) {
      focusState(null, false);
    }

    updateMapVisibility();
    scheduleTrainNetworkRender();
  });
map_svg.call(zoom);
setupStationFilterPanel();
setupTimeRangePicker(DEFAULT_DATE_RANGE);
setupViewModeControl();
applyViewMode(activeViewMode);

const mapPanel = getRequiredElement<HTMLElement>("#map-panel");
mapPanel.append(map_svg.node()!);

document.body.append(tooltip.node()!);

const loadingOverlay = document.getElementById("loading-overlay");
if (loadingOverlay) {
  loadingOverlay.style.opacity = "0";
  setTimeout(() => {
    loadingOverlay.remove();
  }, 400);
}
