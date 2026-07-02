import * as d3 from "d3";

import { COLORS } from "./colors";
import { HEIGHT, WIDTH, tooltip } from "./config";
import {
  DEFAULT_DATE_RANGE,
  SELECTED_DATE_CHANGE_EVENT,
  WEATHER_DATE_PREVIEW_EVENT,
} from "./dateSync";
import type { SelectedDateChangeDetail } from "./dateSync";
import {
  TEMPERATURE_RANGE,
  WEATHER_VARIABLES,
  buildTemperatureCells,
  displayedTemperature,
  loadHistoricalTemperatures,
  temperatureBand,
  temperatureColor,
  toDateInputValue,
} from "./data/weather";
import type {
  TemperatureCell,
  WeatherDataset,
  WeatherDateRange,
  WeatherHour,
  WeatherVariableConfig,
} from "./data/weather";
import { geojson, projection } from "./data/geo";
import { aggregateDelayConnections } from "./data/bahn";
import type { DelayTrip } from "./data/bahn";

type WeatherOverlay = {
  layer: d3.Selection<SVGGElement, undefined, null, undefined>;
  status: HTMLDivElement;
  slider: HTMLInputElement;
  sliderWrap: HTMLDivElement;
  stepMarks: HTMLDivElement;
  timeBubble: HTMLDivElement;
  currentCells: TemperatureCell[];
  chartContainer?: HTMLDivElement;
  legendContainer?: HTMLDivElement;
};

export type WeatherOverlayController = {
  showTooltipAtPoint: (event: MouseEvent, point: [number, number]) => boolean;
  hideTooltip: () => void;
  updateData: (
    visibleStationNames: Set<string>,
    focusedState: string | null,
    dailyDelayTrips: { [date: string]: DelayTrip[] } | null
  ) => void;
};

const formatTime = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

function createLegend() {
  const panel = document.createElement("div");
  panel.className = "weather-panel";

  const dropdownContainer = document.createElement("div");
  dropdownContainer.className = "weather-dropdown-container";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "weather-dropdown-trigger";
  trigger.textContent = "Temperature";

  const menu = document.createElement("ul");
  menu.className = "weather-dropdown-menu";

  const options = [
    { value: "temperature_2m", label: "Temperature" },
    { value: "precipitation", label: "Precipitation" },
    { value: "snow_depth", label: "Snow Depth" },
  ];
  options.forEach((opt) => {
    const item = document.createElement("li");
    item.className = "weather-dropdown-item";
    item.textContent = opt.label;
    item.setAttribute("data-value", opt.value);
    if (opt.value === "temperature_2m") {
      item.classList.add("is-selected");
    }
    menu.append(item);
  });

  dropdownContainer.append(trigger, menu);

  const legend = document.createElement("div");
  legend.className = "weather-legend";

  const legendTitle = document.createElement("div");
  legendTitle.className = "weather-legend-title";

  const scale = document.createElement("div");
  scale.className = "weather-legend-scale";

  const gradient = document.createElement("div");
  gradient.className = "weather-gradient";

  const legendTicks = document.createElement("div");
  legendTicks.className = "weather-ticks";

  scale.append(gradient, legendTicks);
  legend.append(legendTitle, scale);
  panel.append(dropdownContainer, legend);
  document.body.append(panel);

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    dropdownContainer.classList.toggle("is-open");
  });

  document.addEventListener("click", () => {
    dropdownContainer.classList.remove("is-open");
  });

  menu.querySelectorAll(".weather-dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      const val = item.getAttribute("data-value");
      if (val) {
        menu.querySelectorAll(".weather-dropdown-item").forEach((el) => {
          el.classList.remove("is-selected");
        });
        item.classList.add("is-selected");
        trigger.textContent = item.textContent;

        const changeEvent = new CustomEvent("change", {
          detail: { value: val },
        });
        dropdownContainer.dispatchEvent(changeEvent);
      }
    });
  });

  return { dropdown: dropdownContainer, legendTitle, legendTicks };
}

function updateLegend(
  legendTitle: HTMLDivElement,
  legendTicks: HTMLDivElement,
  config: WeatherVariableConfig,
) {
  legendTitle.textContent = config.unit;
  legendTicks.replaceChildren();

  config.ticks.forEach((tickVal) => {
    const span = document.createElement("span");
    span.textContent =
      config.key === "snow_depth" ? tickVal.toFixed(1) : tickVal.toFixed(0);
    legendTicks.append(span);
  });
}

