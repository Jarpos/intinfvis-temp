import * as d3 from "d3";

import { HEIGHT, WIDTH } from "../config";
import { projection } from "./geo";

const API_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast";
const GRID_COLUMNS = 7;
const GRID_ROWS = 8;
const CONTOUR_CELL_SIZE = 16;

export type WeatherPoint = {
  name: string;
  latitude: number;
  longitude: number;
};

export type WeatherHour = {
  time: Date;
  label: string;
  temperature_2m: number[];
  precipitation: number[];
  snow_depth: number[];
};

export type WeatherDataset = {
  points: WeatherPoint[];
  hours: WeatherHour[];
  fromDate: Date;
  toDate: Date;
  selectedDate: Date;
};

export type WeatherDateRange = {
  from: Date;
  to: Date;
  selected?: Date;
};

export type TemperatureCell = {
  x: number;
  y: number;
  size: number;
  temperature: number;
  rawValue: number;
};

export const TEMPERATURE_RANGE = [-40, 50] as const;

export interface WeatherVariableConfig {
  key: "temperature_2m" | "precipitation" | "snow_depth";
  label: string;
  unit: string;
  min: number;
  max: number;
  ticks: number[];
}

export const WEATHER_VARIABLES: Record<
  "temperature_2m" | "precipitation" | "snow_depth",
  WeatherVariableConfig
> = {
  temperature_2m: {
    key: "temperature_2m",
    label: "Temperature",
    unit: "°C",
    min: -40,
    max: 50,
    ticks: [50, 40, 30, 20, 10, 0, -10, -20, -30, -40],
  },
  precipitation: {
    key: "precipitation",
    label: "Precipitation",
    unit: "mm",
    min: 0,
    max: 10,
    ticks: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  },
  snow_depth: {
    key: "snow_depth",
    label: "Snow Depth",
    unit: "m",
    min: 0,
    max: 1,
    ticks: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0],
  },
};

export function mapValueToRamp(
  value: number,
  config: WeatherVariableConfig,
): number {
  const clamped = Math.max(config.min, Math.min(config.max, value));
  return -40 + ((clamped - config.min) / (config.max - config.min)) * 90;
}

const temperatureRamp = d3
  .scaleLinear<string>()
  .domain([-40, -30, -20, -10, 0, 4, 10, 20, 30, 40, 50])
  .range([
    "#6b3fc6",
    "#2765d4",
    "#1f8fc9",
    "#20c8c4",
    "#8fd5d5",
    "#4ac75f",
    "#0daa23",
    "#9ac700",
    "#d6b500",
    "#d95d18",
    "#bc1f2d",
  ])
  .clamp(true);

export const displayedTemperature = (temperature: number) =>
  Math.round(temperature * 10) / 10;

export const temperatureBand = (temperature: number) =>
  Math.round(displayedTemperature(temperature));

export const temperatureColor = (temperature: number) =>
  temperatureRamp(temperatureBand(temperature));

export const temperatureLegendStops = d3
  .range(TEMPERATURE_RANGE[0], TEMPERATURE_RANGE[1] + 1, 1)
  .flatMap((temperature) => {
    const start =
      ((temperature - TEMPERATURE_RANGE[0]) /
        (TEMPERATURE_RANGE[1] - TEMPERATURE_RANGE[0] + 1)) *
      100;
    const end =
      ((temperature - TEMPERATURE_RANGE[0] + 1) /
        (TEMPERATURE_RANGE[1] - TEMPERATURE_RANGE[0] + 1)) *
      100;
    const color = temperatureColor(temperature);

    return [`${color} ${start}%`, `${color} ${end}%`];
  });

export const contourThresholds = d3.range(
  TEMPERATURE_RANGE[0],
  TEMPERATURE_RANGE[1] + 1,
  1,
);

