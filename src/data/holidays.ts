export type HolidayInterval = {
  startDate: string;
  endDate: string;
  name: string;
};

export type HolidayCalendarData = {
  publicHolidays: HolidayInterval[];
  schoolHolidays: HolidayInterval[];
  errors: string[];
};

export type HolidayCalendarCell = {
  date: Date;
  dateKey: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isInRange: boolean;
  isSelected: boolean;
  publicHolidayNames: string[];
  schoolHolidayNames: string[];
};

const DATA_ROOT = "/data/bahn/csv/states";
const holidayDataCache = new Map<string, Promise<HolidayCalendarData>>();
let stateCodesPromise: Promise<Map<string, string>> | null = null;

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function holidayDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function loadStateCodes() {
  if (stateCodesPromise) {
    return stateCodesPromise;
  }

  stateCodesPromise = fetch(`${DATA_ROOT}/german_states_codes.csv`).then(
    async (response) => {
      if (!response.ok) {
        throw new Error(`State codes (${response.status})`);
      }

      const rows = (await response.text()).trim().split(/\r?\n/).slice(1);
      const codes = new Map<string, string>();

      rows.forEach((row) => {
        const separator = row.lastIndexOf(",");
        const name = row.slice(0, separator).trim();
        const code = row.slice(separator + 1).trim().toLowerCase();

        if (separator > 0 && name && /^de-[a-z]{2}$/.test(code)) {
          codes.set(name, code);
        }
      });

      return codes;
    },
  );

  return stateCodesPromise;
}

function isHolidayInterval(value: unknown): value is HolidayInterval {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<HolidayInterval>;
  return (
    typeof item.startDate === "string" &&
    typeof item.endDate === "string" &&
    typeof item.name === "string" &&
    parseDateKey(item.startDate) !== null &&
    parseDateKey(item.endDate) !== null &&
    item.startDate <= item.endDate
  );
}

async function loadHolidayFile(path: string) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`${path} (${response.status})`);
  }

  const data: unknown = await response.json();

  if (!Array.isArray(data) || !data.every(isHolidayInterval)) {
    throw new Error(`${path} contains invalid holiday data`);
  }

  const unique = new Map<string, HolidayInterval>();
  data.forEach((holiday) => {
    unique.set(
      `${holiday.startDate}|${holiday.endDate}|${holiday.name}`,
      holiday,
    );
  });
  return Array.from(unique.values());
}

export function loadHolidayCalendarData(focusedState: string | null) {
  const cacheKey = focusedState ?? "national";
  const cached = holidayDataCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const request = (async (): Promise<HolidayCalendarData> => {
    const errors: string[] = [];

    if (!focusedState) {
      try {
        return {
          publicHolidays: await loadHolidayFile(
            `${DATA_ROOT}/holidays/national.json`,
          ),
          schoolHolidays: [],
          errors,
        };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return { publicHolidays: [], schoolHolidays: [], errors };
      }
    }

    let code: string | undefined;
    try {
      code = (await loadStateCodes()).get(focusedState);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    if (!code) {
      errors.push(`No holiday code found for ${focusedState}`);
      return { publicHolidays: [], schoolHolidays: [], errors };
    }

    const [publicResult, schoolResult] = await Promise.allSettled([
      loadHolidayFile(`${DATA_ROOT}/holidays/${code}.json`),
      loadHolidayFile(`${DATA_ROOT}/school_holidays/${code}.json`),
    ]);

    if (publicResult.status === "rejected") {
      errors.push(String(publicResult.reason));
    }
    if (schoolResult.status === "rejected") {
      errors.push(String(schoolResult.reason));
    }

    return {
      publicHolidays:
        publicResult.status === "fulfilled" ? publicResult.value : [],
      schoolHolidays:
        schoolResult.status === "fulfilled" ? schoolResult.value : [],
      errors,
    };
  })();

  holidayDataCache.set(cacheKey, request);
  return request;
}

function namesForDate(intervals: HolidayInterval[], dateKey: string) {
  return Array.from(
    new Set(
      intervals
        .filter(
          (holiday) =>
            dateKey >= holiday.startDate && dateKey <= holiday.endDate,
        )
        .map((holiday) => holiday.name),
    ),
  );
}

export function buildHolidayCalendarCells(
  monthDate: Date,
  range: { from: Date; to: Date; selected: Date },
  data: HolidayCalendarData | null,
) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - mondayOffset);
  const from = startOfDay(range.from);
  const to = startOfDay(range.to);
  const selectedKey = holidayDateKey(range.selected);

  return Array.from({ length: 42 }, (_, index): HolidayCalendarCell => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = holidayDateKey(date);

    return {
      date,
      dateKey,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === monthStart.getMonth(),
      isInRange: date >= from && date <= to,
      isSelected: dateKey === selectedKey,
      publicHolidayNames: namesForDate(data?.publicHolidays ?? [], dateKey),
      schoolHolidayNames: namesForDate(data?.schoolHolidays ?? [], dateKey),
    };
  });
}
