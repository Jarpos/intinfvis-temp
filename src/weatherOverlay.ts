import * as d3 from "d3";

import { COLORS } from "./colors";
import { HEIGHT, WIDTH, tooltip } from "./config";
import {
  TEMPERATURE_RANGE,
  buildTemperatureCells,
  displayedTemperature,
  loadHistoricalTemperatures,
  temperatureBand,
  temperatureColor,
  temperatureLegendStops,
  toDateInputValue,
} from "./data/weather";
import type {
  TemperatureCell,
  WeatherDataset,
  WeatherHour,
} from "./data/weather";
import { geojson, projection } from "./data/geo";

type WeatherOverlay = {
  layer: d3.Selection<SVGGElement, undefined, null, undefined>;
  status: HTMLDivElement;
  slider: HTMLInputElement;
  sliderWrap: HTMLDivElement;
  timeLabel: HTMLButtonElement;
  stepMarks: HTMLDivElement;
  timeBubble: HTMLDivElement;
  currentCells: TemperatureCell[];
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

function injectOverlayStyles() {
  const style = document.createElement("style");
  style.textContent = `
        html,
        body {
            margin: 0;
            min-height: 100%;
            overflow: hidden;
            background: #18221d;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        svg {
            display: block;
        }

        .weather-panel {
            position: fixed;
            left: 16px;
            top: 16px;
            z-index: 10;
            display: grid;
            gap: 8px;
            width: min(230px, calc(100vw - 32px));
            color: #f7fbff;
            pointer-events: none;
        }

        .weather-chip,
        .weather-legend,
        .weather-timeline {
            background: rgba(18, 28, 24, 0.78);
            border: 1px solid rgba(255, 255, 255, 0.14);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
            backdrop-filter: blur(10px);
        }

        .weather-chip {
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 34px;
            padding: 0 12px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 700;
        }

        .weather-chip span:last-child {
            color: rgba(247, 251, 255, 0.62);
            font-size: 12px;
            font-weight: 600;
        }

        .weather-legend {
            width: 56px;
            padding: 10px 9px;
            border-radius: 6px;
        }

        .weather-legend-title {
            margin-bottom: 7px;
            color: rgba(247, 251, 255, 0.82);
            font-size: 12px;
            font-weight: 700;
            text-align: center;
        }

        .weather-legend-scale {
            display: grid;
            grid-template-columns: 16px 1fr;
            gap: 8px;
            align-items: stretch;
            height: 260px;
        }

        .weather-gradient {
            border-radius: 4px;
            background: linear-gradient(to top, ${temperatureLegendStops.join(", ")});
        }

        .weather-ticks {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            color: rgba(247, 251, 255, 0.86);
            font-size: 11px;
            line-height: 1;
        }

        .weather-timeline {
            position: fixed;
            right: calc(20rem + 24px);
            bottom: 18px;
            left: 24px;
            z-index: 5;
            display: grid;
            gap: 5px;
            padding: 9px 44px 15px;
            border-radius: 7px;
            color: #f7fbff;
        }

        .weather-timeline-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 18px;
            gap: 16px;
            color: rgba(247, 251, 255, 0.78);
            font-size: 12px;
            font-weight: 700;
        }

        .weather-time {
            width: 120px;
            border: 0;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.14);
            color: #f7fbff;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0;
            line-height: 1;
            padding: 3px 5px;
            color-scheme: dark;
            cursor: pointer;
            text-align: center;
        }

        .weather-time:disabled {
            cursor: wait;
            opacity: 0.68;
        }

        .weather-calendar {
            position: fixed;
            z-index: 30;
            width: 306px;
            padding: 14px;
            border: 1px solid rgba(255, 255, 255, 0.22);
            border-radius: 8px;
            background: rgba(24, 28, 27, 0.98);
            color: #f7fbff;
            box-shadow: 0 18px 44px rgba(0, 0, 0, 0.44);
        }

        .weather-calendar[hidden] {
            display: none;
        }

        .weather-calendar-header {
            display: grid;
            grid-template-columns: 34px 1fr 34px;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
        }

        .weather-calendar-month {
            justify-self: center;
            padding: 6px 10px;
            border: 1px solid rgba(255, 255, 255, 0.28);
            border-radius: 5px;
            color: rgba(247, 251, 255, 0.92);
            font-size: 15px;
            font-weight: 800;
        }

        .weather-calendar-nav,
        .weather-calendar-day {
            border: 0;
            color: #f7fbff;
            font: inherit;
            cursor: pointer;
        }

        .weather-calendar-nav {
            width: 34px;
            height: 34px;
            border-radius: 5px;
            background: rgba(255, 255, 255, 0.08);
            font-size: 22px;
            line-height: 1;
        }

        .weather-calendar-nav:disabled,
        .weather-calendar-day:disabled {
            cursor: default;
            opacity: 0.34;
        }

        .weather-calendar-weekdays,
        .weather-calendar-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 6px;
        }

        .weather-calendar-weekdays {
            margin-bottom: 6px;
            color: rgba(247, 251, 255, 0.58);
            font-size: 12px;
            font-weight: 800;
            text-align: center;
        }

        .weather-calendar-day {
            height: 34px;
            border-radius: 5px;
            background: rgba(255, 255, 255, 0.08);
            font-size: 14px;
            font-weight: 700;
        }

        .weather-calendar-day.is-weekend {
            color: #ff6969;
        }

        .weather-calendar-day.is-outside {
            color: rgba(247, 251, 255, 0.36);
        }

        .weather-calendar-day.is-selected {
            background: #0b65d8;
            color: #ffffff;
            box-shadow: 0 0 0 2px #5da2ff;
        }

        .weather-status {
            color: rgba(247, 251, 255, 0.72);
            font-size: 12px;
            text-align: left;
        }

        .weather-slider-wrap {
            position: relative;
            display: grid;
            gap: 0;
            min-width: 0;
            height: 58px;
            padding-top: 19px;
        }

        .weather-slider {
            position: relative;
            z-index: 4;
            width: 100%;
            height: 20px;
            margin: 0;
            appearance: none;
            -webkit-appearance: none;
            background: transparent;
            cursor: pointer;
        }

        .weather-slider::-webkit-slider-runnable-track {
            height: 20px;
            background: transparent;
            border: 0;
        }

        .weather-slider::-webkit-slider-thumb {
            appearance: none;
            -webkit-appearance: none;
            width: 4px;
            height: 26px;
            margin-top: -3px;
            border: 0;
            border-radius: 2px;
            background: #ff7a16;
            box-shadow: 0 0 0 1px rgba(18, 28, 24, 0.6), 0 0 0 3px rgba(255, 122, 22, 0.14);
        }

        .weather-slider::-moz-range-track {
            height: 20px;
            background: transparent;
            border: 0;
        }

        .weather-slider::-moz-range-thumb {
            width: 4px;
            height: 26px;
            border: 0;
            border-radius: 2px;
            background: #ff7a16;
            box-shadow: 0 0 0 1px rgba(18, 28, 24, 0.6), 0 0 0 3px rgba(255, 122, 22, 0.14);
        }

        .weather-step-marks {
            position: relative;
            height: 34px;
            margin-top: -7px;
            color: rgba(247, 251, 255, 0.86);
            font-size: 11px;
            border-top: 2px solid rgba(255, 255, 255, 0.74);
        }

        .weather-hour-tick {
            position: absolute;
            top: 0;
            width: 1px;
            height: 8px;
            background: rgba(255, 255, 255, 0.56);
            transform: translateX(-50%);
        }

        .weather-hour-tick.is-six-hour {
            height: 14px;
            background: rgba(255, 255, 255, 0.78);
        }

        .weather-hour-tick.is-noon {
            height: 22px;
            width: 2px;
            background: rgba(255, 255, 255, 0.95);
        }

        .weather-day-label {
            position: absolute;
            top: 25px;
            transform: translateX(-50%);
            display: grid;
            gap: 1px;
            min-width: 78px;
            color: #f7fbff;
            font-size: 12px;
            font-weight: 800;
            line-height: 1.05;
            text-align: center;
            white-space: nowrap;
        }

        .weather-day-label small {
            color: rgba(247, 251, 255, 0.78);
            font-size: 10px;
            font-weight: 700;
        }

        .weather-date-label {
            top: 25px;
            min-width: 126px;
            pointer-events: auto;
        }

        .weather-time-bubble {
            position: absolute;
            left: var(--weather-progress, 50%);
            top: 0;
            z-index: 5;
            min-width: 52px;
            padding: 4px 8px;
            border-radius: 5px;
            background: rgba(18, 28, 24, 0.96);
            border: 1px solid rgba(255, 255, 255, 0.18);
            color: #ffffff;
            font-size: 14px;
            font-weight: 800;
            line-height: 1;
            text-align: center;
            transform: translateX(-50%);
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.36);
            pointer-events: none;
        }

        .weather-time-bubble::after {
            content: "";
            position: absolute;
            left: 50%;
            bottom: -6px;
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 6px solid rgba(18, 28, 24, 0.96);
            transform: translateX(-50%);
        }

        .weather-contour {
            pointer-events: none;
        }

        .weather-cell {
            shape-rendering: crispEdges;
            pointer-events: none;
        }

        @media (max-width: 720px) {
            .weather-panel {
                left: 10px;
                top: 10px;
                width: 170px;
            }

            .weather-legend {
                width: 50px;
            }

            .weather-legend-scale {
                height: 190px;
            }

            .weather-timeline {
                left: 10px;
                right: 10px;
                bottom: 10px;
                padding: 8px 14px 10px;
            }

            .weather-timeline-meta {
                font-size: 11px;
            }

            .weather-day-label {
                font-size: 10px;
                min-width: 62px;
            }

            .weather-date-label {
                min-width: 110px;
            }

            .weather-time {
                width: 104px;
                font-size: 10px;
            }

            .weather-calendar {
                width: min(306px, calc(100vw - 24px));
            }
        }
    `;

  document.head.append(style);
}

function createLegend() {
  const panel = document.createElement("div");
  panel.className = "weather-panel";

  const model = document.createElement("div");
  model.className = "weather-chip";
  model.innerHTML = "<span>DWD ICON-D2</span><span>historic</span>";

  const variable = document.createElement("div");
  variable.className = "weather-chip";
  variable.innerHTML = "<span>Temperature</span><span>2 m</span>";

  const legend = document.createElement("div");
  legend.className = "weather-legend";
  legend.innerHTML = `
        <div class="weather-legend-title">°C</div>
        <div class="weather-legend-scale">
            <div class="weather-gradient"></div>
            <div class="weather-ticks">
                <span>50</span>
                <span>40</span>
                <span>30</span>
                <span>20</span>
                <span>10</span>
                <span>0</span>
                <span>-10</span>
                <span>-20</span>
                <span>-30</span>
                <span>-40</span>
            </div>
        </div>
    `;

  panel.append(model, variable, legend);
  document.body.append(panel);
}

function createTimeline() {
  const timeline = document.createElement("div");
  timeline.className = "weather-timeline";

  const meta = document.createElement("div");
  meta.className = "weather-timeline-meta";

  const utcLabel = document.createElement("div");
  utcLabel.textContent = "UTC+02:00 Europe/Berlin";

  const timeLabel = document.createElement("button");
  timeLabel.className = "weather-time";
  timeLabel.type = "button";
  timeLabel.textContent = formatGermanDate(new Date());
  timeLabel.disabled = true;

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

  return { status, slider, sliderWrap, timeLabel, stepMarks, timeBubble };
}

function formatGermanDate(date: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function formatGermanMonth(date: Date) {
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function createGermanCalendar() {
  const calendar = document.createElement("div");
  calendar.className = "weather-calendar";
  calendar.hidden = true;
  calendar.addEventListener("click", (event) => event.stopPropagation());
  document.body.append(calendar);

  return calendar;
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

function updateStepMarks(
  container: HTMLDivElement,
  hours: WeatherHour[],
  selectedDate: Date,
  datePicker: HTMLButtonElement,
) {
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
    const isSelectedDate = sameCalendarDate(date, selectedDate);

    if (isSelectedDate) {
      const pickerWrap = document.createElement("div");
      pickerWrap.className = "weather-day-label weather-date-label";
      pickerWrap.style.left = `${hourPosition(index, hours)}%`;
      pickerWrap.append(datePicker);
      container.append(pickerWrap);
      return;
    }

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

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function isBeforeDate(left: Date, right: Date) {
  return (
    new Date(left.getFullYear(), left.getMonth(), left.getDate()).getTime() <
    new Date(right.getFullYear(), right.getMonth(), right.getDate()).getTime()
  );
}

function isAfterDate(left: Date, right: Date) {
  return (
    new Date(left.getFullYear(), left.getMonth(), left.getDate()).getTime() >
    new Date(right.getFullYear(), right.getMonth(), right.getDate()).getTime()
  );
}

function positionCalendar(calendar: HTMLDivElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  const top = rect.top - calendar.offsetHeight - 10;
  const left = rect.left + rect.width / 2 - calendar.offsetWidth / 2;

  calendar.style.top = `${Math.max(10, top)}px`;
  calendar.style.left = `${Math.min(
    window.innerWidth - calendar.offsetWidth - 10,
    Math.max(10, left),
  )}px`;
}

function renderGermanCalendar(
  calendar: HTMLDivElement,
  visibleMonth: Date,
  selectedDate: Date,
  onVisibleMonthChange: (date: Date) => void,
  onDateSelected: (date: Date) => void,
) {
  const minDate = new Date(2022, 0, 1);
  const maxDate = new Date();
  const start = monthStart(visibleMonth);
  const mondayOffset = (start.getDay() + 6) % 7;
  const gridStart = addDays(start, -mondayOffset);
  const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  calendar.replaceChildren();

  const header = document.createElement("div");
  header.className = "weather-calendar-header";

  const previous = document.createElement("button");
  previous.className = "weather-calendar-nav";
  previous.type = "button";
  previous.textContent = "‹";
  previous.disabled = !isAfterDate(start, minDate);
  previous.addEventListener("click", () => {
    onVisibleMonthChange(addMonths(visibleMonth, -1));
  });

  const month = document.createElement("div");
  month.className = "weather-calendar-month";
  month.textContent = formatGermanMonth(visibleMonth);

  const next = document.createElement("button");
  next.className = "weather-calendar-nav";
  next.type = "button";
  next.textContent = "›";
  next.disabled = !isBeforeDate(start, monthStart(maxDate));
  next.addEventListener("click", () => {
    onVisibleMonthChange(addMonths(visibleMonth, 1));
  });

  header.append(previous, month, next);

  const weekdayRow = document.createElement("div");
  weekdayRow.className = "weather-calendar-weekdays";
  weekdays.forEach((weekday) => {
    const label = document.createElement("span");
    label.textContent = weekday;
    weekdayRow.append(label);
  });

  const grid = document.createElement("div");
  grid.className = "weather-calendar-grid";

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const day = document.createElement("button");
    day.className = "weather-calendar-day";
    day.type = "button";
    day.textContent = `${date.getDate()}`;

    if (date.getMonth() !== visibleMonth.getMonth()) {
      day.classList.add("is-outside");
    }

    if (date.getDay() === 0 || date.getDay() === 6) {
      day.classList.add("is-weekend");
    }

    if (sameCalendarDate(date, selectedDate)) {
      day.classList.add("is-selected");
    }

    day.disabled = isBeforeDate(date, minDate) || isAfterDate(date, maxDate);
    day.addEventListener("click", () => onDateSelected(noonForDate(date)));
    grid.append(day);
  }

  calendar.append(header, weekdayRow, grid);
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

function hourIndexFromPointer(event: MouseEvent, element: HTMLElement, hours: WeatherHour[]) {
  const rect = element.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return Math.round(ratio * (hours.length - 1));
}

function renderHour(
  overlay: WeatherOverlay,
  dataset: WeatherDataset,
  index: number,
) {
  const hour = dataset.hours[index];
  const cells = buildTemperatureCells(dataset, hour);
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
      displayedTemperature(d.temperature).toFixed(1),
    )
    .attr("data-temperature-band", (d) => `${temperatureBand(d.temperature)}`)
    .attr("opacity", 1);

  overlay.status.textContent = `${formatTime.format(hour.time).replace(",", "")} · ${dataset.points.length} samples`;
}

function bindTooltip(
  layer: d3.Selection<SVGGElement, undefined, null, undefined>,
  overlay: WeatherOverlay,
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
      const temperature = cell?.temperature;

      if (typeof temperature === "number" && Number.isFinite(temperature)) {
        tooltip
          .style("display", "block")
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY + 10}px`)
          .style("background", COLORS.TOOLTIP.BACKGROUND)
          .text(`${displayedTemperature(temperature).toFixed(1)} °C`);
      } else {
        tooltip.style("display", "none");
      }
    })
    .on("mouseleave", () => tooltip.style("display", "none"));
}

export async function appendWeatherOverlay(
  g: d3.Selection<SVGGElement, undefined, null, undefined>,
) {
  injectOverlayStyles();
  createLegend();

  const controls = createTimeline();
  const calendar = createGermanCalendar();
  let selectedDate = noonForDate(new Date());
  let visibleCalendarMonth = monthStart(selectedDate);
  let activeDataset: WeatherDataset | null = null;
  let selectedHourIndex = 0;
  let renderedHourIndex = -1;
  let previewHourIndex: number | null = null;
  const svg = g.node()?.ownerSVGElement;
  const clipId = "weather-germany-clip";

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
    .datum(geojson)
    .attr("d", d3.geoPath(projection))
    .attr("fill", "none")
    .attr("stroke", "rgba(255, 255, 255, 0.58)")
    .attr("stroke-width", 0.8)
    .attr("pointer-events", "none");

  const loadAndRender = async (selectedDate: Date) => {
    controls.slider.disabled = true;
    controls.timeLabel.disabled = true;
    controls.status.textContent = "Fetching Open-Meteo";

    const dataset = await loadHistoricalTemperatures(selectedDate);

    if (dataset.hours.length === 0) {
      throw new Error("No historic hourly temperatures returned");
    }

    controls.slider.disabled = false;
    controls.timeLabel.disabled = false;
    controls.timeLabel.textContent = formatGermanDate(dataset.selectedDate);
    controls.slider.max = `${dataset.hours.length - 1}`;
    activeDataset = dataset;
    selectedHourIndex = closestHourIndex(
      dataset.hours,
      selectedDateTargetTime(dataset.selectedDate),
    );
    previewHourIndex = null;
    renderedHourIndex = -1;
    controls.slider.value = `${selectedHourIndex}`;
    updateStepMarks(
      controls.stepMarks,
      dataset.hours,
      dataset.selectedDate,
      controls.timeLabel,
    );

    renderHour(overlay, dataset, selectedHourIndex);
    renderedHourIndex = selectedHourIndex;
  };

  bindTooltip(layer, overlay);

  const previewHour = (index: number) => {
    if (!activeDataset || index === renderedHourIndex) {
      return;
    }

    previewHourIndex = index;
    controls.slider.value = `${index}`;
    renderHour(overlay, activeDataset, index);
    renderedHourIndex = index;
  };

  const commitHour = (index: number) => {
    if (!activeDataset) {
      return;
    }

    selectedHourIndex = index;
    previewHourIndex = null;
    controls.slider.value = `${index}`;
    renderHour(overlay, activeDataset, index);
    renderedHourIndex = index;
  };

  const restoreSelectedHour = () => {
    if (!activeDataset || previewHourIndex === null) {
      return;
    }

    previewHourIndex = null;
    controls.slider.value = `${selectedHourIndex}`;
    renderHour(overlay, activeDataset, selectedHourIndex);
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

    commitHour(hourIndexFromPointer(event, controls.stepMarks, activeDataset.hours));
  });
  controls.slider.addEventListener("input", () => {
    previewHour(Number(controls.slider.value));
  });
  controls.slider.addEventListener("change", () => {
    commitHour(Number(controls.slider.value));
  });
  controls.sliderWrap.addEventListener("mouseleave", restoreSelectedHour);
  document.addEventListener("mousemove", restoreWhenPointerLeavesRuler);

  const showCalendar = () => {
    renderGermanCalendar(
      calendar,
      visibleCalendarMonth,
      selectedDate,
      (nextMonth) => {
        visibleCalendarMonth = nextMonth;
        showCalendar();
      },
      (nextDate) => {
        calendar.hidden = true;
        selectedDate = nextDate;
        visibleCalendarMonth = monthStart(nextDate);
        loadAndRender(nextDate).catch((error) => {
          controls.timeLabel.disabled = false;
          controls.status.textContent =
            error instanceof Error ? error.message : "Could not load weather";
        });
      },
    );
    calendar.hidden = false;
    positionCalendar(calendar, controls.timeLabel);
  };

  controls.timeLabel.addEventListener("click", (event) => {
    event.stopPropagation();
    if (calendar.hidden) {
      showCalendar();
    } else {
      calendar.hidden = true;
    }
  });

  document.addEventListener("click", () => {
    calendar.hidden = true;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      calendar.hidden = true;
    }
  });

  try {
    await loadAndRender(selectedDate);
  } catch (error) {
    controls.timeLabel.disabled = false;
    controls.status.textContent =
      error instanceof Error ? error.message : "Could not load weather";

    layer
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", WIDTH)
      .attr("height", HEIGHT)
      .attr("fill", "rgba(15, 25, 21, 0.18)");
  }
}