//Replaced the dynamic calculation of coordinates in buildWeatherGrid (which parsed a 5MB GeoJSON and executed 56 d3.geoContains checks on highly complex polygons at runtime) with a static array containing the 25 precomputed coordinates that fall inside Germany.
const PRECOMPUTED_WEATHER_POINTS: WeatherPoint[] = [
  {
    name: "48.38, 8.93",
    latitude: 48.382240299066346,
    longitude: 8.92711702982596,
  },
  {
    name: "48.38, 10.45",
    latitude: 48.382240299066346,
    longitude: 10.454865932464685,
  },
  {
    name: "48.38, 11.98",
    latitude: 48.382240299066346,
    longitude: 11.982614835103409,
  },
  {
    name: "49.49, 7.40",
    latitude: 49.49462128416791,
    longitude: 7.399368127187235,
  },
  {
    name: "49.49, 8.93",
    latitude: 49.49462128416791,
    longitude: 8.92711702982596,
  },
  {
    name: "49.49, 10.45",
    latitude: 49.49462128416791,
    longitude: 10.454865932464685,
  },
  {
    name: "49.49, 11.98",
    latitude: 49.49462128416791,
    longitude: 11.982614835103409,
  },
  {
    name: "50.61, 7.40",
    latitude: 50.60700226926947,
    longitude: 7.399368127187235,
  },
  {
    name: "50.61, 8.93",
    latitude: 50.60700226926947,
    longitude: 8.92711702982596,
  },
  {
    name: "50.61, 10.45",
    latitude: 50.60700226926947,
    longitude: 10.454865932464685,
  },
  {
    name: "50.61, 11.98",
    latitude: 50.60700226926947,
    longitude: 11.982614835103409,
  },
  {
    name: "51.72, 7.40",
    latitude: 51.71938325437103,
    longitude: 7.399368127187235,
  },
  {
    name: "51.72, 8.93",
    latitude: 51.71938325437103,
    longitude: 8.92711702982596,
  },
  {
    name: "51.72, 10.45",
    latitude: 51.71938325437103,
    longitude: 10.454865932464685,
  },
  {
    name: "51.72, 11.98",
    latitude: 51.71938325437103,
    longitude: 11.982614835103409,
  },
  {
    name: "51.72, 13.51",
    latitude: 51.71938325437103,
    longitude: 13.510363737742136,
  },
  {
    name: "52.83, 7.40",
    latitude: 52.83176423947259,
    longitude: 7.399368127187235,
  },
  {
    name: "52.83, 8.93",
    latitude: 52.83176423947259,
    longitude: 8.92711702982596,
  },
  {
    name: "52.83, 10.45",
    latitude: 52.83176423947259,
    longitude: 10.454865932464685,
  },
  {
    name: "52.83, 11.98",
    latitude: 52.83176423947259,
    longitude: 11.982614835103409,
  },
  {
    name: "52.83, 13.51",
    latitude: 52.83176423947259,
    longitude: 13.510363737742136,
  },
  {
    name: "53.94, 8.93",
    latitude: 53.94414522457416,
    longitude: 8.92711702982596,
  },
  {
    name: "53.94, 10.45",
    latitude: 53.94414522457416,
    longitude: 10.454865932464685,
  },
  {
    name: "53.94, 11.98",
    latitude: 53.94414522457416,
    longitude: 11.982614835103409,
  },
  {
    name: "53.94, 13.51",
    latitude: 53.94414522457416,
    longitude: 13.510363737742136,
  },
];

function buildWeatherGrid(): WeatherPoint[] {
  return PRECOMPUTED_WEATHER_POINTS;
}

export const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const endOfDay = (date: Date) => {
  const end = startOfDay(date);
  end.setHours(23, 59, 59, 999);
  return end;
};

