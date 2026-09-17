/**
 * Fetching and parsing the public REBOKS capacity page.
 *
 * This is a direct port of prototype/scrape.py. See docs/DATA-SOURCE.md for
 * why we parse HTML rather than calling a JSON API.
 */

export const CAPACITY_URL =
  "https://reboks.nus.edu.sg/nus_public_web/public/index.php/facilities/capacity";

/** Identify ourselves honestly rather than impersonating a browser. */
const USER_AGENT = "nus-gym-tracker/0.1 (personal project; contact via GitHub)";

/**
 * The two gyms this project tracks.
 *
 * REBOKS also publishes two swimming pools. We parse them, because telling gyms
 * from pools is what `class` is for, but we do not track them: this is a gym
 * tracker, and unused rows are just noise in the history.
 */
export const UTOWN_GYM_ID = 26;
export const USC_GYM_ID = 39;

export interface Facility {
  facilityId: number;
  name: string;
  kind: "gym" | "pool";
  occupancy: number;
  capacity: number;
}

export interface Observation extends Facility {
  /** When we read the value, in UTC. Not when the cron was scheduled. */
  observedAt: Date;
}

/**
 * Each facility is emitted by REBOKS as one uniform, unnested line:
 *   <div class='gymbox' id='39'><span>...</span><b>106/110</b></div>
 * The markup is machine-generated, which is what makes a regex adequate here.
 */
const FACILITY_PATTERN =
  /<div class='(swimbox|gymbox)' id='(\d+)'><span>([^<]+)<\/span><b>(\d+)\/(\d+)<\/b><\/div>/g;

/** Collapse repeated whitespace: REBOKS emits "Kent Ridge -  Swimming Pool". */
function normaliseName(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Extract every facility from the page HTML.
 *
 * Throws if nothing matches. An empty array would be indistinguishable from
 * "every gym is empty" and would quietly poison the stored history.
 */
export function parseFacilities(html: string): Facility[] {
  const facilities: Facility[] = [];

  for (const match of html.matchAll(FACILITY_PATTERN)) {
    const [, cssClass, id, name, occupancy, capacity] = match;
    facilities.push({
      facilityId: Number(id),
      name: normaliseName(name),
      kind: cssClass === "gymbox" ? "gym" : "pool",
      occupancy: Number(occupancy),
      capacity: Number(capacity),
    });
  }

  if (facilities.length === 0) {
    throw new Error("no facilities found - the REBOKS page layout has changed");
  }

  return facilities;
}

/** Fetch the capacity page and return its HTML. */
export async function fetchCapacityPage(url = CAPACITY_URL): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

  if (!response.ok) {
    throw new Error(`REBOKS returned ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Keep only the gyms.
 *
 * Filtering on `kind` rather than a fixed ID list means a third gym added by NUS
 * is picked up automatically, while pools stay out.
 */
export function gymsOnly(facilities: Facility[]): Facility[] {
  return facilities.filter((facility) => facility.kind === "gym");
}

/**
 * Fetch, parse, and stamp each gym with the observation time.
 *
 * `now` is passed in so the whole batch shares one timestamp, which keeps rows
 * from the same scrape groupable in D1 later.
 */
export async function observe(now = new Date()): Promise<Observation[]> {
  const facilities = gymsOnly(parseFacilities(await fetchCapacityPage()));
  return facilities.map((facility) => ({ ...facility, observedAt: now }));
}

/** Percentage full, or null when capacity is unknown. */
export function percentFull(facility: Facility): number | null {
  if (!facility.capacity) return null;
  return (100 * facility.occupancy) / facility.capacity;
}
