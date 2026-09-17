"""Stage 0 prototype: read live gym/pool occupancy from the public REBOKS page.

This is a throwaway learning prototype, deliberately kept separate from the
eventual Cloudflare Worker. It has one job: prove we can get correct numbers
out of REBOKS. See docs/data-source.md for what we found and why.

Run:  python prototype/scrape.py
"""

import re
import sys
from datetime import datetime, timedelta, timezone

import requests

CAPACITY_URL = (
    "https://reboks.nus.edu.sg/nus_public_web/public/index.php/facilities/capacity"
)

# REBOKS reports Singapore local time; we store UTC and only convert for display.
SGT = timezone(timedelta(hours=8))

# Identify ourselves rather than pretending to be a browser. If NUS ever wants
# to know who is making these requests, this is the polite way to tell them.
USER_AGENT = "nus-gym-tracker/0.1 (personal project; contact via GitHub)"

# The page renders each facility as a single machine-generated line, e.g.
#   <div class='gymbox' id='39'><span>University Sports Centre - Gym</span><b>109/110</b></div>
# The markup is uniform and never nested, which is why a regex is adequate here.
FACILITY_PATTERN = re.compile(
    r"<div class='(?P<css_class>swimbox|gymbox)' id='(?P<facility_id>\d+)'>"
    r"<span>(?P<name>[^<]+)</span>"
    r"<b>(?P<occupancy>\d+)/(?P<capacity>\d+)</b>"
    r"</div>"
)


def fetch_page(url=CAPACITY_URL):
    """Perform the HTTP GET and return the page's HTML as a string."""
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
    response.raise_for_status()  # turn 4xx/5xx into an exception instead of silent garbage
    return response.text


def parse_facilities(html, observed_at=None):
    """Extract one record per facility from the page HTML."""
    observed_at = observed_at or datetime.now(timezone.utc)
    facilities = []

    for match in FACILITY_PATTERN.finditer(html):
        occupancy = int(match.group("occupancy"))
        capacity = int(match.group("capacity"))
        facilities.append(
            {
                "observed_at": observed_at.isoformat(timespec="seconds"),
                "facility_id": int(match.group("facility_id")),
                "name": normalise_name(match.group("name")),
                "kind": "pool" if match.group("css_class") == "swimbox" else "gym",
                "occupancy": occupancy,
                "capacity": capacity,
            }
        )

    if not facilities:
        # Fail loudly. A silent empty list would look identical to "gyms are empty"
        # and would quietly poison the historical data later on.
        raise ValueError("no facilities found - the page layout has probably changed")

    return facilities


def normalise_name(name):
    """Collapse repeated whitespace; REBOKS emits 'Kent Ridge -  Swimming Pool'."""
    return " ".join(name.split())


def percent_full(facility):
    if not facility["capacity"]:
        return None
    return 100 * facility["occupancy"] / facility["capacity"]


def format_line(facility):
    pct = percent_full(facility)
    pct_text = "n/a" if pct is None else f"{pct:.0f}%"
    return (
        f"[{facility['facility_id']:>3}] {facility['name']}: "
        f"{facility['occupancy']}/{facility['capacity']} ({pct_text})"
    )


def main():
    facilities = parse_facilities(fetch_page())

    local_time = datetime.now(SGT).strftime("%Y-%m-%d %H:%M:%S")
    print(f"Observed at {local_time} SGT\n")
    for facility in facilities:
        print(format_line(facility))

    return 0


if __name__ == "__main__":
    sys.exit(main())
