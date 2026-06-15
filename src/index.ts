import "./styles.css";

import * as d3 from "d3";

import { COLORS } from "./colors";
import { appendTrainStrecken, appendTrainStations, stations } from "./data/bahn";
import { appendGermany } from "./data/geo";
import { map_svg, tooltip } from "./config";
import { appendWeatherOverlay } from "./weatherOverlay";

const g = map_svg.append("g");
const selectedStationNames = new Set(stations.map(station => station.name));

// Germany Map
appendGermany(g)
    .on("mouseenter", function (_, d) {
        d3.select(this).attr("fill", COLORS.MAP.HIGHLIGHT);
        tooltip.style("display", "block")
            .text(d.properties?.name ?? `${d.properties?.NAME_2}, ${d.properties?.NAME_1}`);
    })
    .on("mousemove", (event) => {
        tooltip.style("left", `${event.pageX + 10}px`)
               .style("top", `${event.pageY + 10}px`);
    })
    .on("mouseleave", function () {
        d3.select(this).attr("fill", COLORS.MAP.NORMAL);
        tooltip.style("display", "none");
    });

// Hourly historic temperature map
appendWeatherOverlay(g);

const trainLinesLayer = g.append("g");
const trainStationsLayer = g.append("g");

function renderTrainNetwork() {
    const visibleStations = stations.filter(station => selectedStationNames.has(station.name));

    appendTrainStrecken(trainLinesLayer, selectedStationNames);
    appendTrainStations(trainStationsLayer, visibleStations)
        .on("mouseenter", function (_, d) {
            d3.select(this).attr("fill", COLORS.MAP.HIGHLIGHT);
            tooltip.style("display", "block")
                .text(d.name);
        })
        .on("mousemove", (event) => {
            tooltip.style("left", `${event.pageX + 10}px`)
                   .style("top", `${event.pageY + 10}px`);
        })
        .on("mouseleave", function () {
            d3.select(this).attr("fill", COLORS.TRAINS.STATIONS);
            tooltip.style("display", "none");
        });
}

function getRequiredElement<T extends HTMLElement>(selector: string) {
    const element = document.querySelector<T>(selector);

    if (!element) {
        throw new Error(`Missing required element: ${selector}`);
    }

    return element;
}

function setupStationFilterPanel() {
    const searchInput = getRequiredElement<HTMLInputElement>("#station-search");
    const countText = getRequiredElement<HTMLParagraphElement>("#station-count");
    const list = getRequiredElement<HTMLDivElement>("#station-list");
    const selectAllButton = getRequiredElement<HTMLButtonElement>("#select-all-stations");
    const clearButton = getRequiredElement<HTMLButtonElement>("#clear-stations");

    function renderStationList() {
        const query = searchInput.value.trim().toLowerCase();
        const visibleStations = stations.filter(station => station.name.toLowerCase().includes(query));

        countText.textContent = `${selectedStationNames.size} of ${stations.length} selected`;
        list.replaceChildren();

        visibleStations.forEach(station => {
            const label = document.createElement("label");
            label.className = [
                "flex cursor-pointer items-center gap-3 rounded-md px-1 py-2 text-base font-semibold",
                "text-slate-600 transition hover:bg-slate-50",
            ].join(" ");

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = selectedStationNames.has(station.name);
            checkbox.className = [
                "h-6 w-6 rounded border-slate-300 accent-sky-600",
                "focus:ring-2 focus:ring-sky-300",
            ].join(" ");
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    selectedStationNames.add(station.name);
                } else {
                    selectedStationNames.delete(station.name);
                }

                renderTrainNetwork();
                renderStationList();
            });

            const name = document.createElement("span");
            name.textContent = station.name;

            label.append(checkbox, name);
            list.append(label);
        });

        if (visibleStations.length === 0) {
            const emptyState = document.createElement("p");
            emptyState.className = "px-1 py-6 text-sm font-medium text-slate-400";
            emptyState.textContent = "No stations found.";
            list.append(emptyState);
        }
    }

    searchInput.addEventListener("input", renderStationList);
    selectAllButton.addEventListener("click", () => {
        stations.forEach(station => selectedStationNames.add(station.name));
        renderTrainNetwork();
        renderStationList();
    });
    clearButton.addEventListener("click", () => {
        selectedStationNames.clear();
        renderTrainNetwork();
        renderStationList();
    });

    renderStationList();
}

function formatDateInputValue(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string) {
    if (!value) {
        return null;
    }

    const [year, month, day] = value.split("-").map(Number);

    if (!year || !month || !day) {
        return null;
    }

    return new Date(year, month - 1, day);
}

function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(left: Date, right: Date) {
    return startOfDay(left).getTime() === startOfDay(right).getTime();
}