function createTimeline() {
  const timeline = document.createElement("div");
  timeline.className = "weather-timeline";

  const meta = document.createElement("div");
  meta.className = "weather-timeline-meta";

  const utcLabel = document.createElement("div");
  utcLabel.textContent = "UTC+02:00 Europe/Berlin";

  const status = document.createElement("div");
  status.className = "weather-status";
  status.textContent = "Fetching Open-Meteo";

  meta.append(utcLabel, status);

  const containerBody = document.createElement("div");
  containerBody.className = "weather-timeline-body";
  containerBody.style.display = "flex";
  containerBody.style.gap = "20px";
  containerBody.style.alignItems = "stretch";

  const chartContainer = document.createElement("div");
  chartContainer.className = "weather-chart-container";
  chartContainer.style.flex = "1";
  chartContainer.style.height = "180px";
  chartContainer.style.position = "relative";

  const legendContainer = document.createElement("div");
  legendContainer.className = "weather-legend-container";
  legendContainer.style.width = "180px";
  legendContainer.style.display = "flex";
  legendContainer.style.flexDirection = "column";
  legendContainer.style.justifyContent = "center";
  legendContainer.style.gap = "8px";

  containerBody.append(chartContainer, legendContainer);
  timeline.append(meta, containerBody);
  document.body.append(timeline);

  // Keep a dummy slider and other elements for compatibility
  const slider = document.createElement("input");
  slider.type = "range";
  slider.style.display = "none";

  const sliderWrap = document.createElement("div");
  sliderWrap.style.display = "none";
  const stepMarks = document.createElement("div");
  stepMarks.style.display = "none";
  const timeBubble = document.createElement("div");
  timeBubble.style.display = "none";

  return { status, slider, sliderWrap, stepMarks, timeBubble, chartContainer, legendContainer };
}

function formatDayName(date: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function formatDayDate(date: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Berlin",
  })
    .format(date)
    .replace(/\.+$/, "");
}

function hourPosition(index: number, hours: WeatherHour[]) {
  return hours.length <= 1 ? 0 : (index / (hours.length - 1)) * 100;
}

function sameCalendarDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function dayKey(date: Date) {
  return toDateInputValue(date);
}

function noonForDate(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0,
    0,
  );
}

function closestIndexForDateLabel(hours: WeatherHour[], date: Date) {
  const noon = noonForDate(date);
  const candidates = hours
    .map((hour, index) => ({ hour, index }))
    .filter(({ hour }) => sameCalendarDate(hour.time, date));

  return candidates.reduce(
    (best, candidate) => {
      const distance = Math.abs(candidate.hour.time.getTime() - noon.getTime());
      return distance < best.distance
        ? { index: candidate.index, distance }
        : best;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  ).index;
}

function updateStepMarks(container: HTMLDivElement, hours: WeatherHour[]) {
  container.replaceChildren();

  hours.forEach((hour, index) => {
    const tick = document.createElement("span");
    tick.className = "weather-hour-tick";
    tick.style.left = `${hourPosition(index, hours)}%`;

    if (hour.time.getHours() % 6 === 0) {
      tick.classList.add("is-six-hour");
    }

    if (hour.time.getHours() === 12) {
      tick.classList.add("is-noon");
    }

    container.append(tick);
  });

  const labelDates = Array.from(
    new Map(hours.map((hour) => [dayKey(hour.time), hour.time])).values(),
  );

  labelDates.forEach((date) => {
    const index = closestIndexForDateLabel(hours, date);
    const hour = hours[index];

    const label = document.createElement("div");
    label.className = "weather-day-label";
    label.style.left = `${hourPosition(index, hours)}%`;
    label.innerHTML = `<span>${formatDayName(hour.time)}</span><small>${formatDayDate(hour.time)}</small>`;
    container.append(label);
  });
}

function selectedDateTargetTime(selectedDate: Date) {
  return new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate(),
    12,
    0,
    0,
    0,
  );
}

function closestHourIndex(hours: WeatherHour[], target: Date) {
  return hours.reduce(
    (best, hour, index) => {
      const distance = Math.abs(hour.time.getTime() - target.getTime());
      return distance < best.distance ? { index, distance } : best;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  ).index;
}

function matchingCalendarDateIndex(hours: WeatherHour[], target: Date) {
  const index = hours.findIndex((hour) => sameCalendarDate(hour.time, target));
  return index === -1 ? null : index;
}

function hourIndexFromPointer(
  event: MouseEvent,
  element: HTMLElement,
  hours: WeatherHour[],
) {
  const rect = element.getBoundingClientRect();
  const ratio = Math.min(
    1,
    Math.max(0, (event.clientX - rect.left) / rect.width),
  );
  return Math.round(ratio * (hours.length - 1));
}

function buildRenderableCells(
  dataset: WeatherDataset,
  index: number,
  variableKey: "temperature_2m" | "precipitation" | "snow_depth",
) {
  const selectedCells = buildTemperatureCells(
    dataset,
    dataset.hours[index],
    variableKey,
  );

  if (selectedCells.length > 0) {
    return selectedCells;
  }

  for (let distance = 1; distance < dataset.hours.length; distance += 1) {
    const fallbackIndexes = [index - distance, index + distance].filter(
      (fallbackIndex) =>
        fallbackIndex >= 0 && fallbackIndex < dataset.hours.length,
    );

    for (const fallbackIndex of fallbackIndexes) {
      const fallbackCells = buildTemperatureCells(
        dataset,
        dataset.hours[fallbackIndex],
        variableKey,
      );

      if (fallbackCells.length > 0) {
        return fallbackCells;
      }
    }
  }

  return selectedCells;
}

function renderHour(
  overlay: WeatherOverlay,
  dataset: WeatherDataset,
  index: number,
  variableKey:
    | "temperature_2m"
    | "precipitation"
    | "snow_depth" = "temperature_2m",
) {
  const hour = dataset.hours[index];
  const cells = buildRenderableCells(dataset, index, variableKey);
  const progress = hourPosition(index, dataset.hours);
  overlay.currentCells = cells;
  overlay.timeBubble.textContent = hour.time.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
  overlay.timeBubble.parentElement?.style.setProperty(
    "--weather-progress",
    `${progress}%`,
  );

  overlay.layer
    .selectAll<SVGRectElement, (typeof cells)[number]>("rect.weather-cell")
    .data(cells)
    .join("rect")
    .attr("class", "weather-cell")
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y)
    .attr("width", (d) => d.size)
    .attr("height", (d) => d.size)
    .attr("fill", (d) => temperatureColor(d.temperature))
    .attr("data-temperature", (d) => d.rawValue.toFixed(1))
    .attr("data-temperature-band", (d) => `${temperatureBand(d.temperature)}`)
    .attr("opacity", 1);

  // overlay.status.textContent = `${formatTime.format(hour.time).replace(",", "")} · ${dataset.points.length} samples`;
}

