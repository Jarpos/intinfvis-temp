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
  buildStationDelayAddedStats,
  buildStationDelayImpactStats,
} from "./data/bahn";
import type {
  DelayDirection,
  DelayTrip,
  Station,
  StationDelayAddedStats,
} from "./data/bahn";

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
  impactVisualizationContainer: HTMLDivElement;
};

type WeatherVariableKey = "temperature_2m" | "precipitation" | "snow_depth";
type WeatherImpactMode =
  | "none"
  | "weather-impact"
  | "worst-best-stations"
  | "delay-duration-distribution"
  | "weekdays-distribution";

const WEATHER_TIMELINE_COLORS: Record<
  WeatherVariableKey | "delayCount" | "avgDelay",
  string
> = {
  temperature_2m: "#fbbf24",
  precipitation: "#3b82f6",
  snow_depth: "#ffffff",
  delayCount: "#818cf8",
  avgDelay: "#c084fc",
};

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
      { value: "none", label: "None" },
      { value: "weather-impact", label: "Weather Impact" },
      { value: "worst-best-stations", label: "Worst/Best Stations" },
      {
        value: "delay-duration-distribution",
        label: "Delay Duration Distribution",
      },
      {
        value: "weekdays-distribution",
        label: "Weekdays Distribution",
      },
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
  scatterContainer.className =
    "weather-impact-visualization weather-impact-scatter";
  scatterContainer.setAttribute("aria-label", "Weather impact visualization");

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
    panel,
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
    panel,
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
    const timelineTop = controls.timeline.getBoundingClientRect().top;
    const availableStationFilterHeight = Math.max(
      0,
      Math.floor(timelineTop - stationFilterTimelineGap),
    );
    const edgeInset =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--weather-edge-inset",
        ),
      ) || 0;
    const availableOverlayHeight = Math.max(
      0,
      Math.floor(timelineTop - stationFilterTimelineGap - edgeInset),
    );

    document.documentElement.style.setProperty(
      "--weather-overlay-max-height",
      `${availableOverlayHeight}px`,
    );

    panel.style.setProperty("--weather-panel-scale", "1");
    const panelHeight = panel.scrollHeight;
    const panelWidth = panel.scrollWidth;
    const availableWidth = Math.max(0, window.innerWidth - edgeInset * 2);
    const heightScale =
      panelHeight > 0 ? availableOverlayHeight / panelHeight : 1;
    const widthScale = panelWidth > 0 ? availableWidth / panelWidth : 1;
    const panelScale = Math.min(1, heightScale, widthScale);
    panel.style.setProperty(
      "--weather-panel-scale",
      `${(Number.isFinite(panelScale) ? Math.max(0, panelScale) : 1).toFixed(3)}`,
    );

    if (!stationFilter) {
      return;
    }

    document.documentElement.style.setProperty(
      "--station-filter-height",
      `${availableStationFilterHeight}px`,
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
  const impactZoomTransforms = new Map<WeatherImpactMode, d3.ZoomTransform>();

  const updateLegendHTML = (container: HTMLDivElement) => {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 7px; font-size: 11px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${WEATHER_TIMELINE_COLORS.temperature_2m};"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">temperature</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${WEATHER_TIMELINE_COLORS.precipitation};"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">precipitation</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${WEATHER_TIMELINE_COLORS.snow_depth};"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">snowfall</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 4px;">
          <span style="display: inline-block; width: 8px; height: 5px; border-radius: 1px; background-color: ${WEATHER_TIMELINE_COLORS.delayCount};"></span>
          <span style="font-weight: 600; color: rgba(255,255,255,0.78);">delay count</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 8px; height: 5px; border-radius: 1px; background-color: ${WEATHER_TIMELINE_COLORS.avgDelay};"></span>
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

  type StationDelayAddedDatum = StationDelayAddedStats & {
    delayAddedMin: number;
    incomingAvgDelayMin: number | null;
    outgoingAvgDelayMin: number | null;
  };

  type DelayDurationSample = {
    delayMin: number;
    count: number;
  };

  type DelayDurationBin = {
    min: number;
    max: number;
    count: number;
  };

  type DelayDurationPercentile = {
    label: string;
    value: number;
  };

  type DelayDurationDistributionData = {
    bins: DelayDurationBin[];
    percentiles: DelayDurationPercentile[];
    totalCount: number;
  };

  type WeekdayDistributionDatum = {
    index: number;
    label: string;
    dateCount: number;
    delayCount: number;
    avgDelayCount: number;
    avgDelayMin: number | null;
    weightedDelay: number;
  };

  const delayDurationBinSizeMin = 1;
  const delayDurationPercentiles = [
    { label: "P25", percentile: 0.25 },
    { label: "P50", percentile: 0.5 },
    { label: "P75", percentile: 0.75 },
    { label: "P90", percentile: 0.9 },
    { label: "P95", percentile: 0.95 },
  ];

  const formatSignedMinutes = (value: number) => {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)} min`;
  };

  const formatOptionalMinutes = (value: number | null) =>
    value === null ? "N/A" : formatSignedMinutes(value);

  const panelAvailableVisualizationHeight = (
    minHeight: number,
    maxHeight: number,
  ) => {
    const cssHeight =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--weather-overlay-max-height",
        ),
      ) || maxHeight;

    return Math.max(minHeight, Math.min(maxHeight, cssHeight - 132));
  };

  const visualizationLayoutWidth = (
    container: HTMLDivElement,
    fallback: number,
  ) => {
    const rectWidth = container.getBoundingClientRect().width;

    return Math.max(1, container.clientWidth || rectWidth || fallback);
  };

  const appendImpactClipPath = (
    svgElement: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    clipId: string,
    innerWidth: number,
    innerHeight: number,
  ) => {
    svgElement
      .append("defs")
      .append("clipPath")
      .attr("id", clipId)
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight);
  };

  const appendImpactZoomSurface = (
    chart: d3.Selection<SVGGElement, unknown, null, undefined>,
    innerWidth: number,
    innerHeight: number,
  ) =>
    chart
      .append("rect")
      .attr("class", "weather-chart-zoom-capture weather-impact-zoom-surface")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .attr("pointer-events", "all");

  const addImpactChartZoom = (
    chart: d3.Selection<SVGGElement, unknown, null, undefined>,
    zoomSurface: d3.Selection<SVGRectElement, unknown, null, undefined>,
    mode: WeatherImpactMode,
    innerWidth: number,
    innerHeight: number,
    maxScale: number,
    renderZoomedChart: (transform: d3.ZoomTransform) => void,
  ) => {
    const storedTransform = impactZoomTransforms.get(mode) ?? d3.zoomIdentity;
    const initialTransform =
      storedTransform.k <= maxScale ? storedTransform : d3.zoomIdentity;
    const zoomBehavior = d3
      .zoom<SVGGElement, unknown>()
      .extent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .translateExtent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .scaleExtent([1, Math.max(1, maxScale)])
      .on("start", () => {
        zoomSurface.classed("is-panning", true);
        tooltip.style("display", "none");
      })
      .on("zoom", (event) => {
        impactZoomTransforms.set(mode, event.transform);
        renderZoomedChart(event.transform);
      })
      .on("end", () => {
        zoomSurface.classed("is-panning", false);
      });

    chart.call(zoomBehavior).call(zoomBehavior.transform, initialTransform);
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

  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const weekdayIndexForDateKey = (date: string) => {
    const parsedDate = new Date(`${date}T12:00:00`);

    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return (parsedDate.getDay() + 6) % 7;
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

  const getStationDelayAddedData = (): StationDelayAddedDatum[] => {
    if (!activeDataset || currentVisibleStations.length === 0) {
      return [];
    }

    const hours = weatherImpactHours();
    const trips = weatherImpactTrips(hours);

    if (hours.length === 0 || trips.length === 0) {
      return [];
    }

    const stats = Array.from(
      buildStationDelayAddedStats(trips, currentVisibleStations).values(),
    )
      .map((datum) => ({
        ...datum,
        delayAddedMin: datum.delayAdded / 60,
        incomingAvgDelayMin:
          datum.incomingAvgDelay === null ? null : datum.incomingAvgDelay / 60,
        outgoingAvgDelayMin:
          datum.outgoingAvgDelay === null ? null : datum.outgoingAvgDelay / 60,
      }))
      .filter((datum) => Number.isFinite(datum.delayAddedMin))
      .sort((a, b) => d3.ascending(a.delayAddedMin, b.delayAddedMin));

    const selectedByEva = new Map<number, StationDelayAddedDatum>();

    stats.slice(0, 10).forEach((datum) => {
      selectedByEva.set(datum.station.eva, datum);
    });
    stats.slice(-10).forEach((datum) => {
      selectedByEva.set(datum.station.eva, datum);
    });

    return Array.from(selectedByEva.values()).sort((a, b) =>
      d3.ascending(a.delayAddedMin, b.delayAddedMin),
    );
  };

  const weightedPercentile = (
    samples: DelayDurationSample[],
    percentile: number,
    totalCount: number,
  ) => {
    const threshold = totalCount * percentile;
    let cumulative = 0;

    for (const sample of samples) {
      cumulative += sample.count;

      if (cumulative >= threshold) {
        return sample.delayMin;
      }
    }

    return samples.at(-1)?.delayMin ?? 0;
  };

  const getDelayDurationDistributionData =
    (): DelayDurationDistributionData | null => {
      if (!activeDataset || currentVisibleStations.length === 0) {
        return null;
      }

      const hours = weatherImpactHours();
      const trips = weatherImpactTrips(hours);

      if (hours.length === 0 || trips.length === 0) {
        return null;
      }

      const visibleStationsByEva = new Set(
        currentVisibleStations.map((station) => station.eva),
      );
      const samples: DelayDurationSample[] = [];

      trips.forEach((trip) => {
        const fromVisible = visibleStationsByEva.has(trip.from_stop_id);
        const toVisible = visibleStationsByEva.has(trip.to_stop_id);
        const isSelfConnection = trip.from_stop_id === trip.to_stop_id;

        const count =
          Number.isFinite(trip.delay_count) && trip.delay_count > 0
            ? trip.delay_count
            : 0;
        const delayMin = trip.avg_delay / 60;

        if (count <= 0 || !Number.isFinite(delayMin) || delayMin < 0) {
          return;
        }

        const addSample = () => {
          samples.push({ delayMin, count });
        };

        if (impactDirection === "both") {
          if (fromVisible) {
            addSample();
          }

          if (toVisible && !isSelfConnection) {
            addSample();
          }

          return;
        }

        if (isSelfConnection) {
          return;
        }

        if (impactDirection === "incoming" && toVisible) {
          addSample();
        }

        if (impactDirection === "outgoing" && fromVisible) {
          addSample();
        }
      });

      if (samples.length === 0) {
        return null;
      }

      const sortedSamples = samples.sort((a, b) =>
        d3.ascending(a.delayMin, b.delayMin),
      );
      const totalCount = d3.sum(sortedSamples, (sample) => sample.count);
      const maxDelayMin =
        d3.max(sortedSamples, (sample) => sample.delayMin) ?? 0;
      const binCount = Math.max(
        1,
        Math.ceil(maxDelayMin / delayDurationBinSizeMin),
      );
      const bins = d3.range(binCount).map((index) => ({
        min: index * delayDurationBinSizeMin,
        max: (index + 1) * delayDurationBinSizeMin,
        count: 0,
      }));

      sortedSamples.forEach((sample) => {
        const binIndex = Math.min(
          bins.length - 1,
          Math.floor(sample.delayMin / delayDurationBinSizeMin),
        );

        bins[binIndex].count += sample.count;
      });

      return {
        bins,
        percentiles: delayDurationPercentiles.map(({ label, percentile }) => ({
          label,
          value: weightedPercentile(sortedSamples, percentile, totalCount),
        })),
        totalCount,
      };
    };

  const getWeekdayDistributionData = (): WeekdayDistributionDatum[] => {
    const buckets: WeekdayDistributionDatum[] = weekdayLabels.map(
      (label, index) => ({
        index,
        label,
        dateCount: 0,
        delayCount: 0,
        avgDelayCount: 0,
        avgDelayMin: null,
        weightedDelay: 0,
      }),
    );

    if (
      !activeDataset ||
      !currentDailyDelayTrips ||
      currentVisibleStations.length === 0
    ) {
      return buckets;
    }

    const dailyDelayTrips = currentDailyDelayTrips;
    const visibleStationsByEva = new Set(
      currentVisibleStations.map((station) => station.eva),
    );
    const selectedDates = Object.keys(dailyDelayTrips);

    selectedDates.forEach((date) => {
      const weekdayIndex = weekdayIndexForDateKey(date);
      const trips = dailyDelayTrips[date] ?? [];

      if (weekdayIndex === null) {
        return;
      }

      const bucket = buckets[weekdayIndex];
      bucket.dateCount += 1;

      if (trips.length === 0) {
        return;
      }

      trips.forEach((trip) => {
        const fromVisible = visibleStationsByEva.has(trip.from_stop_id);
        const toVisible = visibleStationsByEva.has(trip.to_stop_id);
        const isSelfConnection = trip.from_stop_id === trip.to_stop_id;
        const count =
          Number.isFinite(trip.delay_count) && trip.delay_count > 0
            ? trip.delay_count
            : 0;

        if (count <= 0 || !Number.isFinite(trip.avg_delay)) {
          return;
        }

        const addDelay = () => {
          bucket.delayCount += count;
          bucket.weightedDelay += trip.avg_delay * count;
        };

        if (impactDirection === "both") {
          if (fromVisible) {
            addDelay();
          }

          if (toVisible && !isSelfConnection) {
            addDelay();
          }

          return;
        }

        if (isSelfConnection) {
          return;
        }

        if (impactDirection === "incoming" && toVisible) {
          addDelay();
        }

        if (impactDirection === "outgoing" && fromVisible) {
          addDelay();
        }
      });
    });

    buckets.forEach((bucket) => {
      bucket.avgDelayCount =
        bucket.dateCount > 0 ? bucket.delayCount / bucket.dateCount : 0;
      bucket.avgDelayMin =
        bucket.delayCount > 0
          ? bucket.weightedDelay / bucket.delayCount / 60
          : null;
    });

    return buckets;
  };

  const setImpactMode = (mode: WeatherImpactMode) => {
    impactMode = mode;
    const isActive = impactMode !== "none";
    impactPanel.hidden = !isActive;
    directionDropdown.hidden =
      impactMode !== "weather-impact" &&
      impactMode !== "delay-duration-distribution" &&
      impactMode !== "weekdays-distribution";
    aggregateCheckbox.parentElement?.toggleAttribute(
      "hidden",
      impactMode === "weekdays-distribution",
    );
    scatterContainer.classList.toggle(
      "is-station-delay-chart",
      impactMode === "worst-best-stations",
    );
    scatterContainer.classList.toggle(
      "is-delay-duration-distribution",
      impactMode === "delay-duration-distribution",
    );
    scatterContainer.classList.toggle(
      "is-weekday-distribution",
      impactMode === "weekdays-distribution",
    );
    document.body.classList.toggle("weather-impact-active", isActive);
    document.body.classList.toggle(
      "weather-best-worst-active",
      impactMode === "worst-best-stations",
    );
    options.onStationHoverChange?.(null);
    drawImpactVisualization();
    window.requestAnimationFrame(() => {
      syncStationFilterHeight();
      document.dispatchEvent(new CustomEvent("weather-impact-layout-change"));
    });
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

  const showStationDelayAddedTooltip = (
    event: MouseEvent,
    datum: StationDelayAddedDatum,
  ) => {
    const stationLine = document.createElement("div");
    stationLine.textContent = datum.station.name;

    const delayLine = document.createElement("div");
    delayLine.textContent = `delay added: ${formatSignedMinutes(
      datum.delayAddedMin,
    )}`;

    const incomingLine = document.createElement("div");
    incomingLine.textContent = `incoming avg: ${formatOptionalMinutes(
      datum.incomingAvgDelayMin,
    )}`;

    const outgoingLine = document.createElement("div");
    outgoingLine.textContent = `outgoing avg: ${formatOptionalMinutes(
      datum.outgoingAvgDelayMin,
    )}`;

    const countLine = document.createElement("div");
    countLine.textContent = `observations: ${datum.entriesCount.toLocaleString(
      "de-DE",
    )}`;

    tooltip
      .node()
      ?.replaceChildren(
        stationLine,
        delayLine,
        incomingLine,
        outgoingLine,
        countLine,
      );
    tooltip
      .style("display", "block")
      .style("left", `${event.pageX + 10}px`)
      .style("top", `${event.pageY + 10}px`)
      .style("background", COLORS.TOOLTIP.BACKGROUND);
  };

  const showDelayDurationBinTooltip = (
    event: MouseEvent,
    datum: DelayDurationBin,
  ) => {
    const durationLine = document.createElement("div");
    durationLine.textContent = `${datum.min.toFixed(0)}-${datum.max.toFixed(
      0,
    )} min`;

    const countLine = document.createElement("div");
    countLine.textContent = `section count: ${datum.count.toLocaleString(
      "de-DE",
    )}`;

    tooltip.node()?.replaceChildren(durationLine, countLine);
    tooltip
      .style("display", "block")
      .style("left", `${event.pageX + 10}px`)
      .style("top", `${event.pageY + 10}px`)
      .style("background", COLORS.TOOLTIP.BACKGROUND);
  };

  const showWeekdayDistributionTooltip = (
    event: MouseEvent,
    datum: WeekdayDistributionDatum,
  ) => {
    const weekdayLine = document.createElement("div");
    weekdayLine.textContent = datum.label;

    const countLine = document.createElement("div");
    countLine.textContent = `avg delays per day: ${datum.avgDelayCount.toLocaleString(
      "de-DE",
      { maximumFractionDigits: 1 },
    )}`;

    const totalCountLine = document.createElement("div");
    totalCountLine.textContent = `total delays: ${datum.delayCount.toLocaleString(
      "de-DE",
    )} over ${datum.dateCount.toLocaleString("de-DE")} day${
      datum.dateCount === 1 ? "" : "s"
    }`;

    const avgDelayLine = document.createElement("div");
    avgDelayLine.textContent = `avg delay: ${
      datum.avgDelayMin === null ? "N/A" : `${datum.avgDelayMin.toFixed(1)} min`
    }`;

    tooltip
      .node()
      ?.replaceChildren(weekdayLine, countLine, totalCountLine, avgDelayLine);
    tooltip
      .style("display", "block")
      .style("left", `${event.pageX + 10}px`)
      .style("top", `${event.pageY + 10}px`)
      .style("background", COLORS.TOOLTIP.BACKGROUND);
  };

  const setImpactStationHighlight = (stationEva: number | null) => {
    highlightedImpactStationEva = stationEva;

    const containerSelection = d3.select(scatterContainer);

    containerSelection
      .selectAll<SVGCircleElement, WeatherImpactDatum>(
        "circle.weather-impact-point",
      )
      .classed(
        "is-highlighted",
        (datum) => datum.station.eva === highlightedImpactStationEva,
      )
      .filter((datum) => datum.station.eva === highlightedImpactStationEva)
      .raise();

    containerSelection
      .selectAll<SVGGElement, StationDelayAddedDatum>(
        "g.weather-station-delay-row",
      )
      .classed(
        "is-highlighted",
        (datum) => datum.station.eva === highlightedImpactStationEva,
      )
      .filter((datum) => datum.station.eva === highlightedImpactStationEva)
      .raise();
  };

  const drawImpactScatter = () => {
    scatterContainer.setAttribute("aria-label", "Weather impact scatter plot");
    scatterContainer.style.setProperty(
      "--weather-impact-point-color",
      WEATHER_TIMELINE_COLORS.delayCount,
    );
    const data = getWeatherImpactData();
    scatterContainer.replaceChildren();

    const width = Math.max(
      260,
      visualizationLayoutWidth(scatterContainer, 520),
    );
    const availableHeight = panelAvailableVisualizationHeight(260, 520);
    const height = Math.max(260, Math.min(availableHeight, 440));
    scatterContainer.style.height = `${height}px`;

    if (data.length === 0) {
      const empty = document.createElement("div");
      empty.className = "weather-impact-empty";
      empty.textContent = "No connection delay data for the current selection.";
      scatterContainer.append(empty);
      return;
    }

    const isCompact = width < 520 || height < 340;
    const margin = isCompact
      ? { top: 30, right: 24, bottom: 62, left: 64 }
      : { top: 36, right: 32, bottom: 76, left: 78 };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);

    const xExtent = d3.extent(data, (d) => d.weatherValue);
    let xMin = xExtent[0] ?? 0;
    let xMax = xExtent[1] ?? 1;

    if (Math.abs(xMax - xMin) < 0.1) {
      xMin -= 1;
      xMax += 1;
    }

    const yMax = d3.max(data, (d) => d.avgDelayMin) ?? 1;
    const delayCountMax = d3.max(data, (d) => d.delayCount) ?? 1;
    const baseXScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .nice(6)
      .range([0, innerWidth]);
    let xScale = baseXScale.copy();
    const yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .nice(6)
      .range([innerHeight, 0]);
    const radiusScale = d3
      .scaleSqrt()
      .domain([1, delayCountMax])
      .range(isCompact ? [3, 12] : [4, 18]);

    const svgElement = d3
      .select(scatterContainer)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "weather-impact-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("display", "block");

    const clipId = "weather-impact-scatter-clip";
    appendImpactClipPath(svgElement, clipId, innerWidth, innerHeight);

    const chart = svgElement
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const zoomSurface = appendImpactZoomSurface(
      chart,
      innerWidth,
      innerHeight,
    );

    chart
      .append("g")
      .attr("class", "weather-impact-grid")
      .call(
        d3
          .axisLeft(yScale)
          .ticks(isCompact ? 4 : 5)
          .tickSize(-innerWidth)
          .tickFormat(() => ""),
      )
      .call((axis) => axis.select(".domain").remove());

    const xAxisG = chart
      .append("g")
      .attr("class", "weather-impact-axis")
      .attr("transform", `translate(0, ${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(isCompact ? 4 : 6));

    chart
      .append("g")
      .attr("class", "weather-impact-axis")
      .call(d3.axisLeft(yScale).ticks(isCompact ? 4 : 5));

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

    if (!isCompact) {
      chart
        .append("text")
        .attr("class", "weather-impact-note")
        .attr("x", innerWidth)
        .attr("y", -10)
        .attr("text-anchor", "end")
        .text("point = station, size = delay count");
    }

    const pointsG = chart
      .append("g")
      .attr("class", "weather-impact-points")
      .attr("clip-path", `url(#${clipId})`);

    const points = pointsG
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
        setImpactStationHighlight(d.station.eva);
        options.onStationHoverChange?.(d.station.eva);
        showImpactTooltip(event, d);
      })
      .on("mousemove", (event, d) => {
        showImpactTooltip(event, d);
      })
      .on("mouseleave", function () {
        setImpactStationHighlight(null);
        options.onStationHoverChange?.(null);
        tooltip.style("display", "none");
      });

    const renderZoomedChart = (transform: d3.ZoomTransform) => {
      xScale = transform.rescaleX(baseXScale);

      xAxisG.call(d3.axisBottom(xScale).ticks(isCompact ? 4 : 6));
      points.attr("cx", (d) => xScale(d.weatherValue));
    };

    addImpactChartZoom(
      chart,
      zoomSurface,
      "weather-impact",
      innerWidth,
      innerHeight,
      Math.max(1, Math.min(28, data.length)),
      renderZoomedChart,
    );
  };

  const drawWorstBestStations = () => {
    scatterContainer.setAttribute(
      "aria-label",
      "Worst and best stations by delay added",
    );
    scatterContainer.style.setProperty(
      "--weather-station-delay-best-color",
      WEATHER_TIMELINE_COLORS.delayCount,
    );
    const data = getStationDelayAddedData();
    scatterContainer.replaceChildren();

    const width = Math.max(
      280,
      visualizationLayoutWidth(scatterContainer, 620),
    );

    if (data.length === 0) {
      scatterContainer.style.height = "260px";
      const empty = document.createElement("div");
      empty.className = "weather-impact-empty";
      empty.textContent = "No station delay data for the current selection.";
      scatterContainer.append(empty);
      return;
    }

    const isCompactWidth = width < 560;
    const rowStep = isCompactWidth ? 18 : 20;
    const availableHeight = panelAvailableVisualizationHeight(280, 560);
    const desiredHeight = 94 + data.length * rowStep;
    const height = Math.max(280, Math.min(availableHeight, desiredHeight));
    scatterContainer.style.height = `${height}px`;

    const xExtent = d3.extent(data, (d) => d.delayAddedMin);
    let xMin = Math.min(0, xExtent[0] ?? -1);
    let xMax = Math.max(0, xExtent[1] ?? 1);

    if (Math.abs(xMax - xMin) < 0.1) {
      xMin -= 1;
      xMax += 1;
    }

    const domainPadding = Math.max(0.6, (xMax - xMin) * 0.08);
    xMin -= domainPadding;
    xMax += domainPadding;

    const isCompact = width < 560 || height < 380;
    const margin = isCompact
      ? { top: 48, right: 72, bottom: 42, left: 46 }
      : { top: 54, right: 90, bottom: 46, left: 54 };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);

    const baseXScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .nice(isCompact ? 4 : 6)
      .range([0, innerWidth]);
    let xScale = baseXScale.copy();
    const yScale = d3
      .scaleBand<string>()
      .domain(data.map((d) => `${d.station.eva}`))
      .range([0, innerHeight])
      .padding(0.18);
    let zeroX = xScale(0);

    const svgElement = d3
      .select(scatterContainer)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "weather-impact-svg weather-station-delay-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("display", "block");

    const clipId = "weather-station-delay-clip";
    appendImpactClipPath(svgElement, clipId, innerWidth, innerHeight);

    const chart = svgElement
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const zoomSurface = appendImpactZoomSurface(
      chart,
      innerWidth,
      innerHeight,
    );

    const xAxis = d3
      .axisTop(xScale)
      .ticks(isCompact ? 4 : 6)
      .tickFormat((value) => formatSignedMinutes(Number(value)));

    const gridG = chart
      .append("g")
      .attr("class", "weather-impact-grid weather-station-delay-grid")
      .call(
        d3
          .axisTop(xScale)
          .ticks(isCompact ? 4 : 6)
          .tickSize(-innerHeight)
          .tickFormat(() => ""),
      )
      .call((axis) => axis.select(".domain").remove());

    const xAxisG = chart
      .append("g")
      .attr("class", "weather-impact-axis weather-station-delay-axis")
      .call(xAxis);

    const zeroLine = chart
      .append("line")
      .attr("class", "weather-station-delay-zero")
      .attr("x1", zeroX)
      .attr("x2", zeroX)
      .attr("y1", 0)
      .attr("y2", innerHeight);

    chart
      .append("text")
      .attr("class", "weather-impact-title")
      .attr("x", 0)
      .attr("y", -30)
      .text("Worst / Best Stations");

    chart
      .append("text")
      .attr("class", "weather-impact-note")
      .attr("x", innerWidth)
      .attr("y", -30)
      .attr("text-anchor", "end")
      .text(impactAggregate ? "selected range" : "selected day");

    chart
      .append("text")
      .attr("class", "weather-impact-axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 34)
      .attr("text-anchor", "middle")
      .text("Delay added (min)");

    const rowsG = chart
      .append("g")
      .attr("class", "weather-station-delay-rows")
      .attr("clip-path", `url(#${clipId})`);

    const rows = rowsG
      .selectAll<SVGGElement, StationDelayAddedDatum>("g")
      .data(data, (d) => `${d.station.eva}`)
      .join("g")
      .attr("class", "weather-station-delay-row")
      .classed(
        "is-highlighted",
        (d) => d.station.eva === highlightedImpactStationEva,
      )
      .attr(
        "transform",
        (d) => `translate(0, ${yScale(`${d.station.eva}`) ?? 0})`,
      )
      .on("mouseenter", function (event, d) {
        setImpactStationHighlight(d.station.eva);
        options.onStationHoverChange?.(d.station.eva);
        showStationDelayAddedTooltip(event, d);
      })
      .on("mousemove", (event, d) => {
        showStationDelayAddedTooltip(event, d);
      })
      .on("mouseleave", function () {
        setImpactStationHighlight(null);
        options.onStationHoverChange?.(null);
        tooltip.style("display", "none");
      });

    const bars = rows
      .append("rect")
      .attr("class", (d) =>
        d.delayAddedMin < 0
          ? "weather-station-delay-bar is-best"
          : "weather-station-delay-bar is-worst",
      )
      .attr("x", (d) => Math.min(zeroX, xScale(d.delayAddedMin)))
      .attr("y", 0)
      .attr("width", (d) => Math.abs(xScale(d.delayAddedMin) - zeroX))
      .attr("height", yScale.bandwidth())
      .attr("rx", 2);

    const stationLabels = rows
      .append("text")
      .attr("class", "weather-station-delay-station-label")
      .attr("x", (d) => (d.delayAddedMin < 0 ? zeroX + 9 : zeroX - 9))
      .attr("y", yScale.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", (d) => (d.delayAddedMin < 0 ? "start" : "end"))
      .text((d) => d.station.name);

    const valueLabels = rows
      .append("text")
      .attr("class", "weather-station-delay-value-label")
      .attr("x", (d) =>
        d.delayAddedMin < 0
          ? xScale(d.delayAddedMin) - 7
          : xScale(d.delayAddedMin) + 7,
      )
      .attr("y", yScale.bandwidth() / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", (d) => (d.delayAddedMin < 0 ? "end" : "start"))
      .text((d) => formatSignedMinutes(d.delayAddedMin));

    const renderZoomedChart = (transform: d3.ZoomTransform) => {
      xScale = transform.rescaleX(baseXScale);
      zeroX = xScale(0);

      const nextAxis = d3
        .axisTop(xScale)
        .ticks(isCompact ? 4 : 6)
        .tickFormat((value) => formatSignedMinutes(Number(value)));

      gridG
        .call(
          d3
            .axisTop(xScale)
            .ticks(isCompact ? 4 : 6)
            .tickSize(-innerHeight)
            .tickFormat(() => ""),
        )
        .call((axis) => axis.select(".domain").remove());
      xAxisG.call(nextAxis);
      zeroLine.attr("x1", zeroX).attr("x2", zeroX);
      bars
        .attr("x", (d) => Math.min(zeroX, xScale(d.delayAddedMin)))
        .attr("width", (d) => Math.abs(xScale(d.delayAddedMin) - zeroX));
      stationLabels
        .attr("x", (d) => (d.delayAddedMin < 0 ? zeroX + 9 : zeroX - 9))
        .attr("text-anchor", (d) =>
          d.delayAddedMin < 0 ? "start" : "end",
        );
      valueLabels.attr("x", (d) =>
        d.delayAddedMin < 0
          ? xScale(d.delayAddedMin) - 7
          : xScale(d.delayAddedMin) + 7,
      );
    };

    addImpactChartZoom(
      chart,
      zoomSurface,
      "worst-best-stations",
      innerWidth,
      innerHeight,
      Math.max(1, Math.min(24, data.length)),
      renderZoomedChart,
    );
  };

  const drawDelayDurationDistribution = () => {
    scatterContainer.setAttribute("aria-label", "Delay duration distribution");
    const data = getDelayDurationDistributionData();
    scatterContainer.replaceChildren();

    const width = Math.max(
      280,
      visualizationLayoutWidth(scatterContainer, 620),
    );
    const availableHeight = panelAvailableVisualizationHeight(280, 540);
    const height = Math.max(280, Math.min(availableHeight, 440));
    scatterContainer.style.height = `${height}px`;

    if (!data || data.bins.length === 0 || data.totalCount <= 0) {
      const empty = document.createElement("div");
      empty.className = "weather-impact-empty";
      empty.textContent = "No delay duration data for the current selection.";
      scatterContainer.append(empty);
      return;
    }

    const isCompact = width < 560 || height < 360;
    const margin = isCompact
      ? { top: 48, right: 28, bottom: 58, left: 62 }
      : { top: 54, right: 34, bottom: 70, left: 76 };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);
    const xMax = data.bins.at(-1)?.max ?? delayDurationBinSizeMin;
    const yMax = d3.max(data.bins, (bin) => bin.count) ?? 1;
    const baseXScale = d3
      .scaleLinear()
      .domain([0, xMax])
      .range([0, innerWidth]);
    let xScale = baseXScale.copy();
    const yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .nice(isCompact ? 4 : 5)
      .range([innerHeight, 0]);

    const svgElement = d3
      .select(scatterContainer)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "weather-impact-svg weather-delay-duration-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("display", "block");

    const clipId = "weather-delay-duration-clip";
    appendImpactClipPath(svgElement, clipId, innerWidth, innerHeight);

    const chart = svgElement
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const zoomSurface = appendImpactZoomSurface(
      chart,
      innerWidth,
      innerHeight,
    );

    chart
      .append("g")
      .attr("class", "weather-impact-grid weather-delay-duration-grid")
      .call(
        d3
          .axisLeft(yScale)
          .ticks(isCompact ? 4 : 5)
          .tickSize(-innerWidth)
          .tickFormat(() => ""),
      )
      .call((axis) => axis.select(".domain").remove());

    const xAxisG = chart
      .append("g")
      .attr("class", "weather-impact-axis")
      .attr("transform", `translate(0, ${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(isCompact ? 4 : 6));

    chart
      .append("g")
      .attr("class", "weather-impact-axis")
      .call(
        d3
          .axisLeft(yScale)
          .ticks(isCompact ? 4 : 5)
          .tickFormat((value) => d3.format("~s")(Number(value))),
      );

    chart
      .append("text")
      .attr("class", "weather-impact-title")
      .attr("x", 0)
      .attr("y", -30)
      .text("Delay Duration Distribution");

    chart
      .append("text")
      .attr("class", "weather-impact-note")
      .attr("x", innerWidth)
      .attr("y", -30)
      .attr("text-anchor", "end")
      .text(
        `${impactDirection} - ${impactAggregate ? "selected range" : "selected day"} - ${data.totalCount.toLocaleString(
          "de-DE",
        )} sections`,
      );

    chart
      .append("text")
      .attr("class", "weather-impact-axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 48)
      .attr("text-anchor", "middle")
      .text("Delay duration (min)");

    chart
      .append("text")
      .attr("class", "weather-impact-axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2)
      .attr("y", -44)
      .attr("text-anchor", "middle")
      .text("Section count");

    const bars = chart
      .append("g")
      .attr("class", "weather-delay-duration-bars")
      .attr("clip-path", `url(#${clipId})`)
      .selectAll<SVGRectElement, DelayDurationBin>("rect")
      .data(data.bins.filter((bin) => bin.count > 0))
      .join("rect")
      .attr("class", "weather-delay-duration-bar")
      .style("fill", WEATHER_TIMELINE_COLORS.avgDelay)
      .attr("x", (bin) => xScale(bin.min))
      .attr("y", (bin) => yScale(bin.count))
      .attr("width", (bin) =>
        Math.max(1, xScale(bin.max) - xScale(bin.min) - 1),
      )
      .attr("height", (bin) => innerHeight - yScale(bin.count))
      .attr("rx", 1)
      .on("mouseenter", function (event, bin) {
        d3.select(this).classed("is-highlighted", true);
        showDelayDurationBinTooltip(event, bin);
      })
      .on("mousemove", (event, bin) => {
        showDelayDurationBinTooltip(event, bin);
      })
      .on("mouseleave", function () {
        d3.select(this).classed("is-highlighted", false);
        tooltip.style("display", "none");
      });

    let previousPercentileX = -Infinity;
    let labelStack = 0;
    const percentileLabels = data.percentiles.map((percentile) => {
      const x = xScale(percentile.value);

      if (x - previousPercentileX < 24) {
        labelStack += 1;
      } else {
        labelStack = 0;
      }

      previousPercentileX = x;

      return {
        ...percentile,
        x,
        y: 16 + (labelStack % 3) * 15,
      };
    });

    const percentileGroups = chart
      .append("g")
      .attr("class", "weather-delay-duration-percentiles")
      .attr("clip-path", `url(#${clipId})`)
      .selectAll<SVGGElement, (typeof percentileLabels)[number]>("g")
      .data(percentileLabels)
      .join("g")
      .attr("class", "weather-delay-duration-percentile")
      .attr("transform", (percentile) => `translate(${percentile.x}, 0)`);

    percentileGroups
      .append("line")
      .attr("class", "weather-delay-duration-percentile-line")
      .attr("y1", 0)
      .attr("y2", innerHeight);

    percentileGroups
      .append("text")
      .attr("class", "weather-delay-duration-percentile-label")
      .attr("x", 4)
      .attr("y", (percentile) => percentile.y)
      .text((percentile) => percentile.label);

    const renderZoomedChart = (transform: d3.ZoomTransform) => {
      xScale = transform.rescaleX(baseXScale);

      xAxisG.call(d3.axisBottom(xScale).ticks(isCompact ? 4 : 6));
      bars
        .attr("x", (bin) => xScale(bin.min))
        .attr("width", (bin) =>
          Math.max(1, xScale(bin.max) - xScale(bin.min) - 1),
        );
      percentileGroups.attr(
        "transform",
        (percentile) => `translate(${xScale(percentile.value)}, 0)`,
      );
    };

    addImpactChartZoom(
      chart,
      zoomSurface,
      "delay-duration-distribution",
      innerWidth,
      innerHeight,
      Math.max(1, Math.min(40, data.bins.length)),
      renderZoomedChart,
    );
  };

  const drawWeekdayDistribution = () => {
    scatterContainer.setAttribute(
      "aria-label",
      "Weekdays distribution of delays",
    );
    const data = getWeekdayDistributionData();
    scatterContainer.replaceChildren();

    const width = Math.max(
      280,
      visualizationLayoutWidth(scatterContainer, 620),
    );
    const availableHeight = panelAvailableVisualizationHeight(280, 540);
    const height = Math.max(280, Math.min(availableHeight, 440));
    scatterContainer.style.height = `${height}px`;

    const totalDelayCount = d3.sum(data, (datum) => datum.delayCount);

    if (totalDelayCount <= 0) {
      const empty = document.createElement("div");
      empty.className = "weather-impact-empty";
      empty.textContent = "No weekday delay data for the current selection.";
      scatterContainer.append(empty);
      return;
    }

    const isCompact = width < 560 || height < 360;
    const margin = isCompact
      ? { top: 52, right: 62, bottom: 70, left: 68 }
      : { top: 58, right: 78, bottom: 78, left: 82 };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);
    const countMax = d3.max(data, (datum) => datum.avgDelayCount) ?? 1;
    const delayMax = d3.max(data, (datum) => datum.avgDelayMin ?? 0) ?? 1;
    const baseXScale = d3
      .scaleLinear()
      .domain([-0.45, Math.max(1, data.length - 1) + 0.45])
      .range([0, innerWidth]);
    let xScale = baseXScale.copy();
    const yCountScale = d3
      .scaleLinear()
      .domain([0, countMax])
      .nice(isCompact ? 4 : 5)
      .range([innerHeight, 0]);
    const yDelayScale = d3
      .scaleLinear()
      .domain([0, delayMax])
      .nice(isCompact ? 4 : 5)
      .range([innerHeight, 0]);
    const xForDatum = (datum: WeekdayDistributionDatum) =>
      xScale(datum.index);

    const countLine = d3
      .line<WeekdayDistributionDatum>()
      .x(xForDatum)
      .y((datum) => yCountScale(datum.avgDelayCount));
    const delayLine = d3
      .line<WeekdayDistributionDatum>()
      .defined((datum) => datum.avgDelayMin !== null)
      .x(xForDatum)
      .y((datum) => yDelayScale(datum.avgDelayMin ?? 0));

    const svgElement = d3
      .select(scatterContainer)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("class", "weather-impact-svg weather-weekday-distribution-svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("display", "block");

    const clipId = "weather-weekday-distribution-clip";
    appendImpactClipPath(svgElement, clipId, innerWidth, innerHeight);

    const chart = svgElement
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const zoomSurface = appendImpactZoomSurface(
      chart,
      innerWidth,
      innerHeight,
    );

    const visibleWeekdayTicks = () =>
      data
        .filter((datum) => {
          const x = xScale(datum.index);
          return x >= 0 && x <= innerWidth;
        })
        .map((datum) => datum.index);

    const xAxis = d3
      .axisBottom<number>(xScale)
      .tickValues(visibleWeekdayTicks())
      .tickFormat((value) => data[Number(value)]?.label ?? "");

    chart
      .append("g")
      .attr("class", "weather-impact-grid weather-weekday-grid")
      .call(
        d3
          .axisLeft(yCountScale)
          .ticks(isCompact ? 4 : 5)
          .tickSize(-innerWidth)
          .tickFormat(() => ""),
      )
      .call((axis) => axis.select(".domain").remove());

    const xAxisG = chart
      .append("g")
      .attr("class", "weather-impact-axis")
      .attr("transform", `translate(0, ${innerHeight})`)
      .call(xAxis);

    chart
      .append("g")
      .attr("class", "weather-impact-axis weather-weekday-count-axis")
      .call(
        d3
          .axisLeft(yCountScale)
          .ticks(isCompact ? 4 : 5)
          .tickFormat((value) => d3.format("~s")(Number(value))),
      );

    chart
      .append("g")
      .attr("class", "weather-impact-axis weather-weekday-delay-axis")
      .attr("transform", `translate(${innerWidth}, 0)`)
      .call(
        d3
          .axisRight(yDelayScale)
          .ticks(isCompact ? 4 : 5)
          .tickFormat((value) => Number(value).toFixed(1)),
      );

    chart
      .append("text")
      .attr("class", "weather-impact-title")
      .attr("x", 0)
      .attr("y", -32)
      .text("Weekdays Distribution");

    chart
      .append("text")
      .attr("class", "weather-impact-note")
      .attr("x", innerWidth)
      .attr("y", -32)
      .attr("text-anchor", "end")
      .text(`${impactDirection} - selected range`);

    chart
      .append("text")
      .attr("class", "weather-impact-axis-label")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 50)
      .attr("text-anchor", "middle")
      .text("Day of week");

    chart
      .append("text")
      .attr("class", "weather-impact-axis-label weather-weekday-count-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2)
      .attr("y", -48)
      .attr("text-anchor", "middle")
      .text("Avg delays per day");

    chart
      .append("text")
      .attr("class", "weather-impact-axis-label weather-weekday-delay-label")
      .attr("transform", "rotate(90)")
      .attr("x", innerHeight / 2)
      .attr("y", -innerWidth - 52)
      .attr("text-anchor", "middle")
      .text("Avg delay (min)");

    const legend = chart
      .append("g")
      .attr("class", "weather-weekday-legend")
      .attr("transform", `translate(0, ${innerHeight + 66})`);

    legend
      .append("line")
      .attr("class", "weather-weekday-line is-count")
      .attr("x1", 0)
      .attr("x2", 18)
      .attr("y1", 0)
      .attr("y2", 0);
    legend
      .append("text")
      .attr("x", 24)
      .attr("y", 0)
      .attr("dy", "0.35em")
      .text("avg delays per day");
    legend
      .append("line")
      .attr("class", "weather-weekday-line is-delay")
      .attr("x1", 172)
      .attr("x2", 190)
      .attr("y1", 0)
      .attr("y2", 0);
    legend
      .append("text")
      .attr("x", 196)
      .attr("y", 0)
      .attr("dy", "0.35em")
      .text("avg delay");

    const countPath = chart
      .append("path")
      .datum(data)
      .attr("class", "weather-weekday-line is-count")
      .attr("clip-path", `url(#${clipId})`)
      .attr("d", countLine);

    const delayPath = chart
      .append("path")
      .datum(data)
      .attr("class", "weather-weekday-line is-delay")
      .attr("clip-path", `url(#${clipId})`)
      .attr("d", delayLine);

    const pointGroups = chart
      .append("g")
      .attr("class", "weather-weekday-points")
      .attr("clip-path", `url(#${clipId})`);

    const countPoints = pointGroups
      .selectAll<SVGCircleElement, WeekdayDistributionDatum>("circle.count")
      .data(data)
      .join("circle")
      .attr(
        "class",
        (datum) => `weather-weekday-point is-count weekday-${datum.index}`,
      )
      .attr("cx", xForDatum)
      .attr("cy", (datum) => yCountScale(datum.avgDelayCount))
      .attr("r", 4);

    const delayPoints = pointGroups
      .selectAll<SVGCircleElement, WeekdayDistributionDatum>("circle.delay")
      .data(data.filter((datum) => datum.avgDelayMin !== null))
      .join("circle")
      .attr(
        "class",
        (datum) => `weather-weekday-point is-delay weekday-${datum.index}`,
      )
      .attr("cx", xForDatum)
      .attr("cy", (datum) => yDelayScale(datum.avgDelayMin ?? 0))
      .attr("r", 4);

    const hoverWidth = Math.max(28, innerWidth / data.length);

    const hoverTargets = chart
      .append("g")
      .attr("class", "weather-weekday-hover-targets")
      .attr("clip-path", `url(#${clipId})`)
      .selectAll<SVGRectElement, WeekdayDistributionDatum>("rect")
      .data(data)
      .join("rect")
      .attr("class", "weather-weekday-hover-target")
      .attr("x", (datum) => xForDatum(datum) - hoverWidth / 2)
      .attr("y", 0)
      .attr("width", hoverWidth)
      .attr("height", innerHeight)
      .on("mouseenter", function (event, datum) {
        chart
          .selectAll(`.weekday-${datum.index}`)
          .classed("is-highlighted", true);
        showWeekdayDistributionTooltip(event, datum);
      })
      .on("mousemove", (event, datum) => {
        showWeekdayDistributionTooltip(event, datum);
      })
      .on("mouseleave", function (event, datum) {
        chart
          .selectAll(`.weekday-${datum.index}`)
          .classed("is-highlighted", false);
        tooltip.style("display", "none");
      });

    const renderZoomedChart = (transform: d3.ZoomTransform) => {
      xScale = transform.rescaleX(baseXScale);

      const nextXAxis = d3
        .axisBottom<number>(xScale)
        .tickValues(visibleWeekdayTicks())
        .tickFormat((value) => data[Number(value)]?.label ?? "");

      xAxisG.call(nextXAxis);
      countPath.attr("d", countLine);
      delayPath.attr("d", delayLine);
      countPoints.attr("cx", xForDatum);
      delayPoints.attr("cx", xForDatum);
      hoverTargets.attr("x", (datum) => xForDatum(datum) - hoverWidth / 2);
    };

    addImpactChartZoom(
      chart,
      zoomSurface,
      "weekdays-distribution",
      innerWidth,
      innerHeight,
      Math.max(1, data.length),
      renderZoomedChart,
    );
  };

  const drawImpactVisualization = () => {
    if (impactMode === "weather-impact") {
      drawImpactScatter();
      return;
    }

    if (impactMode === "worst-best-stations") {
      drawWorstBestStations();
      return;
    }

    if (impactMode === "delay-duration-distribution") {
      drawDelayDurationDistribution();
      return;
    }

    if (impactMode === "weekdays-distribution") {
      drawWeekdayDistribution();
      return;
    }

    scatterContainer.replaceChildren();
  };

  if (typeof ResizeObserver !== "undefined") {
    let scatterResizeFrame: number | null = null;
    const scatterResizeObserver = new ResizeObserver(() => {
      if (scatterResizeFrame !== null) {
        window.cancelAnimationFrame(scatterResizeFrame);
      }

      scatterResizeFrame = window.requestAnimationFrame(() => {
        scatterResizeFrame = null;
        drawImpactVisualization();
      });
    });
    scatterResizeObserver.observe(scatterContainer);
  }

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
      -(TIMELINE_AXIS_PLOT_GAP + TIMELINE_AXIS_COLUMN_STEP * 2),
      "cm",
      WEATHER_TIMELINE_COLORS.snow_depth,
      formatVal,
    );
    drawLeftAxisColumn(
      leftAxesG,
      ticksPrecip,
      yScalePrecip,
      -(TIMELINE_AXIS_PLOT_GAP + TIMELINE_AXIS_COLUMN_STEP),
      "mm",
      WEATHER_TIMELINE_COLORS.precipitation,
      formatVal,
    );
    drawLeftAxisColumn(
      leftAxesG,
      ticksTemp,
      yScaleTemp,
      -TIMELINE_AXIS_PLOT_GAP,
      "°C",
      WEATHER_TIMELINE_COLORS.temperature_2m,
      formatVal,
    );

    const rightAxesG = chartSvg.append("g").attr("class", "y-axes-right");
    drawRightAxisColumn(
      rightAxesG,
      ticksCount,
      yScaleCount,
      innerWidth + TIMELINE_AXIS_PLOT_GAP,
      "count",
      WEATHER_TIMELINE_COLORS.delayCount,
      formatVal,
    );
    drawRightAxisColumn(
      rightAxesG,
      ticksDelay,
      yScaleDelay,
      innerWidth + TIMELINE_AXIS_PLOT_GAP + TIMELINE_AXIS_COLUMN_STEP,
      "min",
      WEATHER_TIMELINE_COLORS.avgDelay,
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
      .attr("fill", WEATHER_TIMELINE_COLORS.delayCount)
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
      .attr("fill", WEATHER_TIMELINE_COLORS.avgDelay)
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
      .attr("stroke", WEATHER_TIMELINE_COLORS.precipitation)
      .attr("stroke-width", 1.8);
    const snowLine = linesG
      .append("path")
      .datum(chartData)
      .attr("fill", "none")
      .attr("stroke", WEATHER_TIMELINE_COLORS.snow_depth)
      .attr("stroke-width", 1.8);
    const tempLine = linesG
      .append("path")
      .datum(chartData)
      .attr("fill", "none")
      .attr("stroke", WEATHER_TIMELINE_COLORS.temperature_2m)
      .attr("stroke-width", 1.8);

    const precipPoints = pointsG
      .selectAll<SVGCircleElement, WeatherChartDatum>("circle.precip-point")
      .data(chartData.filter((d) => Number.isFinite(d.precip)))
      .join("circle")
      .attr("class", "precip-point")
      .attr("cy", (d) => yScalePrecip(d.precip))
      .attr("r", 3.2)
      .attr("fill", WEATHER_TIMELINE_COLORS.precipitation);
    const snowPoints = pointsG
      .selectAll<SVGCircleElement, WeatherChartDatum>("circle.snow-point")
      .data(chartData.filter((d) => Number.isFinite(d.snow)))
      .join("circle")
      .attr("class", "snow-point")
      .attr("cy", (d) => yScaleSnow(d.snow))
      .attr("r", 3.2)
      .attr("fill", WEATHER_TIMELINE_COLORS.snow_depth);
    const tempPoints = pointsG
      .selectAll<SVGCircleElement, WeatherChartDatum>("circle.temp-point")
      .data(chartData.filter((d) => Number.isFinite(d.temp)))
      .join("circle")
      .attr("class", "temp-point")
      .attr("cy", (d) => yScaleTemp(d.temp))
      .attr("r", 3.2)
      .attr("fill", WEATHER_TIMELINE_COLORS.temperature_2m);

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
      .attr("fill", WEATHER_TIMELINE_COLORS.temperature_2m)
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1.5);
    const hCirclePrecip = hoverCirclesG
      .append("circle")
      .attr("r", 5.5)
      .attr("fill", WEATHER_TIMELINE_COLORS.precipitation)
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1.5);
    const hCircleSnow = hoverCirclesG
      .append("circle")
      .attr("r", 5.5)
      .attr("fill", WEATHER_TIMELINE_COLORS.snow_depth)
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
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${WEATHER_TIMELINE_COLORS.temperature_2m};"></span>
            <span>temperature: <strong>${d.temp.toFixed(1)} °C</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${WEATHER_TIMELINE_COLORS.precipitation};"></span>
            <span>precipitation: <strong>${d.precip.toFixed(1)} mm</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${WEATHER_TIMELINE_COLORS.snow_depth};"></span>
            <span>snowfall: <strong>${d.snow.toFixed(1)} cm</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 5px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 5px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${WEATHER_TIMELINE_COLORS.delayCount};"></span>
            <span>delay count: <strong>${d.delaysCount}</strong></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${WEATHER_TIMELINE_COLORS.avgDelay};"></span>
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
    drawImpactVisualization();
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
      drawImpactVisualization();
    }
  });

  impactModeDropdown.addEventListener("change", (event: Event) => {
    const customEvent = event as CustomEvent<{ value: WeatherImpactMode }>;
    setImpactMode(customEvent.detail.value);
  });

  directionDropdown.addEventListener("change", (event: Event) => {
    const customEvent = event as CustomEvent<{ value: DelayDirection }>;
    impactDirection = customEvent.detail.value;
    drawImpactVisualization();
  });

  aggregateCheckbox.addEventListener("change", () => {
    impactAggregate = aggregateCheckbox.checked;
    drawImpactVisualization();
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
    impactVisualizationContainer: scatterContainer,
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
      drawImpactVisualization();
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
    drawImpactVisualization();
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
    drawImpactVisualization();
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
    drawImpactVisualization();
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
      setImpactStationHighlight(stationEva);
    },
    updateData: (visibleStations, focusedState, dailyDelayTrips) => {
      currentVisibleStations = visibleStations;
      currentVisibleStationNames = new Set(
        visibleStations.map((station) => station.name),
      );
      currentFocusedState = focusedState;
      currentDailyDelayTrips = dailyDelayTrips;
      drawTimelineChart();
      drawImpactVisualization();
    },
  };
}
