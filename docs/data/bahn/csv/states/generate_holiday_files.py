import csv
import json
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
STATE_CODES_PATH = BASE_DIR / "german_states_codes.csv"
PUBLIC_HOLIDAYS_PATH = BASE_DIR / "holidays_2023.json"
SCHOOL_HOLIDAYS_PATH = BASE_DIR / "school_holidays_2023.json"
PUBLIC_OUTPUT_DIR = BASE_DIR / "holidays"
SCHOOL_OUTPUT_DIR = BASE_DIR / "school_holidays"


def load_json(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as input_file:
        data = json.load(input_file)

    if not isinstance(data, list):
        raise ValueError(f"Expected a JSON array in {path}")

    return data


def load_state_codes() -> list[str]:
    with STATE_CODES_PATH.open(encoding="utf-8", newline="") as input_file:
        rows = csv.DictReader(input_file)
        state_codes = [row["code"] for row in rows]

    if len(state_codes) != 16 or len(set(state_codes)) != 16:
        raise ValueError("Expected 16 unique state codes")

    return state_codes


def english_name(holiday: dict[str, Any]) -> str:
    english_names = [
        name["text"]
        for name in holiday.get("name", [])
        if name.get("language") == "EN" and name.get("text")
    ]

    if len(english_names) != 1:
        raise ValueError(
            f"Expected exactly one English name for holiday {holiday.get('id')}"
        )

    return english_names[0]


def project_holiday(holiday: dict[str, Any]) -> dict[str, str]:
    return {
        "startDate": holiday["startDate"],
        "endDate": holiday["endDate"],
        "name": english_name(holiday),
    }


def projected_and_sorted(holidays: list[dict[str, Any]]) -> list[dict[str, str]]:
    projected = [project_holiday(holiday) for holiday in holidays]
    unique = {
        (holiday["startDate"], holiday["endDate"], holiday["name"]): holiday
        for holiday in projected
    }

    return sorted(
        unique.values(),
        key=lambda holiday: (
            holiday["startDate"],
            holiday["endDate"],
            holiday["name"],
        ),
    )


def subdivision_codes(holiday: dict[str, Any]) -> set[str]:
    return {
        subdivision["code"]
        for subdivision in holiday.get("subdivisions", [])
        if subdivision.get("code")
    }


def write_json(path: Path, holidays: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output_file:
        json.dump(
            projected_and_sorted(holidays),
            output_file,
            ensure_ascii=False,
            indent=2,
        )
        output_file.write("\n")


def generate_public_holidays(
    state_codes: list[str], holidays: list[dict[str, Any]]
) -> None:
    nationwide = [holiday for holiday in holidays if holiday.get("nationwide")]
    write_json(PUBLIC_OUTPUT_DIR / "national.json", nationwide)

    for state_code in state_codes:
        applicable = [
            holiday
            for holiday in holidays
            if holiday.get("nationwide") or state_code in subdivision_codes(holiday)
        ]
        write_json(PUBLIC_OUTPUT_DIR / f"{state_code.lower()}.json", applicable)


def generate_school_holidays(
    state_codes: list[str], holidays: list[dict[str, Any]]
) -> None:
    national_path = SCHOOL_OUTPUT_DIR / "national.json"
    if national_path.exists():
        national_path.unlink()

    for state_code in state_codes:
        applicable = [
            holiday
            for holiday in holidays
            if state_code in subdivision_codes(holiday)
        ]
        write_json(SCHOOL_OUTPUT_DIR / f"{state_code.lower()}.json", applicable)


def main() -> None:
    state_codes = load_state_codes()
    public_holidays = load_json(PUBLIC_HOLIDAYS_PATH)
    school_holidays = load_json(SCHOOL_HOLIDAYS_PATH)

    generate_public_holidays(state_codes, public_holidays)
    generate_school_holidays(state_codes, school_holidays)

    print(
        f"Generated {len(state_codes) + 1} public-holiday files and "
        f"{len(state_codes)} school-holiday files."
    )


if __name__ == "__main__":
    main()