function dispatchSelectedDateChange(
  range: WeatherDateRange,
  selectedDate: Date,
) {
  document.dispatchEvent(
    new CustomEvent<SelectedDateChangeDetail>(SELECTED_DATE_CHANGE_EVENT, {
      detail: {
        from: toDateInputValue(range.from),
        to: toDateInputValue(range.to),
        selected: toDateInputValue(selectedDate),
        source: "weather-timeline",
      },
    }),
  );
}

function dispatchWeatherDatePreview(selectedDate: Date) {
  document.dispatchEvent(
    new CustomEvent(WEATHER_DATE_PREVIEW_EVENT, {
      detail: {
        selected: toDateInputValue(selectedDate),
      },
    }),
  );
}

function bindTooltip(
  layer: d3.Selection<SVGGElement, undefined, null, undefined>,
  overlay: WeatherOverlay,
  getVariableConfig: () => WeatherVariableConfig,
) {
  layer
    .on("mousemove", (event) => {
      const [x, y] = d3.pointer(event, layer.node());
      const cell = overlay.currentCells.find(
        (candidate) =>
          x >= candidate.x &&
          x < candidate.x + candidate.size &&
          y >= candidate.y &&
          y < candidate.y + candidate.size,
      );

      if (
        cell &&
        typeof cell.rawValue === "number" &&
        Number.isFinite(cell.rawValue)
      ) {
        const config = getVariableConfig();
        tooltip
          .style("display", "block")
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY + 10}px`)
          .style("background", COLORS.TOOLTIP.BACKGROUND)
          .text(`${cell.rawValue.toFixed(1)} ${config.unit}`);
      } else {
        tooltip.style("display", "none");
      }
    })
    .on("mouseleave", () => tooltip.style("display", "none"));
}

function stateName(feature: GeoJSON.Feature) {
  return feature.properties?.name || "Unknown";
}

function getChartData(
  dataset: WeatherDataset,
  visibleStationNames: Set<string>,
  focusedState: string | null,
  dailyDelayTrips: { [date: string]: DelayTrip[] } | null
) {
  let activePoints = dataset.points;
  if (focusedState) {
    const stateFeatures = geojson.features.filter(f => stateName(f) === focusedState);
    if (stateFeatures.length > 0) {
      const filtered = dataset.points.filter(p => 
        stateFeatures.some(f => d3.geoContains(f, [p.longitude, p.latitude]))
      );
      if (filtered.length > 0) {
        activePoints = filtered;
      }
    }
  }
  const activeIndices = activePoints.map(p => dataset.points.indexOf(p));

  const formatDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  return dataset.hours.map((hour, dayIndex) => {
    const temps = activeIndices.map(idx => hour.temperature_2m[idx]).filter(Number.isFinite);
    const precips = activeIndices.map(idx => hour.precipitation[idx]).filter(Number.isFinite);
    const snows = activeIndices.map(idx => hour.snow_depth[idx]).filter(Number.isFinite);

    const avgTemp = temps.length > 0 ? d3.mean(temps)! : 0;
    const avgPrecip = precips.length > 0 ? d3.mean(precips)! : 0;
    const avgSnow = snows.length > 0 ? d3.mean(snows)! : 0;

    const dateStr = formatDateKey(hour.time);
    let delaysCount = 0;
    let avgDelayMin = 0;

    if (dailyDelayTrips && dailyDelayTrips[dateStr]) {
      const trips = dailyDelayTrips[dateStr];
      const dailyConnections = aggregateDelayConnections(trips);
      const visibleConnections = dailyConnections.filter(c => 
        visibleStationNames.has(c.source.name) && 
        visibleStationNames.has(c.target.name)
      );

      const delayed = visibleConnections.filter(c => c.delay >= 60);
      delaysCount = delayed.length;
      avgDelayMin = delayed.length > 0 ? d3.mean(delayed, c => c.delay)! / 60 : 0;
    }

    return {
      index: dayIndex,
      time: hour.time,
      temp: avgTemp,
      precip: avgPrecip,
      snow: avgSnow,
      delaysCount,
      avgDelayMin,
    };
  });
}

export async function appendWeatherOverlay(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
): Promise<WeatherOverlayController> {
  const { dropdown, legendTitle, legendTicks } = createLegend();

  let activeVariableKey: "temperature_2m" | "precipitation" | "snow_depth" =
    "temperature_2m";
  updateLegend(legendTitle, legendTicks, WEATHER_VARIABLES[activeVariableKey]);

  const controls = createTimeline();
  
  let currentVisibleStationNames: Set<string> = new Set();
  let currentFocusedState: string | null = null;
  let currentDailyDelayTrips: { [date: string]: DelayTrip[] } | null = null;

  const chartTooltip = d3.select(document.createElement("div"))
    .attr("class", "weather-chart-tooltip")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("display", "none")
    .style("z-index", "1000")
    .style("transform", "translate3d(0,0,0)")
    .style("will-change", "transform, left, top");
  document.body.append(chartTooltip.node()!);

  let activeRange: WeatherDateRange = {
    from: DEFAULT_DATE_RANGE.from,
    to: DEFAULT_DATE_RANGE.to,
    selected: DEFAULT_DATE_RANGE.from,
  };
  let activeDataset: WeatherDataset | null = null;
  let selectedHourIndex: number | null = 0;
  let committedRenderHourIndex = 0;
  let renderedHourIndex = -1;
  let previewHourIndex: number | null = null;
  let loadRequestId = 0;
  const svg = g.node()?.ownerSVGElement;
  const clipId = "weather-germany-clip";

  const updateLegendHTML = (container: HTMLDivElement) => {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 7px; font-size: 11px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #fbbf24;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">temperature_2m_mean</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #3b82f6;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">precipitation_sum</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #ffffff;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">snowfall_sum</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 4px;">
          <span style="display: inline-block; width: 8px; height: 5px; border-radius: 1px; background-color: #818cf8;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">delays_count</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 5px; border-radius: 1px; background-color: #c084fc;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">avg_delay</span>
        </div>
      </div>
    `;
  };

  const drawTimelineChart = () => {
    if (!activeDataset || !controls.chartContainer) {
      return;
    }

    const chartData = getChartData(
      activeDataset,
      currentVisibleStationNames,
      currentFocusedState,
      currentDailyDelayTrips
    );

    const container = controls.chartContainer;
    d3.select(container).html("");

    const rect = container.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 180;

    const margin = { top: 25, right: 90, bottom: 25, left: 105 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    if (innerWidth <= 0 || innerHeight <= 0) {
      return;
    }

    const svgElement = d3.select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .style("display", "block");

    const chartSvg = svgElement.append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // 1. Calculate Nice Y Domains
    const tempExtent = d3.extent(chartData, d => d.temp);
    let tempMin = tempExtent[0] !== undefined ? tempExtent[0] : 12;
    let tempMax = tempExtent[1] !== undefined ? tempExtent[1] : 27;
    if (Math.abs(tempMax - tempMin) < 0.1) {
      tempMin -= 2;
      tempMax += 2;
    }
    const tempScaleNice = d3.scaleLinear().domain([tempMin, tempMax]).nice(5);
    const [niceTempMin, niceTempMax] = tempScaleNice.domain();

    const precipMax = d3.max(chartData, d => d.precip) || 2;
    const nicePrecipMax = d3.scaleLinear().domain([0, precipMax]).nice(5).domain()[1];

    const snowMax = d3.max(chartData, d => d.snow) || 5;
    const niceSnowMax = d3.scaleLinear().domain([0, snowMax]).nice(5).domain()[1];

    const countMax = d3.max(chartData, d => d.delaysCount) || 5;
    const niceCountMax = d3.scaleLinear().domain([0, countMax]).nice(5).domain()[1];

    const delayMinMax = d3.max(chartData, d => d.avgDelayMin) || 5;
    const niceDelayMax = d3.scaleLinear().domain([0, delayMinMax]).nice(5).domain()[1];

    // 2. Define Y Scales
    const yScaleTemp = d3.scaleLinear().domain([niceTempMin, niceTempMax]).range([innerHeight, 0]);
    const yScalePrecip = d3.scaleLinear().domain([0, nicePrecipMax]).range([innerHeight, 0]);
    const yScaleSnow = d3.scaleLinear().domain([0, niceSnowMax]).range([innerHeight, 0]);
    const yScaleCount = d3.scaleLinear().domain([0, niceCountMax]).range([innerHeight, 0]);
    const yScaleDelay = d3.scaleLinear().domain([0, niceDelayMax]).range([innerHeight, 0]);

    // 3. Generate equally spaced tick values for perfect alignment
    const tickIndices = [0, 1, 2, 3, 4, 5];
    const ticksTemp = tickIndices.map(i => niceTempMin + (i * (niceTempMax - niceTempMin)) / 5);
    const ticksPrecip = tickIndices.map(i => 0 + (i * nicePrecipMax) / 5);
    const ticksSnow = tickIndices.map(i => 0 + (i * niceSnowMax) / 5);
    const ticksCount = tickIndices.map(i => 0 + (i * niceCountMax) / 5);
    const ticksDelay = tickIndices.map(i => 0 + (i * niceDelayMax) / 5);

    // 4. Draw Horizontal Grid Lines
    const gridG = chartSvg.append("g").attr("class", "grid-lines");
    tickIndices.forEach(i => {
      const y = (i / 5) * innerHeight;
      gridG.append("line")
        .attr("x1", 0)
        .attr("y1", y)
        .attr("x2", innerWidth)
        .attr("y2", y)
        .attr("stroke", "rgba(255, 255, 255, 0.08)")
        .attr("stroke-width", 1);
    });

    // 5. Draw Y-Axes Columns Left
    const drawLeftAxisColumn = (axisG: any, ticks: number[], scale: any, xOffset: number, labelText: string, formatFn: (v: number) => string) => {
      const colG = axisG.append("g").attr("transform", `translate(${xOffset}, 0)`);
      
      colG.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -20)
        .attr("x", -innerHeight / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "rgba(255, 255, 255, 0.4)")
        .style("font-size", "10px")
        .style("font-weight", "600")
        .text(labelText);

      ticks.forEach(val => {
        colG.append("text")
          .attr("x", 0)
          .attr("y", scale(val))
          .attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("fill", "rgba(255, 255, 255, 0.6)")
          .style("font-size", "10px")
          .text(formatFn(val));
      });
    };

    const formatVal = (v: number) => {
      if (v === 0) return "0";
      return v % 1 === 0 ? `${v}` : v.toFixed(1);
    };

    const leftAxesG = chartSvg.append("g").attr("class", "y-axes-left");
    drawLeftAxisColumn(leftAxesG, ticksSnow, yScaleSnow, -80, "cm", formatVal);
    drawLeftAxisColumn(leftAxesG, ticksPrecip, yScalePrecip, -45, "mm", formatVal);
    drawLeftAxisColumn(leftAxesG, ticksTemp, yScaleTemp, -10, "°C", formatVal);

    // 6. Draw Y-Axes Columns Right
    const drawRightAxisColumn = (axisG: any, ticks: number[], scale: any, xOffset: number, labelText: string, formatFn: (v: number) => string) => {
      const colG = axisG.append("g").attr("transform", `translate(${xOffset}, 0)`);
      
      colG.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 30)
        .attr("x", -innerHeight / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "rgba(255, 255, 255, 0.4)")
        .style("font-size", "10px")
        .style("font-weight", "600")
        .text(labelText);

      ticks.forEach(val => {
        colG.append("text")
          .attr("x", 15)
          .attr("y", scale(val))
          .attr("dy", "0.35em")
          .attr("text-anchor", "start")
          .attr("fill", "rgba(255, 255, 255, 0.6)")
          .style("font-size", "10px")
          .text(formatFn(val));
      });
    };

    const rightAxesG = chartSvg.append("g").attr("class", "y-axes-right");
    drawRightAxisColumn(rightAxesG, ticksCount, yScaleCount, innerWidth + 10, "count", formatVal);
    drawRightAxisColumn(rightAxesG, ticksDelay, yScaleDelay, innerWidth + 45, "min", formatVal);

    // 7. Define X Scale
    const xScale = d3.scaleTime()
      .domain([d3.min(chartData, d => d.time)!, d3.max(chartData, d => d.time)!])
      .range([0, innerWidth]);

    // 8. Draw X Axis
    const showYear = d3.min(chartData, x => x.time.getFullYear()) !== d3.max(chartData, x => x.time.getFullYear());
    const xAxis = d3.axisBottom(xScale)
      .ticks(chartData.length)
      .tickFormat((d) => {
        const date = d as Date;
        const day = `${date.getDate()}`.padStart(2, "0");
        const month = `${date.getMonth() + 1}`.padStart(2, "0");
        if (showYear) {
          const year = `${date.getFullYear()}`.slice(-2);
          return `${day}.${month}.${year}`;
        }
        return `${day}.${month}.`;
      });

    chartSvg.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0, ${innerHeight})`)
      .call(xAxis)
      .call(g => g.select(".domain").attr("stroke", "rgba(255, 255, 255, 0.15)"))
      .call(g => g.selectAll(".tick line").attr("stroke", "rgba(255, 255, 255, 0.15)"))
      .call(g => g.selectAll(".tick text")
        .attr("fill", "rgba(255, 255, 255, 0.6)")
        .style("font-size", "10px")
      );

    // 9. Draw Delay Bars (Grouped)
    const barWidth = Math.max(3, (innerWidth / chartData.length) * 0.18);
    const barG = chartSvg.append("g").attr("class", "delays-bars");
    chartData.forEach((d, dayIndex) => {
      // Delays Count Bar (left)
      if (d.delaysCount > 0) {
        barG.append("rect")
          .attr("class", `delay-bar day-${dayIndex}`)
          .attr("x", xScale(d.time) - barWidth)
          .attr("y", yScaleCount(d.delaysCount))
          .attr("width", barWidth - 1)
          .attr("height", Math.max(0, innerHeight - yScaleCount(d.delaysCount)))
          .attr("fill", "#818cf8")
          .attr("rx", 1)
          .attr("opacity", 0.7);
      }
      
      // Avg Delay Bar (right)
      if (d.avgDelayMin > 0) {
        barG.append("rect")
          .attr("class", `delay-bar day-${dayIndex}`)
          .attr("x", xScale(d.time))
          .attr("y", yScaleDelay(d.avgDelayMin))
          .attr("width", barWidth - 1)
          .attr("height", Math.max(0, innerHeight - yScaleDelay(d.avgDelayMin)))
          .attr("fill", "#c084fc")
          .attr("rx", 1)
          .attr("opacity", 0.7);
      }
    });

    // 10. Draw Weather Lines
    const lineTemp = d3.line<any>().x(d => xScale(d.time)).y(d => yScaleTemp(d.temp));
    const linePrecip = d3.line<any>().x(d => xScale(d.time)).y(d => yScalePrecip(d.precip));
    const lineSnow = d3.line<any>().x(d => xScale(d.time)).y(d => yScaleSnow(d.snow));

    const linesG = chartSvg.append("g").attr("class", "weather-lines");
    
    // Precipitation (Blue)
    linesG.append("path")
      .datum(chartData)
      .attr("fill", "none")
      .attr("stroke", "#3b82f6")
      .attr("stroke-width", 1.8)
      .attr("d", linePrecip);

    // Snowfall (White)
    linesG.append("path")
      .datum(chartData)
      .attr("fill", "none")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1.8)
      .attr("d", lineSnow);

    // Temperature (Yellow)
    linesG.append("path")
      .datum(chartData)
      .attr("fill", "none")
      .attr("stroke", "#fbbf24")
      .attr("stroke-width", 1.8)
      .attr("d", lineTemp);

    // 11. Draw Data Points (Circles)
    const pointsG = chartSvg.append("g").attr("class", "weather-points");
    chartData.forEach(d => {
      pointsG.append("circle").attr("cx", xScale(d.time)).attr("cy", yScalePrecip(d.precip)).attr("r", 3.2).attr("fill", "#3b82f6");
      pointsG.append("circle").attr("cx", xScale(d.time)).attr("cy", yScaleSnow(d.snow)).attr("r", 3.2).attr("fill", "#ffffff");
      pointsG.append("circle").attr("cx", xScale(d.time)).attr("cy", yScaleTemp(d.temp)).attr("r", 3.2).attr("fill", "#fbbf24");
    });

    // 12. Selection Line (orange)
    const selectedLine = chartSvg.append("line")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("stroke", "#ff7a16")
      .attr("stroke-width", 2)
      .style("display", "none")
      .attr("pointer-events", "none");

    if (
      selectedHourIndex !== null &&
      selectedHourIndex >= 0 &&
      selectedHourIndex < chartData.length
    ) {
      const selX = xScale(chartData[selectedHourIndex].time);
      selectedLine.attr("x1", selX).attr("x2", selX).style("display", "block");
    }

    // 13. Hover Elements
    const hoverLine = chartSvg.append("line")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("stroke", "rgba(255, 255, 255, 0.5)")
      .attr("stroke-width", 1.2)
      .style("display", "none")
      .attr("pointer-events", "none");

    const hoverCirclesG = chartSvg.append("g").style("display", "none").attr("pointer-events", "none");
    const hCircleTemp = hoverCirclesG.append("circle").attr("r", 5.5).attr("fill", "#fbbf24").attr("stroke", "#1e293b").attr("stroke-width", 1.5);
    const hCirclePrecip = hoverCirclesG.append("circle").attr("r", 5.5).attr("fill", "#3b82f6").attr("stroke", "#1e293b").attr("stroke-width", 1.5);
    const hCircleSnow = hoverCirclesG.append("circle").attr("r", 5.5).attr("fill", "#ffffff").attr("stroke", "#1e293b").attr("stroke-width", 1.5);

    // 14. Hover Interactive Overlay Rect
    const hoverRect = chartSvg.append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .attr("pointer-events", "all")
      .style("cursor", "pointer");

    let currentHoverIndex: number | null = null;

    const showChartTooltip = (event: MouseEvent, d: any) => {
      const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      
      const dayName = weekdayNames[d.time.getDay()];
      const dateStr = `${d.time.getDate()} ${monthNames[d.time.getMonth()]} ${d.time.getFullYear()}`;
      
      const chartNode = svgElement.node();
      const containerRect = chartNode ? chartNode.getBoundingClientRect() : { left: 0, top: 0 };
      const chartX = xScale(d.time) + margin.left;
      const tooltipX = containerRect.left + window.scrollX + chartX;
      const tooltipY = containerRect.top + window.scrollY - 10;
      
      chartTooltip
        .html(`
          <div style="font-weight: 700; color: rgba(255,255,255,0.7); margin-bottom: 5px;">${dayName}, ${dateStr}</div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #fbbf24;"></span>
            <span>temperature_2m_mean: <strong>${d.temp.toFixed(1)} °C</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #3b82f6;"></span>
            <span>precipitation_sum: <strong>${d.precip.toFixed(1)} mm</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #ffffff;"></span>
            <span>snowfall_sum: <strong>${d.snow.toFixed(1)} cm</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 5px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 5px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #818cf8;"></span>
            <span>delays_count: <strong>${d.delaysCount}</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #c084fc;"></span>
            <span>avg_delay: <strong>${d.avgDelayMin.toFixed(1)} min</strong></span>
          </div>
        `)
        .style("display", "block")
        .style("left", `${tooltipX}px`)
        .style("top", `${tooltipY}px`)
        .style("transform", "translate(-50%, -100%)");
    };

    hoverRect
      .on("mousemove", function (event) {
        const [mouseX, mouseY] = d3.pointer(event, this);
        
        let closestIndex = 0;
        let minDistance = Number.POSITIVE_INFINITY;
        chartData.forEach((d, i) => {
          const distance = Math.abs(xScale(d.time) - mouseX);
          if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
          }
        });

        if (closestIndex === currentHoverIndex) {
          return;
        }
        currentHoverIndex = closestIndex;

        const d = chartData[closestIndex];
        const x = xScale(d.time);

        hoverLine.attr("x1", x).attr("x2", x).style("display", "block");
        
        if (Number.isFinite(d.temp)) {
          hCircleTemp.attr("cx", x).attr("cy", yScaleTemp(d.temp)).style("display", null);
        } else {
          hCircleTemp.style("display", "none");
        }
        
        if (Number.isFinite(d.precip)) {
          hCirclePrecip.attr("cx", x).attr("cy", yScalePrecip(d.precip)).style("display", null);
        } else {
          hCirclePrecip.style("display", "none");
        }
        
        if (Number.isFinite(d.snow)) {
          hCircleSnow.attr("cx", x).attr("cy", yScaleSnow(d.snow)).style("display", null);
        } else {
          hCircleSnow.style("display", "none");
        }
        
        hoverCirclesG.style("display", "block");

        // Highlight corresponding bars, dim others
        chartSvg.selectAll(".delay-bar").attr("opacity", 0.2);
        chartSvg.selectAll(`.day-${closestIndex}`).attr("opacity", 1.0);

        showChartTooltip(event, d);
        previewHour(closestIndex);
      })
      .on("mouseleave", () => {
        currentHoverIndex = null;
        hoverLine.style("display", "none");
        hoverCirclesG.style("display", "none");
        chartTooltip.style("display", "none");
        
        // Restore default bar opacities
        chartSvg.selectAll(".delay-bar").attr("opacity", 0.7);
        
        restoreSelectedHour();
      })
      .on("click", function (event) {
        const [mouseX] = d3.pointer(event, this);
        let closestIndex = 0;
        let minDistance = Number.POSITIVE_INFINITY;
        chartData.forEach((d, i) => {
          const distance = Math.abs(xScale(d.time) - mouseX);
          if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
          }
        });

        commitHour(closestIndex);
        const selX = xScale(chartData[closestIndex].time);
        selectedLine.attr("x1", selX).attr("x2", selX).style("display", "block");
      });

    if (controls.legendContainer) {
      updateLegendHTML(controls.legendContainer);
    }
  };

  window.addEventListener("resize", drawTimelineChart);

  dropdown.addEventListener("change", (event: Event) => {
    const customEvent = event as CustomEvent<{
      value: "temperature_2m" | "precipitation" | "snow_depth";
    }>;
    const val = customEvent.detail.value;
    if (WEATHER_VARIABLES[val]) {
      activeVariableKey = val;
      const config = WEATHER_VARIABLES[activeVariableKey];
      updateLegend(legendTitle, legendTicks, config);

      if (activeDataset && renderedHourIndex !== -1) {
        renderHour(
          overlay,
          activeDataset,
          renderedHourIndex,
          activeVariableKey,
        );
      }
    }
  });

  if (svg) {
    d3.select(svg)
      .append("defs")
      .append("clipPath")
      .attr("id", clipId)
      .append("path")
      .datum(geojson)
      .attr("d", d3.geoPath(projection));
  }

  const layer = g
    .append("g")
    .attr("class", "weather-overlay-layer")
    .attr("aria-label", "Hourly temperature overlay")
    .attr("clip-path", `url(#${clipId})`);

  layer
    .append("rect")
    .attr("width", WIDTH)
    .attr("height", HEIGHT)
    .attr("fill", "transparent")
    .attr("pointer-events", "all");

  const overlay: WeatherOverlay = { layer, currentCells: [], ...controls };

  g.append("path")
    .attr("class", "weather-boundary-layer")
    .datum(geojson)
    .attr("d", d3.geoPath(projection))
    .attr("fill", "none")
    .attr("stroke", "rgba(255, 255, 255, 0.58)")
    .attr("stroke-width", 0.8)
    .attr("pointer-events", "none");

  const showWeatherError = (error: unknown) => {
    controls.status.textContent =
      error instanceof Error ? error.message : "Could not load weather";

    layer
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", WIDTH)
      .attr("height", HEIGHT)
      .attr("fill", "rgba(15, 25, 21, 0.18)");
  };

  const loadAndRender = async (range: WeatherDateRange) => {
    const requestId = (loadRequestId += 1);
    controls.slider.disabled = true;
    controls.status.textContent = "Fetching Open-Meteo";

    const dataset = await loadHistoricalTemperatures(range);

    if (requestId !== loadRequestId) {
      return;
    }

    if (dataset.hours.length === 0) {
      throw new Error("No historic hourly temperatures returned");
    }

    controls.slider.disabled = false;
    controls.slider.max = `${dataset.hours.length - 1}`;
    activeDataset = dataset;
    selectedHourIndex = matchingCalendarDateIndex(
      dataset.hours,
      dataset.selectedDate,
    );
    committedRenderHourIndex =
      selectedHourIndex ??
      closestHourIndex(dataset.hours, selectedDateTargetTime(dataset.fromDate));
    previewHourIndex = null;
    renderedHourIndex = -1;
    controls.slider.value = `${committedRenderHourIndex}`;
    updateStepMarks(controls.stepMarks, dataset.hours);

    renderHour(overlay, dataset, committedRenderHourIndex, activeVariableKey);
    renderedHourIndex = committedRenderHourIndex;

    drawTimelineChart();
  };

  bindTooltip(layer, overlay, () => WEATHER_VARIABLES[activeVariableKey]);

  const previewHour = (index: number) => {
    if (!activeDataset || index === renderedHourIndex) {
      return;
    }

    previewHourIndex = index;
    controls.slider.value = `${index}`;
    renderHour(overlay, activeDataset, index, activeVariableKey);
    renderedHourIndex = index;
    dispatchWeatherDatePreview(activeDataset.hours[index].time);
  };

  const commitHour = (index: number) => {
    if (!activeDataset) {
      return;
    }

    const hour = activeDataset.hours[index];
    const selectedDayChanged =
      !activeRange.selected ||
      !sameCalendarDate(activeRange.selected, hour.time);
    selectedHourIndex = index;
    committedRenderHourIndex = index;
    activeRange = { ...activeRange, selected: hour.time };
    previewHourIndex = null;
    controls.slider.value = `${index}`;
    renderHour(overlay, activeDataset, index, activeVariableKey);
    renderedHourIndex = index;

    if (selectedDayChanged) {
      dispatchSelectedDateChange(activeRange, hour.time);
    }

    drawTimelineChart();
  };

  const restoreSelectedHour = () => {
    if (!activeDataset || previewHourIndex === null) {
      return;
    }

    previewHourIndex = null;
    const restoreIndex = selectedHourIndex ?? committedRenderHourIndex;
    controls.slider.value = `${restoreIndex}`;
    renderHour(overlay, activeDataset, restoreIndex, activeVariableKey);
    renderedHourIndex = restoreIndex;
    dispatchWeatherDatePreview(activeDataset.hours[restoreIndex].time);

    drawTimelineChart();
  };

  const previewFromPointer = (event: MouseEvent) => {
    if (!activeDataset || controls.slider.disabled) {
      return;
    }

    previewHour(
      hourIndexFromPointer(event, controls.stepMarks, activeDataset.hours),
    );
  };

  const restoreWhenPointerLeavesRuler = (event: MouseEvent) => {
    if (previewHourIndex === null) {
      return;
    }

    const rect = controls.sliderWrap.getBoundingClientRect();
    const isInsideSlider =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    const chartRect = controls.chartContainer.getBoundingClientRect();
    const isInsideChart =
      event.clientX >= chartRect.left &&
      event.clientX <= chartRect.right &&
      event.clientY >= chartRect.top &&
      event.clientY <= chartRect.bottom;

    if (!isInsideSlider && !isInsideChart) {
      restoreSelectedHour();
    }
  };

  controls.sliderWrap.addEventListener("mousemove", previewFromPointer);
  controls.sliderWrap.addEventListener("click", (event) => {
    if (!activeDataset) {
      return;
    }

    commitHour(
      hourIndexFromPointer(event, controls.stepMarks, activeDataset.hours),
    );
  });
  controls.slider.addEventListener("input", () => {
    previewHour(Number(controls.slider.value));
  });
  controls.slider.addEventListener("change", () => {
    commitHour(Number(controls.slider.value));
  });
  controls.sliderWrap.addEventListener("mouseleave", restoreSelectedHour);
  document.addEventListener("mousemove", restoreWhenPointerLeavesRuler);
  document.addEventListener(SELECTED_DATE_CHANGE_EVENT, ((event: Event) => {
    const { from, to, selected, source } = (
      event as CustomEvent<SelectedDateChangeDetail>
    ).detail;

    if (source === "weather-timeline") {
      return;
    }

    const nextRange = {
      from: new Date(`${from}T00:00:00`),
      to: new Date(`${to}T00:00:00`),
      selected: new Date(`${selected}T12:00:00`),
    };

    if (
      Number.isNaN(nextRange.from.getTime()) ||
      Number.isNaN(nextRange.to.getTime()) ||
      Number.isNaN(nextRange.selected.getTime())
    ) {
      return;
    }

    activeRange = nextRange;
    void loadAndRender(nextRange).catch((error) => {
      if (
        sameCalendarDate(activeRange.from, nextRange.from) &&
        sameCalendarDate(activeRange.to, nextRange.to)
      ) {
        showWeatherError(error);
      }
    });
  }) as EventListener);

  try {
    await loadAndRender(activeRange);
  } catch (error) {
    showWeatherError(error);
  }

  return {
    showTooltipAtPoint: (event, [x, y]) => {
      const cell = overlay.currentCells.find(
        (candidate) =>
          x >= candidate.x &&
          x < candidate.x + candidate.size &&
          y >= candidate.y &&
          y < candidate.y + candidate.size,
      );

      if (
        !cell ||
        typeof cell.rawValue !== "number" ||
        !Number.isFinite(cell.rawValue)
      ) {
        tooltip.style("display", "none");
        return false;
      }

      const config = WEATHER_VARIABLES[activeVariableKey];
      tooltip
        .style("display", "block")
        .style("left", `${event.pageX + 10}px`)
        .style("top", `${event.pageY + 10}px`)
        .style("background", COLORS.TOOLTIP.BACKGROUND)
        .text(`${cell.rawValue.toFixed(1)} ${config.unit}`);

      return true;
    },
    hideTooltip: () => tooltip.style("display", "none"),
    updateData: (visibleStationNames, focusedState, dailyDelayTrips) => {
      currentVisibleStationNames = visibleStationNames;
      currentFocusedState = focusedState;
      if (dailyDelayTrips !== null) {
        currentDailyDelayTrips = dailyDelayTrips;
      }
      drawTimelineChart();
    }
  };
}