function addMonths(date: Date, offset: number) {
    return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function setupTimeRangePicker() {
    const fromInput = getRequiredElement<HTMLInputElement>("#from-date");
    const toInput = getRequiredElement<HTMLInputElement>("#to-date");
    const monthLabel = getRequiredElement<HTMLParagraphElement>("#calendar-month");
    const calendarDays = getRequiredElement<HTMLDivElement>("#calendar-days");
    const previousMonthButton = getRequiredElement<HTMLButtonElement>("#previous-month");
    const nextMonthButton = getRequiredElement<HTMLButtonElement>("#next-month");

    const today = startOfDay(new Date());
    const initialFromDate = new Date(today);
    initialFromDate.setDate(today.getDate() - 7);

    let fromDate = initialFromDate;
    let toDate = today;
    let activeBoundary: "from" | "to" = "from";
    let displayedMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);

    function syncInputs() {
        fromInput.value = formatDateInputValue(fromDate);
        toInput.value = formatDateInputValue(toDate);
    }

    function updateFromInput(value: string) {
        const nextDate = parseDateInputValue(value);

        if (!nextDate) {
            return;
        }

        fromDate = startOfDay(nextDate);

        if (fromDate > toDate) {
            toDate = fromDate;
        }

        displayedMonth = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
        syncInputs();
        renderCalendar();
    }

    function updateToInput(value: string) {
        const nextDate = parseDateInputValue(value);

        if (!nextDate) {
            return;
        }

        toDate = startOfDay(nextDate);

        if (toDate < fromDate) {
            fromDate = toDate;
        }

        displayedMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
        syncInputs();
        renderCalendar();
    }

    function renderCalendar() {
        const monthFormatter = new Intl.DateTimeFormat("en", {
            month: "long",
            year: "numeric",
        });
        const year = displayedMonth.getFullYear();
        const month = displayedMonth.getMonth();
        const firstWeekdayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        monthLabel.textContent = monthFormatter.format(displayedMonth);
        calendarDays.replaceChildren();

        for (let index = 0; index < firstWeekdayOffset; index += 1) {
            calendarDays.append(document.createElement("span"));
        }

        for (let day = 1; day <= daysInMonth; day += 1) {
            const date = new Date(year, month, day);
            const isFromDate = sameDay(date, fromDate);
            const isToDate = sameDay(date, toDate);
            const isInRange = date > fromDate && date < toDate;
            const isToday = sameDay(date, today);
            const button = document.createElement("button");

            button.type = "button";
            button.textContent = String(day);
            button.ariaLabel = `Select ${formatDateInputValue(date)}`;
            button.className = [
                "h-8 rounded-md text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-sky-300",
                isFromDate || isToDate
                    ? "bg-sky-600 text-white hover:bg-sky-700"
                    : isInRange
                      ? "bg-sky-100 text-sky-800 hover:bg-sky-200"
                      : "bg-white text-slate-600 hover:bg-slate-100",
                isToday && !isFromDate && !isToDate ? "ring-1 ring-sky-400" : "",
            ].join(" ");

            button.addEventListener("click", () => {
                if (activeBoundary === "from") {
                    fromDate = date;

                    if (fromDate > toDate) {
                        toDate = fromDate;
                    }

                    activeBoundary = "to";
                } else {
                    toDate = date;

                    if (toDate < fromDate) {
                        fromDate = toDate;
                    }

                    activeBoundary = "from";
                }

                syncInputs();
                renderCalendar();
            });

            calendarDays.append(button);
        }
    }

    fromInput.addEventListener("focus", () => {
        activeBoundary = "from";
    });
    toInput.addEventListener("focus", () => {
        activeBoundary = "to";
    });
    fromInput.addEventListener("change", () => updateFromInput(fromInput.value));
    toInput.addEventListener("change", () => updateToInput(toInput.value));
    previousMonthButton.addEventListener("click", () => {
        displayedMonth = addMonths(displayedMonth, -1);
        renderCalendar();
    });
    nextMonthButton.addEventListener("click", () => {
        displayedMonth = addMonths(displayedMonth, 1);
        renderCalendar();
    });

    syncInputs();
    renderCalendar();
}

renderTrainNetwork();

const zoom = d3
    .zoom<SVGSVGElement, undefined>()
    .scaleExtent([.75, 20])
    .on("zoom", (event) => g.attr("transform", event.transform));
map_svg.call(zoom);
setupStationFilterPanel();
setupTimeRangePicker();

const mapPanel = getRequiredElement<HTMLElement>("#map-panel");
mapPanel.append(map_svg.node()!);

document.body.append(tooltip.node()!);
