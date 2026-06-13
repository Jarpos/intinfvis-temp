import * as d3 from "d3";

import { HEIGHT, WIDTH } from "../config";
import { geojson, projection } from "./geo";

const API_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast";
const HOURS_TO_LOAD = 72;
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
    values: number[];
};

export type WeatherDataset = {
    points: WeatherPoint[];
    hours: WeatherHour[];
};

export const TEMPERATURE_RANGE = [-20, 45] as const;

export const temperatureColor = d3
    .scaleSequential(d3.interpolateTurbo)
    .domain([TEMPERATURE_RANGE[0], TEMPERATURE_RANGE[1]]);

export const contourThresholds = d3.range(TEMPERATURE_RANGE[0], TEMPERATURE_RANGE[1] + 1, 2);

const germanyPolygon = geojson as GeoJSON.FeatureCollection<GeoJSON.Geometry>;

const pointInGermany = (longitude: number, latitude: number) => (
    geojson.features.some((feature) => d3.geoContains(feature as GeoJSON.Feature, [longitude, latitude]))
);

function buildWeatherGrid(): WeatherPoint[] {
    const bounds = d3.geoBounds(germanyPolygon);
    const [[minLongitude, minLatitude], [maxLongitude, maxLatitude]] = bounds;
    const points: WeatherPoint[] = [];

    for (let row = 0; row < GRID_ROWS; row += 1) {
        for (let column = 0; column < GRID_COLUMNS; column += 1) {
            const longitude = minLongitude + (column / (GRID_COLUMNS - 1)) * (maxLongitude - minLongitude);
            const latitude = minLatitude + (row / (GRID_ROWS - 1)) * (maxLatitude - minLatitude);

            if (pointInGermany(longitude, latitude)) {
                points.push({
                    name: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
                    latitude,
                    longitude,
                });
            }
        }
    }

    return points;
}

const toDateInputValue = (date: Date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const startOfCurrentHour = () => {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    return date;
};

function buildWeatherUrl(points: WeatherPoint[]) {
    const end = startOfCurrentHour();
    const start = new Date(end);
    start.setHours(start.getHours() - (HOURS_TO_LOAD - 1));

    const params = new URLSearchParams({
        latitude: points.map((point) => point.latitude.toFixed(4)).join(","),
        longitude: points.map((point) => point.longitude.toFixed(4)).join(","),
        hourly: "temperature_2m",
        temperature_unit: "celsius",
        timezone: "Europe/Berlin",
        start_date: toDateInputValue(start),
        end_date: toDateInputValue(end),
        models: "icon_d2",
    });

    return `${API_URL}?${params.toString()}`;
}

type OpenMeteoLocationResponse = {
    hourly?: {
        time?: string[];
        temperature_2m?: Array<number | null>;
    };
    reason?: string;
};

const normalizeResponses = (data: OpenMeteoLocationResponse | OpenMeteoLocationResponse[]) => (
    Array.isArray(data) ? data : [data]
);

export async function loadHistoricalTemperatures(): Promise<WeatherDataset> {
    const points = buildWeatherGrid();
    const response = await fetch(buildWeatherUrl(points));

    if (!response.ok) {
        throw new Error(`Open-Meteo returned ${response.status}`);
    }

    const locations = normalizeResponses(await response.json() as OpenMeteoLocationResponse | OpenMeteoLocationResponse[]);
    const failedLocation = locations.find((location) => location.reason);

    if (failedLocation?.reason) {
        throw new Error(failedLocation.reason);
    }

    const currentHour = startOfCurrentHour();
    const timeline = locations[0]?.hourly?.time ?? [];
    const hours = timeline
        .map((label, timeIndex) => {
            const time = new Date(label);
            const values = locations.map((location) => location.hourly?.temperature_2m?.[timeIndex] ?? Number.NaN);
            return { time, label, values };
        })
        .filter((hour) => hour.time <= currentHour && hour.values.some(Number.isFinite))
        .slice(-HOURS_TO_LOAD);

    return { points, hours };
}

function interpolateTemperature(x: number, y: number, projectedPoints: Array<[number, number]>, temperatures: number[]) {
    let weightedSum = 0;
    let totalWeight = 0;

    projectedPoints.forEach(([pointX, pointY], index) => {
        const temperature = temperatures[index];

        if (!Number.isFinite(temperature)) {
            return;
        }

        const distanceSquared = ((x - pointX) ** 2) + ((y - pointY) ** 2);

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

export function buildTemperatureContours(dataset: WeatherDataset, hour: WeatherHour) {
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
            values.push(interpolateTemperature(x, y, projectedPoints, hour.values));
        }
    }

    return d3
        .contours()
        .size([gridWidth, gridHeight])
        .thresholds(contourThresholds)(values)
        .map((contour) => ({
            ...contour,
            coordinates: contour.coordinates.map((polygon) => (
                polygon.map((ring) => ring.map(([x, y]) => [x * CONTOUR_CELL_SIZE, y * CONTOUR_CELL_SIZE]))
            )),
        }));
}
