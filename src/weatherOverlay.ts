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
  interpolateWeatherValueAtCoordinate,
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
import {
  aggregateDelayConnections,
  buildStationDelayImpactStats,
} from "./data/bahn";
import type { DelayDirection, DelayTrip, Station } from "./data/bahn";

type WeatherOverlay = {
  layer: d3.Selection<SVGGElement, undefined, null, undefined>;
  timeline: HTMLDivElement;
  slider: HTMLInputElement;
  sliderWrap: HTMLDivElement;
  stepMarks: HTMLDivElement;
  timeBubble: HTMLDivElement;
  currentCells: TemperatureCell[];
  chartContainer?: HTMLDivElement;
  legendContainer?: HTMLDivElement;
  impactPanel: HTMLDivElement;
  impactScatterContainer: HTMLDivElement;
};

type WeatherVariableKey = "temperature_2m" | "precipitation" | "snow_depth";
type WeatherImpactMode = "none" | "weather-impact";

export type WeatherOverlayController = {
  showTooltipAtPoint: (event: MouseEvent, point: [number, number]) => boolean;
  hideTooltip: () => void;
  setHoveredStation: (stationEva: number | null) => void;
  updateData: (
    visibleStations: Station[],
    focusedState: string | null,
    dailyDelayTrips: { [date: string]: DelayTrip[] } | null,
  ) => void;
};

type WeatherOverlayOptions = {
  beginLoadingTask?: (message: string) => () => void;
  onStationHoverChange?: (stationEva: number | null) => void;
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

type DropdownOption<T extends string> = {
  value: T;
  label: string;
};

function createDropdown<T extends string>(
  options: DropdownOption<T>[],
  selectedValue: T,
) {
  const dropdownContainer = document.createElement("div");
  dropdownContainer.className = "weather-dropdown-container";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "weather-dropdown-trigger";
  trigger.textContent =
    options.find((option) => option.value === selectedValue)?.label ??
    options[0]?.label ??
    "";

  const menu = document.createElement("ul");
  menu.className = "weather-dropdown-menu";

  options.forEach((option) => {
    const item = document.createElement("li");
    item.className = "weather-dropdown-item";
    item.textContent = option.label;
    item.setAttribute("data-value", option.value);
    if (option.value === selectedValue) {
      item.classList.add("is-selected");
    }
    menu.append(item);
  });

  dropdownContainer.append(trigger, menu);

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    dropdownContainer.classList.toggle("is-open");
  });

  document.addEventListener("click", () => {
    dropdownContainer.classList.remove("is-open");
  });

  menu.querySelectorAll(".weather-dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      const value = item.getAttribute("data-value") as T | null;

      if (!value) {
        return;
      }

      menu.querySelectorAll(".weather-dropdown-item").forEach((el) => {
        el.classList.remove("is-selected");
      });
      item.classList.add("is-selected");
      trigger.textContent = item.textContent;
      dropdownContainer.classList.remove("is-open");

      dropdownContainer.dispatchEvent(
        new CustomEvent("change", {
          detail: { value },
        }),
      );
    });
  });

  return { dropdown: dropdownContainer, trigger };
}

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

  const impactModeDropdown = createDropdown<WeatherImpactMode>(
    [
      { value: "none", label: "none" },
      { value: "weather-impact", label: "weather impact" },
    ],
    "none",
  );
  impactModeDropdown.dropdown.classList.add("weather-impact-mode-dropdown");

  const impactPanel = document.createElement("div");
  impactPanel.className = "weather-impact-panel";
  impactPanel.hidden = true;

  const impactControls = document.createElement("div");
  impactControls.className = "weather-impact-controls";

  const directionDropdown = createDropdown<DelayDirection>(
    [
      { value: "both", label: "both" },
      { value: "incoming", label: "incoming" },
      { value: "outgoing", label: "outgoing" },
    ],
    "both",
  );
  directionDropdown.dropdown.classList.add("weather-impact-direction-dropdown");

  const aggregateLabel = document.createElement("label");
  aggregateLabel.className = "weather-impact-checkbox";
  const aggregateCheckbox = document.createElement("input");
  aggregateCheckbox.type = "checkbox";
  aggregateCheckbox.className = "weather-impact-aggregate";
  const aggregateText = document.createElement("span");
  aggregateText.textContent = "aggregate";
  aggregateLabel.append(aggregateCheckbox, aggregateText);

  impactControls.append(directionDropdown.dropdown, aggregateLabel);

  const scatterContainer = document.createElement("div");
  scatterContainer.className = "weather-impact-scatter";
  scatterContainer.setAttribute("aria-label", "Weather impact scatter plot");

  impactPanel.append(impactControls, scatterContainer);
  panel.append(
    dropdownContainer,
    legend,
    impactModeDropdown.dropdown,
    impactPanel,
  );
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

  return {
    dropdown: dropdownContainer,
    legendTitle,
    legendTicks,
    impactModeDropdown: impactModeDropdown.dropdown,
    directionDropdown: directionDropdown.dropdown,
    aggregateCheckbox,
    impactPanel,
    scatterContainer,
  };
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

  const containerBody = document.createElement("div");
  containerBody.className = "weather-timeline-body";

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
  timeline.append(containerBody);
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

  return {
    timeline,
    slider,
    sliderWrap,
    stepMarks,
    timeBubble,
    chartContainer,
    legendContainer,
  };
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