const addDays = (date: Date, days: number) => {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfCurrentHour = () => {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  return date;
};

function getWeatherWindow(range: WeatherDateRange) {
  const currentHour = startOfCurrentHour();
  const selectedDay = startOfDay(range.selected ?? range.from);
  const rangeStart = startOfDay(range.from);
  const rangeEnd = startOfDay(range.to);
  const start = rangeStart <= rangeEnd ? rangeStart : rangeEnd;
  const requestedEnd = endOfDay(rangeStart <= rangeEnd ? rangeEnd : rangeStart);
  const end = requestedEnd > currentHour ? currentHour : requestedEnd;
  const requestStart = addDays(start, -1);

  return { start, end, requestStart, selectedDay };
}

function buildWeatherUrl(points: WeatherPoint[], range: WeatherDateRange) {
  const { requestStart, end } = getWeatherWindow(range);

  const params = new URLSearchParams({
    latitude: points.map((point) => point.latitude.toFixed(4)).join(","),
    longitude: points.map((point) => point.longitude.toFixed(4)).join(","),
    daily: "temperature_2m_mean,precipitation_sum,snowfall_sum",
    temperature_unit: "celsius",
    timezone: "Europe/Berlin",
    start_date: toDateInputValue(requestStart),
    end_date: toDateInputValue(end),
    models: "icon_d2",
  });

  return `${API_URL}?${params.toString()}`;
}

type OpenMeteoLocationResponse = {
  daily?: {
    time?: string[];
    temperature_2m_mean?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    snowfall_sum?: Array<number | null>;
  };
  reason?: string;
};

const normalizeResponses = (
  data: OpenMeteoLocationResponse | OpenMeteoLocationResponse[],
) => (Array.isArray(data) ? data : [data]);

export async function loadHistoricalTemperatures(
  range: WeatherDateRange = { from: new Date(), to: new Date() },
): Promise<WeatherDataset> {
  const points = buildWeatherGrid();
  const { start, end, selectedDay } = getWeatherWindow(range);
  const response = await fetch(buildWeatherUrl(points, range));

  if (!response.ok) {
    throw new Error(`Open-Meteo returned ${response.status}`);
  }

  const locations = normalizeResponses(
    (await response.json()) as
      | OpenMeteoLocationResponse
      | OpenMeteoLocationResponse[],
  );
  const failedLocation = locations.find((location) => location.reason);

  if (failedLocation?.reason) {
    throw new Error(failedLocation.reason);
  }

  const currentDay = startOfDay(startOfCurrentHour());
  const timeline = locations[0]?.daily?.time ?? [];
  const hours = timeline
    .map((label, timeIndex) => {
      const time = new Date(`${label}T12:00:00`);
      const temperature_2m = locations.map(
        (location) =>
          location.daily?.temperature_2m_mean?.[timeIndex] ?? Number.NaN,
      );
      const precipitation = locations.map(
        (location) =>
          location.daily?.precipitation_sum?.[timeIndex] ?? Number.NaN,
      );
      const snow_depth = locations.map(
        (location) => location.daily?.snowfall_sum?.[timeIndex] ?? Number.NaN,
      );
      return { time, label, temperature_2m, precipitation, snow_depth };
    })
    .filter(
      (hour) => {
        const day = startOfDay(hour.time);

        return (
          day >= start &&
          day <= end &&
          day <= currentDay &&
          (hour.temperature_2m.some(Number.isFinite) ||
            hour.precipitation.some(Number.isFinite) ||
            hour.snow_depth.some(Number.isFinite))
        );
      },
    );

  return {
    points,
    hours,
    fromDate: start,
    toDate: end,
    selectedDate: selectedDay,
  };
}

function interpolateTemperature(
  x: number,
  y: number,
  projectedPoints: Array<[number, number]>,
  temperatures: number[],
) {
  let weightedSum = 0;
  let totalWeight = 0;

  projectedPoints.forEach(([pointX, pointY], index) => {
    const temperature = temperatures[index];

    if (!Number.isFinite(temperature)) {
      return;
    }

    const distanceSquared = (x - pointX) ** 2 + (y - pointY) ** 2;

    if (distanceSquared < 1) {
      weightedSum = temperature;
      totalWeight = 1;
      return;
    }

    const weight = 1 / distanceSquared;
    weightedSum += temperature * weight;
    totalWeight += weight;
  });

  return totalWeight === 0 ? Number.NaN : weightedSum / totalWeight;
}

export function buildTemperatureContours(
  dataset: WeatherDataset,
  hour: WeatherHour,
) {
  const gridWidth = Math.ceil(WIDTH / CONTOUR_CELL_SIZE);
  const gridHeight = Math.ceil(HEIGHT / CONTOUR_CELL_SIZE);
  const projectedPoints = dataset.points
    .map((point) => projection([point.longitude, point.latitude]))
    .filter((point): point is [number, number] => point !== null);
  const values: number[] = [];

  for (let row = 0; row < gridHeight; row += 1) {
    for (let column = 0; column < gridWidth; column += 1) {
      const x = column * CONTOUR_CELL_SIZE;
      const y = row * CONTOUR_CELL_SIZE;
      values.push(
        interpolateTemperature(x, y, projectedPoints, hour.temperature_2m),
      );
    }
  }

  return d3
    .contours()
    .size([gridWidth, gridHeight])
    .thresholds(contourThresholds)(values)
    .map((contour) => ({
      ...contour,
      coordinates: contour.coordinates.map((polygon) =>
        polygon.map((ring) =>
          ring.map(([x, y]) => [x * CONTOUR_CELL_SIZE, y * CONTOUR_CELL_SIZE]),
        ),
      ),
    }));
}

export function buildTemperatureCells(
  dataset: WeatherDataset,
  hour: WeatherHour,
  variableKey:
    | "temperature_2m"
    | "precipitation"
    | "snow_depth" = "temperature_2m",
) {
  const gridWidth = Math.ceil(WIDTH / CONTOUR_CELL_SIZE);
  const gridHeight = Math.ceil(HEIGHT / CONTOUR_CELL_SIZE);
  const projectedPoints = dataset.points
    .map((point) => projection([point.longitude, point.latitude]))
    .filter((point): point is [number, number] => point !== null);
  const cells: TemperatureCell[] = [];

  const rawValues = hour[variableKey];
  const config = WEATHER_VARIABLES[variableKey];

  for (let row = 0; row < gridHeight; row += 1) {
    for (let column = 0; column < gridWidth; column += 1) {
      const x = column * CONTOUR_CELL_SIZE;
      const y = row * CONTOUR_CELL_SIZE;
      const rawValue = interpolateTemperature(
        x + CONTOUR_CELL_SIZE / 2,
        y + CONTOUR_CELL_SIZE / 2,
        projectedPoints,
        rawValues,
      );

      if (Number.isFinite(rawValue)) {
        const temperature = mapValueToRamp(rawValue, config);
        cells.push({ x, y, size: CONTOUR_CELL_SIZE, temperature, rawValue });
      }
    }
  }

  return cells;
}
