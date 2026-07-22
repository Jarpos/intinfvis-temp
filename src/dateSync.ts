export const DEFAULT_DATE_RANGE = {
  from: new Date(2023, 2, 1),
  to: new Date(2023, 2, 14),
};

export const SELECTED_DATE_CHANGE_EVENT = "selected-date-change";
export const WEATHER_DATE_PREVIEW_EVENT = "weather-date-preview";

export type SelectedDateChangeSource =
  | "time-range"
  | "weather-timeline"
  | "holiday-calendar";

export type SelectedDateChangeDetail = {
  from: string;
  to: string;
  selected: string;
  source: SelectedDateChangeSource;
};

export type WeatherDatePreviewDetail = {
  selected: string | null;
};
