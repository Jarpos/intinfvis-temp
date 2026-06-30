import * as d3 from "d3";

import { COLORS } from "./colors";
import { HEIGHT, WIDTH, tooltip } from "./config";
import { DEFAULT_DATE_RANGE, SELECTED_DATE_CHANGE_EVENT } from "./dateSync";
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

type WeatherOverlay = {
  layer: d3.Selection<SVGGElement, undefined, null, undefined>;
  status: HTMLDivElement;
  slider: HTMLInputElement;
  sliderWrap: HTMLDivElement;
  stepMarks: HTMLDivElement;
  timeBubble: HTMLDivElement;
  currentCells: TemperatureCell[];
};

export type WeatherOverlayController = {
  showTooltipAtPoint: (event: MouseEvent, point: [number, number]) => boolean;
  hideTooltip: () => void;
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

  const model = document.createElement("div");
  model.className = "weather-chip";
  model.innerHTML = "<span>DWD ICON-D2</span><span>historic</span>";

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
  panel.append(model, dropdownContainer, legend);
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
        
        const changeEvent = new CustomEvent("change", { detail: { value: val } });
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
    span.textContent = config.key === "snow_depth" ? tickVal.toFixed(1) : tickVal.toFixed(0);
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

  const sliderWrap = document.createElement("div");
  sliderWrap.className = "weather-slider-wrap";

  const timeBubble = document.createElement("div");
  timeBubble.className = "weather-time-bubble";
  timeBubble.textContent = "00:00";

  const slider = document.createElement("input");
  slider.className = "weather-slider";
  slider.type = "range";
  slider.min = "0";
  slider.max = "0";
  slider.step = "1";
  slider.value = "0";
  slider.disabled = true;

  const stepMarks = document.createElement("div");
  stepMarks.className = "weather-step-marks";

  sliderWrap.append(slider, stepMarks);

  const status = document.createElement("div");
  status.className = "weather-status";
  status.textContent = "Fetching Open-Meteo";

  meta.append(utcLabel, status);
  sliderWrap.append(timeBubble, slider, stepMarks);
  timeline.append(meta, sliderWrap);
  document.body.append(timeline);

  return { status, slider, sliderWrap, stepMarks, timeBubble };
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

function renderHour(
  overlay: WeatherOverlay,
  dataset: WeatherDataset,
  index: number,
  variableKey: "temperature_2m" | "precipitation" | "snow_depth" = "temperature_2m",
) {
  const hour = dataset.hours[index];
  const cells = buildTemperatureCells(dataset, hour, variableKey);
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
    .attr("data-temperature", (d) =>
      d.rawValue.toFixed(1),
    )
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

      if (cell && typeof cell.rawValue === "number" && Number.isFinite(cell.rawValue)) {
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

export async function appendWeatherOverlay(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
): Promise<WeatherOverlayController> {
  const { dropdown, legendTitle, legendTicks } = createLegend();

  let activeVariableKey: "temperature_2m" | "precipitation" | "snow_depth" = "temperature_2m";
  updateLegend(legendTitle, legendTicks, WEATHER_VARIABLES[activeVariableKey]);

  const controls = createTimeline();
  let activeRange: WeatherDateRange = {
    from: DEFAULT_DATE_RANGE.from,
    to: DEFAULT_DATE_RANGE.to,
    selected: DEFAULT_DATE_RANGE.from,
  };
  let activeDataset: WeatherDataset | null = null;
  let selectedHourIndex = 0;
  let renderedHourIndex = -1;
  let previewHourIndex: number | null = null;
  let loadRequestId = 0;
  const svg = g.node()?.ownerSVGElement;
  const clipId = "weather-germany-clip";

  dropdown.addEventListener("change", (event: Event) => {
    const customEvent = event as CustomEvent<{ value: "temperature_2m" | "precipitation" | "snow_depth" }>;
    const val = customEvent.detail.value;
    if (WEATHER_VARIABLES[val]) {
      activeVariableKey = val;
      const config = WEATHER_VARIABLES[activeVariableKey];
      updateLegend(legendTitle, legendTicks, config);

      if (activeDataset && renderedHourIndex !== -1) {
        renderHour(overlay, activeDataset, renderedHourIndex, activeVariableKey);
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
    selectedHourIndex = closestHourIndex(
      dataset.hours,
      selectedDateTargetTime(dataset.selectedDate),
    );
    previewHourIndex = null;
    renderedHourIndex = -1;
    controls.slider.value = `${selectedHourIndex}`;
    updateStepMarks(controls.stepMarks, dataset.hours);

    renderHour(overlay, dataset, selectedHourIndex, activeVariableKey);
    renderedHourIndex = selectedHourIndex;
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
    activeRange = { ...activeRange, selected: hour.time };
    previewHourIndex = null;
    controls.slider.value = `${index}`;
    renderHour(overlay, activeDataset, index, activeVariableKey);
    renderedHourIndex = index;

    if (selectedDayChanged) {
      dispatchSelectedDateChange(activeRange, hour.time);
    }
  };

  const restoreSelectedHour = () => {
    if (!activeDataset || previewHourIndex === null) {
      return;
    }

    previewHourIndex = null;
    controls.slider.value = `${selectedHourIndex}`;
    renderHour(overlay, activeDataset, selectedHourIndex, activeVariableKey);
    renderedHourIndex = selectedHourIndex;
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
    const isInside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!isInside) {
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
  };
}
