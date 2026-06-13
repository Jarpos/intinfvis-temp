import * as d3 from "d3";

import { COLORS } from "./colors";
import { HEIGHT, WIDTH, tooltip } from "./config";
import {
  TEMPERATURE_RANGE,
  buildTemperatureContours,
  loadHistoricalTemperatures,
  temperatureColor,
} from "./data/weather";
import type { WeatherDataset, WeatherHour } from "./data/weather";
import { geojson, projection } from "./data/geo";

type WeatherOverlay = {
  layer: d3.Selection<SVGGElement, undefined, null, undefined>;
  status: HTMLDivElement;
  slider: HTMLInputElement;
  timeLabel: HTMLDivElement;
  stepMarks: HTMLDivElement;
};

type TemperatureContour = GeoJSON.MultiPolygon & { value?: number };

const formatTime = new Intl.DateTimeFormat("de-ID", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
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
            background: linear-gradient(
                to top,
                ${temperatureColor(TEMPERATURE_RANGE[0])},
                ${temperatureColor(-5)},
                ${temperatureColor(8)},
                ${temperatureColor(18)},
                ${temperatureColor(28)},
                ${temperatureColor(TEMPERATURE_RANGE[1])}
            );
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
            right: 24px;
            bottom: 22px;
            left: 24px;
            z-index: 10;
            display: grid;
            grid-template-columns: minmax(112px, 0.18fr) 1fr minmax(128px, 0.18fr);
            gap: 16px;
            align-items: center;
            padding: 13px 16px;
            border-radius: 7px;
            color: #f7fbff;
        }

        .weather-time {
            font-size: 19px;
            font-weight: 800;
            letter-spacing: 0;
            white-space: nowrap;
        }

        .weather-status {
            color: rgba(247, 251, 255, 0.72);
            font-size: 12px;
            text-align: right;
        }

        .weather-slider-wrap {
            display: grid;
            gap: 7px;
            min-width: 0;
        }

        .weather-slider {
            width: 100%;
            accent-color: #ffcc00;
            cursor: pointer;
        }

        .weather-step-marks {
            position: relative;
            height: 16px;
            color: rgba(247, 251, 255, 0.66);
            font-size: 11px;
        }

        .weather-step-marks span {
            position: absolute;
            top: 0;
            transform: translateX(-50%);
            white-space: nowrap;
        }

        .weather-contour {
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
                grid-template-columns: 1fr;
                gap: 8px;
                padding: 10px 12px;
            }

            .weather-time,
            .weather-status {
                text-align: left;
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
                <span>45</span>
                <span>30</span>
                <span>15</span>
                <span>0</span>
                <span>-10</span>
                <span>-20</span>
            </div>
        </div>
    `;

  panel.append(model, variable, legend);
  document.body.append(panel);
}

function createTimeline() {
  const timeline = document.createElement("div");
  timeline.className = "weather-timeline";

  const timeLabel = document.createElement("div");
  timeLabel.className = "weather-time";
  timeLabel.textContent = "Loading";

  const sliderWrap = document.createElement("div");
  sliderWrap.className = "weather-slider-wrap";

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

  timeline.append(timeLabel, sliderWrap, status);
  document.body.append(timeline);

  return { status, slider, timeLabel, stepMarks };
}

function updateStepMarks(container: HTMLDivElement, hours: WeatherHour[]) {
  const marks = [0, 0.25, 0.5, 0.75, 1];
  container.replaceChildren();

  marks.forEach((ratio) => {
    const index = Math.round(ratio * (hours.length - 1));
    const mark = document.createElement("span");
    mark.style.left = `${ratio * 100}%`;
    mark.textContent =
      ratio === 1
        ? "Now"
        : formatTime.format(hours[index].time).replace(",", "");
    container.append(mark);
  });
}

function renderHour(
  overlay: WeatherOverlay,
  dataset: WeatherDataset,
  index: number,
) {
  const hour = dataset.hours[index];
  const contours = buildTemperatureContours(dataset, hour);
  const path = d3.geoPath();

  overlay.layer
    .selectAll<SVGPathElement, TemperatureContour>("path")
    .data(contours)
    .join("path")
    .attr("class", "weather-contour")
    .attr("d", path)
    .attr("fill", (d) => temperatureColor(d.value ?? 0))
    .attr(
      "stroke",
      (d) =>
        d3
          .color(temperatureColor(d.value ?? 0))
          ?.darker(0.45)
          .formatHex() ?? "transparent",
    )
    .attr("stroke-width", 0.25)
    .attr("opacity", 0.62);

  overlay.timeLabel.textContent = formatTime.format(hour.time).replace(",", "");
  overlay.status.textContent = `Historic data only · ${dataset.points.length} samples`;
}

function bindTooltip(
  layer: d3.Selection<SVGGElement, undefined, null, undefined>,
  dataset: WeatherDataset,
  currentIndex: () => number,
) {
  const projectedPoints = dataset.points
    .map((point, index) => ({
      index,
      projected: projection([point.longitude, point.latitude]),
    }))
    .filter(
      (item): item is { index: number; projected: [number, number] } =>
        item.projected !== null,
    );

  layer
    .on("mousemove", (event) => {
      const [x, y] = d3.pointer(event, layer.node());
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      projectedPoints.forEach(({ index, projected }) => {
        const distance = (x - projected[0]) ** 2 + (y - projected[1]) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });

      const temperature = dataset.hours[currentIndex()]?.values[bestIndex];

      if (Number.isFinite(temperature)) {
        tooltip
          .style("display", "block")
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY + 10}px`)
          .style("background", COLORS.TOOLTIP.BACKGROUND)
          .text(`${temperature.toFixed(1)} °C`);
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

  const overlay: WeatherOverlay = { layer, ...controls };

  try {
    const dataset = await loadHistoricalTemperatures();

    if (dataset.hours.length === 0) {
      throw new Error("No historic hourly temperatures returned");
    }

    controls.slider.disabled = false;
    controls.slider.max = `${dataset.hours.length - 1}`;
    controls.slider.value = `${dataset.hours.length - 1}`;
    updateStepMarks(controls.stepMarks, dataset.hours);

    const getIndex = () => Number(controls.slider.value);

    controls.slider.addEventListener("input", () => {
      renderHour(overlay, dataset, getIndex());
    });

    renderHour(overlay, dataset, getIndex());
    bindTooltip(layer, dataset, getIndex);
  } catch (error) {
    controls.timeLabel.textContent = "Unavailable";
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