function dispatchWeatherDatePreview(selectedDate: Date | null) {
  document.dispatchEvent(
    new CustomEvent(WEATHER_DATE_PREVIEW_EVENT, {
      detail: {
        selected: selectedDate ? toDateInputValue(selectedDate) : null,
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
  dailyDelayTrips: { [date: string]: DelayTrip[] } | null,
) {
  let activePoints = dataset.points;
  if (focusedState) {
    const stateFeatures = geojson.features.filter(
      (f) => stateName(f) === focusedState,
    );
    if (stateFeatures.length > 0) {
      const filtered = dataset.points.filter((p) =>
        stateFeatures.some((f) => d3.geoContains(f, [p.longitude, p.latitude])),
      );
      if (filtered.length > 0) {
        activePoints = filtered;
      }
    }
  }
  const activeIndices = activePoints.map((p) => dataset.points.indexOf(p));

  const formatDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  return dataset.hours.map((hour, dayIndex) => {
    const temps = activeIndices
      .map((idx) => hour.temperature_2m[idx])
      .filter(Number.isFinite);
    const precips = activeIndices
      .map((idx) => hour.precipitation[idx])
      .filter(Number.isFinite);
    const snows = activeIndices
      .map((idx) => hour.snow_depth[idx])
      .filter(Number.isFinite);

    const avgTemp = temps.length > 0 ? d3.mean(temps)! : 0;
    const avgPrecip = precips.length > 0 ? d3.mean(precips)! : 0;
    const avgSnow = snows.length > 0 ? d3.mean(snows)! : 0;

    const dateStr = formatDateKey(hour.time);
    let delaysCount = 0;
    let avgDelayMin = 0;

    if (dailyDelayTrips && dailyDelayTrips[dateStr]) {
      const trips = dailyDelayTrips[dateStr];
      const dailyConnections = aggregateDelayConnections(trips);
      const visibleConnections = dailyConnections.filter(
        (c) =>
          visibleStationNames.has(c.source.name) &&
          visibleStationNames.has(c.target.name),
      );

      delaysCount = d3.sum(visibleConnections, (c) => c.delayCount);
      avgDelayMin =
        delaysCount > 0
          ? d3.sum(visibleConnections, (c) => c.delay * c.delayCount) /
            delaysCount /
            60
          : 0;
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

type WeatherChartDatum = ReturnType<typeof getChartData>[number];
type TimeDomain = [Date, Date];

const TIMELINE_AXIS_PLOT_GAP = 14;
const TIMELINE_AXIS_COLUMN_WIDTH = 48;
const TIMELINE_AXIS_COLUMN_GAP = 4;
const TIMELINE_AXIS_COLUMN_STEP =
  TIMELINE_AXIS_COLUMN_WIDTH + TIMELINE_AXIS_COLUMN_GAP;
const DAY_MS = 24 * 60 * 60 * 1000;

function paddedTimelineDomain(chartData: WeatherChartDatum[]): TimeDomain {
  const times = chartData
    .map((d) => d.time.getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (times.length === 0) {
    const now = new Date();
    return [
      new Date(now.getTime() - DAY_MS / 2),
      new Date(now.getTime() + DAY_MS / 2),
    ];
  }

  const first = times[0];
  const last = times[times.length - 1];
  let minStep = Number.POSITIVE_INFINITY;

  for (let i = 1; i < times.length; i += 1) {
    const step = times[i] - times[i - 1];
    if (step > 0 && step < minStep) {
      minStep = step;
    }
  }

  const padding = (Number.isFinite(minStep) ? minStep : DAY_MS) / 2;
  return [new Date(first - padding), new Date(last + padding)];
}

function clampVisibleTimeDomain(
  visibleDomain: TimeDomain | null,
  fullDomain: TimeDomain,
): TimeDomain {
  if (!visibleDomain) {
    return fullDomain;
  }

  const fullStart = fullDomain[0].getTime();
  const fullEnd = fullDomain[1].getTime();
  const fullDuration = fullEnd - fullStart;

  if (fullDuration <= 0) {
    return fullDomain;
  }

  const requestedDuration =
    visibleDomain[1].getTime() - visibleDomain[0].getTime();
  const duration = Math.max(1, Math.min(fullDuration, requestedDuration));
  const minStart = fullStart;
  const maxStart = fullEnd - duration;
  const start = Math.max(
    minStart,
    Math.min(maxStart, visibleDomain[0].getTime()),
  );

  return [new Date(start), new Date(start + duration)];
}

function zoomTransformForTimeDomain(
  baseXScale: d3.ScaleTime<number, number>,
  visibleDomain: TimeDomain,
): d3.ZoomTransform {
  const [fullStart, fullEnd] = baseXScale
    .domain()
    .map((date) => date.getTime());
  const visibleDuration =
    visibleDomain[1].getTime() - visibleDomain[0].getTime();
  const fullDuration = fullEnd - fullStart;

  if (fullDuration <= 0 || visibleDuration <= 0) {
    return d3.zoomIdentity;
  }

  const k = fullDuration / visibleDuration;
  return d3.zoomIdentity
    .translate(-baseXScale(visibleDomain[0]) * k, 0)
    .scale(k);
}

function timelineTickValues(
  chartData: WeatherChartDatum[],
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number,
) {
  const ticksByDay = new Map<string, Date>();

  chartData.forEach((d) => {
    const x = xScale(d.time);

    if (x >= 0 && x <= innerWidth) {
      ticksByDay.set(dayKey(d.time), d.time);
    }
  });

  const ticks = Array.from(ticksByDay.values()).sort(
    (a, b) => a.getTime() - b.getTime(),
  );

  if (ticks.length <= 1) {
    return ticks;
  }

  const minLabelSpacing = 82;
  const step = Math.max(
    1,
    Math.ceil((ticks.length * minLabelSpacing) / innerWidth),
  );

  if (step === 1) {
    return ticks;
  }

  return ticks.filter(
    (_, index) => index % step === 0 || index === ticks.length - 1,
  );
}

function formatTimelineTick(date: Date) {
  return d3.timeFormat("%a %d.%m.")(date);
}

export async function appendWeatherOverlay(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
  options: WeatherOverlayOptions = {},
): Promise<WeatherOverlayController> {
  const {
    dropdown,
    legendTitle,
    legendTicks,
    impactModeDropdown,
    directionDropdown,
    aggregateCheckbox,
    impactPanel,
    scatterContainer,
  } = createLegend();

  let activeVariableKey: WeatherVariableKey = "temperature_2m";
  let impactMode: WeatherImpactMode = "none";
  let impactDirection: DelayDirection = "both";
  let impactAggregate = false;
  let highlightedImpactStationEva: number | null = null;
  updateLegend(legendTitle, legendTicks, WEATHER_VARIABLES[activeVariableKey]);

  const controls = createTimeline();
  const stationFilter = document.getElementById("station-filter");
  const stationFilterTimelineGap = 10;

  const syncStationFilterHeight = () => {
    if (!stationFilter) {
      return;
    }

    const timelineTop = controls.timeline.getBoundingClientRect().top;
    const height = Math.max(
      0,
      Math.floor(timelineTop - stationFilterTimelineGap),
    );
    document.documentElement.style.setProperty(
      "--station-filter-height",
      `${height}px`,
    );
  };

  window.requestAnimationFrame(syncStationFilterHeight);

  if (typeof ResizeObserver !== "undefined") {
    const timelineResizeObserver = new ResizeObserver(() => {
      syncStationFilterHeight();
    });
    timelineResizeObserver.observe(controls.timeline);
  }

  let currentVisibleStations: Station[] = [];
  let currentVisibleStationNames: Set<string> = new Set();
  let currentFocusedState: string | null = null;
  let currentDailyDelayTrips: { [date: string]: DelayTrip[] } | null = null;

  const chartTooltip = d3
    .select(document.createElement("div"))
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
  const timelineClipId = "weather-timeline-clip";
  let visibleTimelineDomain: TimeDomain | null = null;
  let timelineZoomTransform = d3.zoomIdentity;

  const updateLegendHTML = (container: HTMLDivElement) => {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 7px; font-size: 11px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #fbbf24;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">temperature</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #3b82f6;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">precipitation</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #ffffff;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">snowfall</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 4px;">
          <span style="display: inline-block; width: 8px; height: 5px; border-radius: 1px; background-color: #818cf8;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">delay count</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 5px; border-radius: 1px; background-color: #c084fc;"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">avg delay</span>
        </div>
      </div>
    `;
  };

  type WeatherImpactDatum = {
    station: Station;
    weatherValue: number;
    avgDelayMin: number;
    delayCount: number;
  };

  const stationWeatherValue = (
    station: Station,
    hours: WeatherHour[],
    dataset: WeatherDataset,
  ) => {
    const values = hours
      .map((hour) =>
        interpolateWeatherValueAtCoordinate(
          dataset,
          hour,
          activeVariableKey,
          station.coords,
        ),
      )
      .filter(Number.isFinite);

    return values.length > 0 ? d3.mean(values)! : Number.NaN;
  };

  const weatherImpactHours = () => {
    if (!activeDataset) {
      return [];
    }

    if (impactAggregate) {
      return activeDataset.hours;
    }

    const index =
      previewHourIndex ?? selectedHourIndex ?? committedRenderHourIndex ?? 0;

    return activeDataset.hours[index] ? [activeDataset.hours[index]] : [];
  };

  const weatherImpactTrips = (hours: WeatherHour[]) => {
    if (!currentDailyDelayTrips) {
      return [];
    }

    if (impactAggregate) {
      return Object.values(currentDailyDelayTrips).flat();
    }

    const date = hours[0] ? dayKey(hours[0].time) : null;

    return date ? (currentDailyDelayTrips[date] ?? []) : [];
  };

  const getWeatherImpactData = (): WeatherImpactDatum[] => {
    if (!activeDataset || currentVisibleStations.length === 0) {
      return [];
    }

    const dataset = activeDataset;
    const hours = weatherImpactHours();
    const trips = weatherImpactTrips(hours);

    if (hours.length === 0 || trips.length === 0) {
      return [];
    }

    const stationStats = buildStationDelayImpactStats(
      trips,
      currentVisibleStations,
      impactDirection,
    );

    return currentVisibleStations
      .map((station) => {
        const stats = stationStats.get(station.eva);
        const weatherValue = stationWeatherValue(station, hours, dataset);

        if (!stats || stats.delayCount <= 0 || !Number.isFinite(weatherValue)) {
          return null;
        }

        return {
          station,
          weatherValue,
          avgDelayMin: stats.weightedDelay / stats.delayCount / 60,
          delayCount: stats.delayCount,
        };
      })
      .filter((datum): datum is WeatherImpactDatum => datum !== null);
  };

  const setImpactMode = (mode: WeatherImpactMode) => {
    impactMode = mode;
    const isActive = impactMode === "weather-impact";
    impactPanel.hidden = !isActive;
    document.body.classList.toggle("weather-impact-active", isActive);
    options.onStationHoverChange?.(null);
    drawImpactScatter();
  };

  const showImpactTooltip = (event: MouseEvent, datum: WeatherImpactDatum) => {
    const stationLine = document.createElement("div");
    stationLine.textContent = datum.station.name;

    const delayLine = document.createElement("div");
    delayLine.textContent = `avg delay: ${datum.avgDelayMin.toFixed(1)} min`;

    const delayCountLine = document.createElement("div");
    delayCountLine.textContent = `delay count: ${datum.delayCount.toLocaleString("de-DE")}`;

    tooltip.node()?.replaceChildren(stationLine, delayLine, delayCountLine);
    tooltip
      .style("display", "block")
      .style("left", `${event.pageX + 10}px`)
      .style("top", `${event.pageY + 10}px`)
      .style("background", COLORS.TOOLTIP.BACKGROUND);
  };

  const setImpactScatterHighlight = (stationEva: number | null) => {
    highlightedImpactStationEva = stationEva;

    d3.select(scatterContainer)
      .selectAll<SVGCircleElement, WeatherImpactDatum>(
        "circle.weather-impact-point",
      )
      .classed(
        "is-highlighted",
        (datum) => datum.station.eva === highlightedImpactStationEva,
      )
      .filter((datum) => datum.station.eva === highlightedImpactStationEva)
      .raise();
  };

  const drawImpactScatter = () => {
    if (impactMode !== "weather-impact") {
      scatterContainer.replaceChildren();
      return;
    }

    const data = getWeatherImpactData();
    scatterContainer.replaceChildren();

    const rect = scatterContainer.getBoundingClientRect();
    const width = Math.max(320, rect.width || 520);
    const height = Math.max(360, Math.min(560, rect.height || 440));

    if (data.length === 0) {
      const empty = document.createElement("div");
      empty.className = "weather-impact-empty";
      empty.textContent = "No connection delay data for the current selection.";
      scatterContainer.append(empty);
      return;
    }

    const margin = { top: 30, right: 22, bottom: 66, left: 58 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const xExtent = d3.extent(data, (d) => d.weatherValue);
    let xMin = xExtent[0] ?? 0;
    let xMax = xExtent[1] ?? 1;

    if (Math.abs(xMax - xMin) < 0.1) {
      xMin -= 1;
      xMax += 1;
    }

    const yMax = d3.max(data, (d) => d.avgDelayMin) ?? 1;
    const delayCountMax = d3.max(data, (d) => d.delayCount) ?? 1;
    const xScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .nice(6)
      .range([0, innerWidth]);
    const yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .nice(6)
      .range([innerHeight, 0]);
    const radiusScale = d3
      .scaleSqrt()
      .domain([1, delayCountMax])
      .range([4, 18]);

    const svgElement = d3
      .select(scatterContainer)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "weather-impact-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("display", "block");

    const chart = svgElement
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    chart
      .append("g")
      .attr("class", "weather-impact-grid")
      .call(
        d3
          .axisLeft(yScale)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat(() => ""),
      )
      .call((axis) => axis.select(".domain").remove());

    chart
      .append("g")
      .attr("class", "weather-impact-axis")
      .attr("transform", `translate(0, ${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(6));

    chart
      .append("g")
      .attr("class", "weather-impact-axis")
      .call(d3.axisLeft(yScale).ticks(5));

    const config = WEATHER_VARIABLES[activeVariableKey];

    chart
      .append("text")
      .attr("class", "weather-impact-axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 50)
      .attr("text-anchor", "middle")
      .text(`${config.label} (${config.unit})`);

    chart
      .append("text")
      .attr("class", "weather-impact-axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2)
      .attr("y", -42)
      .attr("text-anchor", "middle")
      .text("Average delay (min)");

    chart
      .append("text")
      .attr("class", "weather-impact-title")
      .attr("x", 0)
      .attr("y", -10)
      .text("Weather Impact Scatterplot");

    chart
      .append("text")
      .attr("class", "weather-impact-note")
      .attr("x", innerWidth)
      .attr("y", -10)
      .attr("text-anchor", "end")
      .text("point = station, size = delay count");

    chart
      .append("g")
      .attr("class", "weather-impact-points")
      .selectAll<SVGCircleElement, WeatherImpactDatum>("circle")
      .data(data, (d) => `${d.station.eva}`)
      .join("circle")
      .attr("class", "weather-impact-point")
      .attr("cx", (d) => xScale(d.weatherValue))
      .attr("cy", (d) => yScale(d.avgDelayMin))
      .attr("r", (d) => radiusScale(d.delayCount))
      .classed(
        "is-highlighted",
        (d) => d.station.eva === highlightedImpactStationEva,
      )
      .on("mouseenter", function (event, d) {
        setImpactScatterHighlight(d.station.eva);
        options.onStationHoverChange?.(d.station.eva);
        showImpactTooltip(event, d);
      })
      .on("mousemove", (event, d) => {
        showImpactTooltip(event, d);
      })
      .on("mouseleave", function () {
        setImpactScatterHighlight(null);
        options.onStationHoverChange?.(null);
        tooltip.style("display", "none");
      });
  };

  const drawTimelineChart = () => {
    if (!activeDataset || !controls.chartContainer) {
      return;
    }

    const chartData = getChartData(
      activeDataset,
      currentVisibleStationNames,
      currentFocusedState,
      currentDailyDelayTrips,
    );

    if (chartData.length === 0) {
      return;
    }

    const container = controls.chartContainer;
    d3.select(container).html("");
    chartTooltip.style("display", "none");

    const rect = container.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 180;

    const margin = { top: 28, right: 118, bottom: 25, left: 174 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    if (innerWidth <= 0 || innerHeight <= 0) {
      return;
    }

    const fullDomain = paddedTimelineDomain(chartData);
    const baseXScale = d3.scaleTime().domain(fullDomain).range([0, innerWidth]);
    visibleTimelineDomain = clampVisibleTimeDomain(
      visibleTimelineDomain,
      fullDomain,
    );
    timelineZoomTransform = zoomTransformForTimeDomain(
      baseXScale,
      visibleTimelineDomain,
    );
    let xScale = timelineZoomTransform.rescaleX(baseXScale);

    const svgElement = d3
      .select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "weather-timeline-svg")
      .style("display", "block");

    svgElement
      .append("defs")
      .append("clipPath")
      .attr("id", timelineClipId)
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight);

    const chartSvg = svgElement
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const tempExtent = d3.extent(chartData, (d) => d.temp);
    let tempMin = tempExtent[0] !== undefined ? tempExtent[0] : 12;
    let tempMax = tempExtent[1] !== undefined ? tempExtent[1] : 27;
    if (Math.abs(tempMax - tempMin) < 0.1) {
      tempMin -= 2;
      tempMax += 2;
    }
    const tempScaleNice = d3.scaleLinear().domain([tempMin, tempMax]).nice(5);
    const [niceTempMin, niceTempMax] = tempScaleNice.domain();

    const precipMax = d3.max(chartData, (d) => d.precip) || 2;
    const nicePrecipMax = d3
      .scaleLinear()
      .domain([0, precipMax])
      .nice(5)
      .domain()[1];
    const snowMax = d3.max(chartData, (d) => d.snow) || 5;
    const niceSnowMax = d3
      .scaleLinear()
      .domain([0, snowMax])
      .nice(5)
      .domain()[1];
    const countMax = d3.max(chartData, (d) => d.delaysCount) || 5;
    const niceCountMax = d3
      .scaleLinear()
      .domain([0, countMax])
      .nice(5)
      .domain()[1];
    const delayMinMax = d3.max(chartData, (d) => d.avgDelayMin) || 5;
    const niceDelayMax = d3
      .scaleLinear()
      .domain([0, delayMinMax])
      .nice(5)
      .domain()[1];

    const yScaleTemp = d3
      .scaleLinear()
      .domain([niceTempMin, niceTempMax])
      .range([innerHeight, 0]);
    const yScalePrecip = d3
      .scaleLinear()
      .domain([0, nicePrecipMax])
      .range([innerHeight, 0]);
    const yScaleSnow = d3
      .scaleLinear()
      .domain([0, niceSnowMax])
      .range([innerHeight, 0]);
    const yScaleCount = d3
      .scaleLinear()
      .domain([0, niceCountMax])
      .range([innerHeight, 0]);
    const yScaleDelay = d3
      .scaleLinear()
      .domain([0, niceDelayMax])
      .range([innerHeight, 0]);

    const tickIndices = [0, 1, 2, 3, 4, 5];
    const ticksTemp = tickIndices.map(
      (i) => niceTempMin + (i * (niceTempMax - niceTempMin)) / 5,
    );
    const ticksPrecip = tickIndices.map((i) => (i * nicePrecipMax) / 5);
    const ticksSnow = tickIndices.map((i) => (i * niceSnowMax) / 5);
    const ticksCount = tickIndices.map((i) => (i * niceCountMax) / 5);
    const ticksDelay = tickIndices.map((i) => (i * niceDelayMax) / 5);

    const gridG = chartSvg.append("g").attr("class", "grid-lines");
    tickIndices.forEach((i) => {
      const y = (i / 5) * innerHeight;
      gridG
        .append("line")
        .attr("x1", 0)
        .attr("y1", y)
        .attr("x2", innerWidth)
        .attr("y2", y)
        .attr("stroke", "rgba(255, 255, 255, 0.08)")
        .attr("stroke-width", 1);
    });

    const drawLeftAxisColumn = (
      axisG: d3.Selection<SVGGElement, unknown, null, undefined>,
      ticks: number[],
      scale: d3.ScaleLinear<number, number>,
      rightEdgeX: number,
      labelText: string,
      accentColor: string,
      formatFn: (v: number) => string,
    ) => {
      const colG = axisG
        .append("g")
        .attr("transform", `translate(${rightEdgeX}, 0)`);
      const textX = -TIMELINE_AXIS_COLUMN_WIDTH / 2;

      colG
        .append("rect")
        .attr("x", -TIMELINE_AXIS_COLUMN_WIDTH)
        .attr("y", -23)
        .attr("width", TIMELINE_AXIS_COLUMN_WIDTH)
        .attr("height", innerHeight + 28)
        .attr("rx", 6)
        .attr("fill", accentColor)
        .attr("opacity", 1);

      colG
        .append("text")
        .attr("x", textX)
        .attr("y", -11)
        .attr("text-anchor", "middle")
        .attr("fill", "rgba(255, 255, 255, 0.86)")
        .attr("stroke", "rgba(0, 0, 0, 0.86)")
        .attr("stroke-width", 3)
        .attr("stroke-linejoin", "round")
        .attr("paint-order", "stroke")
        .style("font-size", "10px")
        .style("font-weight", "700")
        .text(labelText);

      ticks.forEach((val) => {
        colG
          .append("text")
          .attr("x", textX)
          .attr("y", scale(val))
          .attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .attr("fill", "rgba(255, 255, 255, 0.78)")
          .attr("stroke", "rgba(0, 0, 0, 0.86)")
          .attr("stroke-width", 3)
          .attr("stroke-linejoin", "round")
          .attr("paint-order", "stroke")
          .style("font-size", "10px")
          .style("font-weight", "600")
          .text(formatFn(val));
      });
    };

    const drawRightAxisColumn = (
      axisG: d3.Selection<SVGGElement, unknown, null, undefined>,
      ticks: number[],
      scale: d3.ScaleLinear<number, number>,
      leftEdgeX: number,
      labelText: string,
      accentColor: string,
      formatFn: (v: number) => string,
    ) => {
      const colG = axisG
        .append("g")
        .attr("transform", `translate(${leftEdgeX}, 0)`);
      const textX = TIMELINE_AXIS_COLUMN_WIDTH / 2;

      colG
        .append("rect")
        .attr("x", 0)
        .attr("y", -23)
        .attr("width", TIMELINE_AXIS_COLUMN_WIDTH)
        .attr("height", innerHeight + 28)
        .attr("rx", 6)
        .attr("fill", accentColor)
        .attr("opacity", 1);

      colG
        .append("text")
        .attr("x", textX)
        .attr("y", -11)
        .attr("text-anchor", "middle")
        .attr("fill", "rgba(255, 255, 255, 0.9)")
        .attr("stroke", "rgba(0, 0, 0, 0.86)")
        .attr("stroke-width", 3)
        .attr("stroke-linejoin", "round")
        .attr("paint-order", "stroke")
        .style("font-size", "10px")
        .style("font-weight", "700")
        .text(labelText);

      ticks.forEach((val) => {
        colG
          .append("text")
          .attr("x", textX)
          .attr("y", scale(val))
          .attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .attr("fill", "rgba(255, 255, 255, 0.82)")
          .attr("stroke", "rgba(0, 0, 0, 0.86)")
          .attr("stroke-width", 3)
          .attr("stroke-linejoin", "round")
          .attr("paint-order", "stroke")
          .style("font-size", "10px")
          .style("font-weight", "600")
          .text(formatFn(val));
      });
    };

    const formatVal = (v: number) => {
      if (v === 0) return "0";
      return v % 1 === 0 ? `${v}` : v.toFixed(1);
    };

    const leftAxesG = chartSvg.append("g").attr("class", "y-axes-left");
    drawLeftAxisColumn(
      leftAxesG,
      ticksSnow,
      yScaleSnow,
      -(
        TIMELINE_AXIS_PLOT_GAP +
        TIMELINE_AXIS_COLUMN_STEP * 2
      ),
      "cm",
      "#ffffff",
      formatVal,
    );
    drawLeftAxisColumn(
      leftAxesG,
      ticksPrecip,
      yScalePrecip,
      -(TIMELINE_AXIS_PLOT_GAP + TIMELINE_AXIS_COLUMN_STEP),
      "mm",
      "#3b82f6",
      formatVal,
    );
    drawLeftAxisColumn(
      leftAxesG,
      ticksTemp,
      yScaleTemp,
      -TIMELINE_AXIS_PLOT_GAP,
      "°C",
      "#fbbf24",
      formatVal,
    );

    const rightAxesG = chartSvg.append("g").attr("class", "y-axes-right");
    drawRightAxisColumn(
      rightAxesG,
      ticksCount,
      yScaleCount,
      innerWidth + TIMELINE_AXIS_PLOT_GAP,
      "count",
      "#818cf8",
      formatVal,
    );
    drawRightAxisColumn(
      rightAxesG,
      ticksDelay,
      yScaleDelay,
      innerWidth + TIMELINE_AXIS_PLOT_GAP + TIMELINE_AXIS_COLUMN_STEP,
      "min",
      "#c084fc",
      formatVal,
    );

    const xAxisG = chartSvg
      .append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0, ${innerHeight})`);

    const plotG = chartSvg
      .append("g")
      .attr("class", "weather-timeline-plot")
      .attr("clip-path", `url(#${timelineClipId})`);
    const barG = plotG.append("g").attr("class", "delays-bars");
    const linesG = plotG.append("g").attr("class", "weather-lines");
    const pointsG = plotG.append("g").attr("class", "weather-points");

    const countBars = barG
      .selectAll<SVGRectElement, WeatherChartDatum>("rect.delay-count-bar")
      .data(
        chartData.filter((d) => d.delaysCount > 0),
        (d) => `${d.index}`,
      )
      .join("rect")
      .attr("class", (d) => `delay-bar delay-count-bar day-${d.index}`)
      .attr("y", (d) => yScaleCount(d.delaysCount))
      .attr("height", (d) =>
        Math.max(0, innerHeight - yScaleCount(d.delaysCount)),
      )
      .attr("fill", "#818cf8")
      .attr("rx", 1)
      .attr("opacity", 0.7);

    const delayBars = barG
      .selectAll<SVGRectElement, WeatherChartDatum>("rect.delay-avg-bar")
      .data(
        chartData.filter((d) => d.avgDelayMin > 0),
        (d) => `${d.index}`,
      )
      .join("rect")
      .attr("class", (d) => `delay-bar delay-avg-bar day-${d.index}`)
      .attr("y", (d) => yScaleDelay(d.avgDelayMin))
      .attr("height", (d) =>
        Math.max(0, innerHeight - yScaleDelay(d.avgDelayMin)),
      )
      .attr("fill", "#c084fc")
      .attr("rx", 1)
      .attr("opacity", 0.7);

    const lineTemp = d3
      .line<WeatherChartDatum>()
      .defined((d) => Number.isFinite(d.temp))
      .x((d) => xScale(d.time))
      .y((d) => yScaleTemp(d.temp));
    const linePrecip = d3
      .line<WeatherChartDatum>()
      .defined((d) => Number.isFinite(d.precip))
      .x((d) => xScale(d.time))
      .y((d) => yScalePrecip(d.precip));
    const lineSnow = d3
      .line<WeatherChartDatum>()
      .defined((d) => Number.isFinite(d.snow))
      .x((d) => xScale(d.time))
      .y((d) => yScaleSnow(d.snow));

    const precipLine = linesG
      .append("path")
      .datum(chartData)
      .attr("fill", "none")
      .attr("stroke", "#3b82f6")
      .attr("stroke-width", 1.8);
    const snowLine = linesG
      .append("path")
      .datum(chartData)
      .attr("fill", "none")
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1.8);
    const tempLine = linesG
      .append("path")
      .datum(chartData)
      .attr("fill", "none")
      .attr("stroke", "#fbbf24")
      .attr("stroke-width", 1.8);

    const precipPoints = pointsG
      .selectAll<SVGCircleElement, WeatherChartDatum>("circle.precip-point")
      .data(chartData.filter((d) => Number.isFinite(d.precip)))
      .join("circle")
      .attr("class", "precip-point")
      .attr("cy", (d) => yScalePrecip(d.precip))
      .attr("r", 3.2)
      .attr("fill", "#3b82f6");
    const snowPoints = pointsG
      .selectAll<SVGCircleElement, WeatherChartDatum>("circle.snow-point")
      .data(chartData.filter((d) => Number.isFinite(d.snow)))
      .join("circle")
      .attr("class", "snow-point")
      .attr("cy", (d) => yScaleSnow(d.snow))
      .attr("r", 3.2)
      .attr("fill", "#ffffff");
    const tempPoints = pointsG
      .selectAll<SVGCircleElement, WeatherChartDatum>("circle.temp-point")
      .data(chartData.filter((d) => Number.isFinite(d.temp)))
      .join("circle")
      .attr("class", "temp-point")
      .attr("cy", (d) => yScaleTemp(d.temp))
      .attr("r", 3.2)
      .attr("fill", "#fbbf24");

    const selectedLine = plotG
      .append("line")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("stroke", "#ff7a16")
      .attr("stroke-width", 2)
      .style("display", "none")
      .attr("pointer-events", "none");

    const hoverLine = plotG
      .append("line")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("stroke", "rgba(255, 255, 255, 0.5)")
      .attr("stroke-width", 1.2)
      .style("display", "none")
      .attr("pointer-events", "none");

    const hoverCirclesG = plotG
      .append("g")
      .style("display", "none")
      .attr("pointer-events", "none");
    const hCircleTemp = hoverCirclesG
      .append("circle")
      .attr("r", 5.5)
      .attr("fill", "#fbbf24")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1.5);
    const hCirclePrecip = hoverCirclesG
      .append("circle")
      .attr("r", 5.5)
      .attr("fill", "#3b82f6")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1.5);
    const hCircleSnow = hoverCirclesG
      .append("circle")
      .attr("r", 5.5)
      .attr("fill", "#ffffff")
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1.5);

    const captureRect = chartSvg
      .append("rect")
      .attr("class", "weather-chart-zoom-capture")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .attr("pointer-events", "all");

    let currentHoverIndex: number | null = null;
    let pointerStart: [number, number] | null = null;
    let pointerMoved = false;

    const dateFormatter = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Berlin",
    });

    const restoreBarOpacity = () => {
      chartSvg.selectAll(".delay-bar").attr("opacity", 0.7);
    };

    const hideHoverState = () => {
      currentHoverIndex = null;
      hoverLine.style("display", "none");
      hoverCirclesG.style("display", "none");
      chartTooltip.style("display", "none");
      restoreBarOpacity();
    };

    const closestIndexForX = (mouseX: number) => {
      let closestIndex = 0;
      let minDistance = Number.POSITIVE_INFINITY;
      chartData.forEach((d, i) => {
        const distance = Math.abs(xScale(d.time) - mouseX);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
      });

      return closestIndex;
    };

    const updateHoverMarkers = (index: number) => {
      const d = chartData[index];
      const x = xScale(d.time);

      hoverLine.attr("x1", x).attr("x2", x).style("display", "block");

      hCircleTemp
        .attr("cx", x)
        .attr("cy", yScaleTemp(d.temp))
        .style("display", Number.isFinite(d.temp) ? "" : "none");
      hCirclePrecip
        .attr("cx", x)
        .attr("cy", yScalePrecip(d.precip))
        .style("display", Number.isFinite(d.precip) ? "" : "none");
      hCircleSnow
        .attr("cx", x)
        .attr("cy", yScaleSnow(d.snow))
        .style("display", Number.isFinite(d.snow) ? "" : "none");

      hoverCirclesG.style("display", "block");
      chartSvg.selectAll(".delay-bar").attr("opacity", 0.2);
      chartSvg.selectAll(`.day-${d.index}`).attr("opacity", 1.0);
    };

    const showChartTooltip = (d: WeatherChartDatum) => {
      const chartNode = svgElement.node();
      const containerRect = chartNode
        ? chartNode.getBoundingClientRect()
        : { left: 0, top: 0 };
      const chartX = xScale(d.time) + margin.left;
      const tooltipX = containerRect.left + window.scrollX + chartX;
      const tooltipY = containerRect.top + window.scrollY - 10;

      chartTooltip
        .html(
          `
          <div style="font-weight: 700; color: rgba(255,255,255,0.7); margin-bottom: 5px;">${dateFormatter.format(d.time)}</div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #fbbf24;"></span>
            <span>temperature: <strong>${d.temp.toFixed(1)} °C</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #3b82f6;"></span>
            <span>precipitation: <strong>${d.precip.toFixed(1)} mm</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #ffffff;"></span>
            <span>snowfall: <strong>${d.snow.toFixed(1)} cm</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 5px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 5px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #818cf8;"></span>
            <span>delay count: <strong>${d.delaysCount}</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #c084fc;"></span>
            <span>avg delay: <strong>${d.avgDelayMin.toFixed(1)} min</strong></span>
          </div>
        `,
        )
        .style("display", "block")
        .style("left", `${tooltipX}px`)
        .style("top", `${tooltipY}px`)
        .style("transform", "translate(-50%, -100%)");
    };

    const renderZoomedChart = (
      nextXScale: d3.ScaleTime<number, number>,
      transform: d3.ZoomTransform,
    ) => {
      xScale = nextXScale;
      timelineZoomTransform = transform;
      const nextDomain = xScale.domain();
      visibleTimelineDomain = [nextDomain[0], nextDomain[1]];

      const tickDates = timelineTickValues(chartData, xScale, innerWidth);
      const xAxis = d3
        .axisBottom<Date>(xScale)
        .tickValues(tickDates)
        .tickFormat((date) => formatTimelineTick(date as Date));

      xAxisG
        .call(xAxis)
        .call((axisG) =>
          axisG.select(".domain").attr("stroke", "rgba(255, 255, 255, 0.15)"),
        )
        .call((axisG) =>
          axisG
            .selectAll(".tick line")
            .attr("stroke", "rgba(255, 255, 255, 0.15)"),
        )
        .call((axisG) =>
          axisG
            .selectAll(".tick text")
            .attr("fill", "rgba(255, 255, 255, 0.6)")
            .attr("stroke", "rgba(0, 0, 0, 0.86)")
            .attr("stroke-width", 3)
            .attr("stroke-linejoin", "round")
            .attr("paint-order", "stroke")
            .style("font-size", "10px"),
        );

      const barWidth = Math.max(
        3,
        Math.min(18, (innerWidth / chartData.length) * transform.k * 0.18),
      );

      countBars
        .attr("x", (d) => xScale(d.time) - barWidth)
        .attr("width", Math.max(1, barWidth - 1));
      delayBars
        .attr("x", (d) => xScale(d.time))
        .attr("width", Math.max(1, barWidth - 1));

      precipLine.attr("d", linePrecip);
      snowLine.attr("d", lineSnow);
      tempLine.attr("d", lineTemp);
      precipPoints.attr("cx", (d) => xScale(d.time));
      snowPoints.attr("cx", (d) => xScale(d.time));
      tempPoints.attr("cx", (d) => xScale(d.time));

      if (
        selectedHourIndex !== null &&
        selectedHourIndex >= 0 &&
        selectedHourIndex < chartData.length
      ) {
        const selX = xScale(chartData[selectedHourIndex].time);
        selectedLine
          .attr("x1", selX)
          .attr("x2", selX)
          .style("display", "block");
      } else {
        selectedLine.style("display", "none");
      }

      if (currentHoverIndex !== null) {
        updateHoverMarkers(currentHoverIndex);
        showChartTooltip(chartData[currentHoverIndex]);
      }
    };

    const zoomBehavior = d3
      .zoom<SVGRectElement, unknown>()
      .extent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .translateExtent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .scaleExtent([1, Math.max(1, Math.min(40, chartData.length))])
      .on("start", () => {
        captureRect.classed("is-panning", true);
        hideHoverState();
      })
      .on("zoom", (event) => {
        renderZoomedChart(
          event.transform.rescaleX(baseXScale),
          event.transform,
        );
      })
      .on("end", () => {
        captureRect.classed("is-panning", false);
      });

    captureRect
      .call(zoomBehavior)
      .call(zoomBehavior.transform, timelineZoomTransform)
      .on("pointerdown", (event: PointerEvent) => {
        pointerStart = [event.clientX, event.clientY];
        pointerMoved = false;
      })
      .on("pointermove", function (event: PointerEvent) {
        if (pointerStart) {
          const distance = Math.hypot(
            event.clientX - pointerStart[0],
            event.clientY - pointerStart[1],
          );
          pointerMoved = pointerMoved || distance > 4;
        }

        if (pointerMoved && event.buttons > 0) {
          return;
        }

        const [mouseX] = d3.pointer(event, this);
        const closestIndex = closestIndexForX(mouseX);

        if (closestIndex !== currentHoverIndex) {
          currentHoverIndex = closestIndex;
          updateHoverMarkers(closestIndex);
          previewHour(closestIndex);
        }

        showChartTooltip(chartData[closestIndex]);
      })
      .on("pointerup", () => {
        pointerStart = null;
      })
      .on("pointerleave", () => {
        pointerStart = null;
        pointerMoved = false;
        hideHoverState();
        restoreSelectedHour();
      })
      .on("click", function (event: MouseEvent) {
        if (pointerMoved) {
          pointerMoved = false;
          return;
        }

        const [mouseX] = d3.pointer(event, this);
        commitHour(closestIndexForX(mouseX));
      });

    if (controls.legendContainer) {
      updateLegendHTML(controls.legendContainer);
    }

    window.requestAnimationFrame(syncStationFilterHeight);
  };

  window.addEventListener("resize", () => {
    drawTimelineChart();
    drawImpactScatter();
    window.requestAnimationFrame(syncStationFilterHeight);
  });

  dropdown.addEventListener("change", (event: Event) => {
    const customEvent = event as CustomEvent<{
      value: WeatherVariableKey;
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
      drawImpactScatter();
    }
  });

  impactModeDropdown.addEventListener("change", (event: Event) => {
    const customEvent = event as CustomEvent<{ value: WeatherImpactMode }>;
    setImpactMode(customEvent.detail.value);
  });

  directionDropdown.addEventListener("change", (event: Event) => {
    const customEvent = event as CustomEvent<{ value: DelayDirection }>;
    impactDirection = customEvent.detail.value;
    drawImpactScatter();
  });

  aggregateCheckbox.addEventListener("change", () => {
    impactAggregate = aggregateCheckbox.checked;
    drawImpactScatter();
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

  const overlay: WeatherOverlay = {
    layer,
    currentCells: [],
    impactPanel,
    impactScatterContainer: scatterContainer,
    ...controls,
  };

  g.append("path")
    .attr("class", "weather-boundary-layer")
    .datum(geojson)
    .attr("d", d3.geoPath(projection))
    .attr("fill", "none")
    .attr("stroke", "rgba(255, 255, 255, 0.58)")
    .attr("stroke-width", 0.8)
    .attr("pointer-events", "none");

  const showWeatherError = (error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Could not load weather",
    );

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
    const endLoadingTask = options.beginLoadingTask?.(
      "Loading weather data...",
    );
    controls.slider.disabled = true;

    try {
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
        closestHourIndex(
          dataset.hours,
          selectedDateTargetTime(dataset.fromDate),
        );
      previewHourIndex = null;
      renderedHourIndex = -1;
      controls.slider.value = `${committedRenderHourIndex}`;
      updateStepMarks(controls.stepMarks, dataset.hours);
      visibleTimelineDomain = null;
      timelineZoomTransform = d3.zoomIdentity;

      renderHour(overlay, dataset, committedRenderHourIndex, activeVariableKey);
      renderedHourIndex = committedRenderHourIndex;

      drawTimelineChart();
      drawImpactScatter();
    } finally {
      endLoadingTask?.();
    }
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
    drawImpactScatter();
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
    drawImpactScatter();
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
    dispatchWeatherDatePreview(null);

    drawTimelineChart();
    drawImpactScatter();
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
    setHoveredStation: (stationEva) => {
      setImpactScatterHighlight(stationEva);
    },
    updateData: (visibleStations, focusedState, dailyDelayTrips) => {
      currentVisibleStations = visibleStations;
      currentVisibleStationNames = new Set(
        visibleStations.map((station) => station.name),
      );
      currentFocusedState = focusedState;
      currentDailyDelayTrips = dailyDelayTrips;
      drawTimelineChart();
      drawImpactScatter();
    },
  };
}
