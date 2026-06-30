export const DEFAULT_DATE_RANGE = {
  from: new Date(2023, 1, 1),
  to: new Date(2023, 1, 14),
};

export const SELECTED_DATE_CHANGE_EVENT = "selected-date-change";

export type SelectedDateChangeSource = "time-range" | "weather-timeline";

export type SelectedDateChangeDetail = {
  from: string;
  to: string;
  selected: string;
  source: SelectedDateChangeSource;
};
