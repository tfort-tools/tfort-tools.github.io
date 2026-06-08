const fs = require("fs");

const directoryName = "transfort";

function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = values[i] ?? "";
        });
        return obj;
    });
}

function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === "," && !inQuotes) {
            result.push(current);
            current = "";
        } else {
            current += c;
        }
    }

    result.push(current);

    return result;
}

function regularizeName(name) {
    const uppercaseWordsRegex = /\b(csu|vth|ada|flex|max|horn|jfk|rec|ntc|us|uc|hs)\b/i;

    name = name.toLowerCase();
    name = name.replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
    name = name.replace(uppercaseWordsRegex, (m) => m.toUpperCase());

    // replace suffix
    name = name.replace(/\(N\s+OF\)+$/i, "(North)");
    name = name.replace(/\(E\s+OF\)+$/i, "(East)");
    name = name.replace(/\(W\s+OF\)+$/i, "(West)");
    name = name.replace(/\(S\s+OF\)+$/i, "(South)");
    name = name.replace(/\(NB\)+$/i, "(Northbound)");
    name = name.replace(/\(EB\)+$/i, "(Eastbound)");
    name = name.replace(/\(WB\)+$/i, "(Westbound)");
    name = name.replace(/\(SB\)+$/i, "(Southbound)");

    // fix provider's mistake
    if (directoryName === "transfort" && name.match(/\bcenter\b/i)) {
        // for some reason, street name "centre" is misspelled as "center" in the source data
        // test if it's likely a street name (matches "center &" or "& center")
        if (name.match(/\bcenter\s*&/i) || name.match(/&\s*center\b/i)) {
            console.log(`before: ${name}`);
            name = name.replace(/\bcenter\b/i, "Centre");
            console.log(`after: ${name}`);
        }
    }
    return name;
}

const routes = parseCsv(fs.readFileSync(`./gtfs/${directoryName}/routes.txt`, "utf8"));
const trips = parseCsv(fs.readFileSync(`./gtfs/${directoryName}/trips.txt`, "utf8"));
const stops = parseCsv(fs.readFileSync(`./gtfs/${directoryName}/stops.txt`, "utf8"));
const stopTimes = parseCsv(fs.readFileSync(`./gtfs/${directoryName}/stop_times.txt`, "utf8"));
const calendar = parseCsv(fs.readFileSync(`./gtfs/${directoryName}/calendar.txt`, "utf8"));
let calendarDates = [];
if (fs.existsSync(`./gtfs/${directoryName}/calendar_dates.txt`)) {
    calendarDates = parseCsv(fs.readFileSync(`./gtfs/${directoryName}/calendar_dates.txt`, "utf8"));
}

const tripMap = new Map(trips.map((trip) => [trip.trip_id, trip]));
const stopMap = new Map(stops.map((stop) => [stop.stop_id, stop]));

//
// stop_key
//

const stopKeyMap = new Map();

const stopIds = {};

for (const stop of stops) {
    const stopKey = regularizeName(stop.stop_name);

    stopKeyMap.set(stop.stop_id, stopKey);

    if (!stopIds[stopKey]) {
        stopIds[stopKey] = [];
    }

    stopIds[stopKey].push(stop.stop_id);
}

//
// route map
//

const routeMap = new Map(routes.map((route) => [route.route_id, route]));

//
// trip -> ordered stops
//

const tripStops = new Map();

for (const stopTime of stopTimes) {
    if (!tripStops.has(stopTime.trip_id)) {
        tripStops.set(stopTime.trip_id, []);
    }

    tripStops.get(stopTime.trip_id).push({
        stop_id: stopTime.stop_id,
        stop_key: stopKeyMap.get(stopTime.stop_id),
        departure_time: stopTime.departure_time,
        stop_sequence: Number(stopTime.stop_sequence),
    });
}

for (const stops of tripStops.values()) {
    stops.sort((a, b) => a.stop_sequence - b.stop_sequence);
}

//
// trip-times.json
//

const tripTimes = [];

for (const [tripId, stops] of tripStops) {
    for (const stop of stops) {
        const trip = tripMap.get(tripId);

        tripTimes.push({
            trip_id: tripId,

            service_id: trip?.service_id ?? null,

            stop_id: stop.stop_id,

            stop_key: stop.stop_key,

            departure_time: stop.departure_time.replace(/^(\d{1,2}):(\d{2}):(\d{2})$/, `$1:$2`).replace(/^(\d{1}):(\d{2})$/, `0$1:$2`),

            stop_sequence: stop.stop_sequence,
        });
    }
}

//
// patterns
//

const signatureToPattern = new Map();

const patterns = {};

let patternCounter = 1;

for (const trip of trips) {
    const stops = tripStops.get(trip.trip_id) || [];

    const signature = trip.route_id + "|" + stops.map((stop) => stop.stop_key).join(">");

    let patternId = signatureToPattern.get(signature);

    if (!patternId) {
        patternId = "pattern_" + patternCounter++;

        signatureToPattern.set(signature, patternId);

        patterns[patternId] = {
            route_id: trip.route_id,

            trip_name: null,

            destination: stops.length ? stops.at(-1).stop_key : null,

            stops: stops.map((stop) => stop.stop_key),

            trip_ids: [],
        };
    }

    patterns[patternId].trip_ids.push(trip.trip_id);
}

//
// stop-patterns
//

const stopPatterns = {};

for (const [signature, patternId] of signatureToPattern) {
    const stopNames = signature.split("|")[1].split(">");

    for (const stopName of stopNames) {
        if (!stopPatterns[stopName]) {
            stopPatterns[stopName] = [];
        }

        if (!stopPatterns[stopName].includes(patternId)) {
            stopPatterns[stopName].push(patternId);
        }
    }
}

//
// route-list
//

const routeList = [];

for (const route of routes) {
    const routeStops = [];
    const seen = new Set();

    const routeTrips = trips.filter((trip) => trip.route_id === route.route_id);

    for (const trip of routeTrips) {
        const stops = tripStops.get(trip.trip_id) || [];

        for (const stop of stops) {
            if (seen.has(stop.stop_key)) {
                continue;
            }

            seen.add(stop.stop_key);

            routeStops.push({
                stop_key: stop.stop_key,
                stop_name: regularizeName(stop.stop_key),
            });
        }
    }

    routeList.push({
        route_id: route.route_id,
        route_long_name: regularizeName(route.route_long_name) || regularizeName(route.route_short_name),
        route_color: route.route_color,
        route_text_color: route.route_text_color,
        stops: routeStops,
    });
}

/* calendar */
const calendarJson = {};

for (const row of calendar) {
    calendarJson[row.service_id] = {
        monday: row.monday,
        tuesday: row.tuesday,
        wednesday: row.wednesday,
        thursday: row.thursday,
        friday: row.friday,
        saturday: row.saturday,
        sunday: row.sunday,
        start_date: row.start_date,
        end_date: row.end_date,
    };
}

const calendarDatesJson = {};

for (const row of calendarDates) {
    if (!calendarDatesJson[row.service_id]) {
        calendarDatesJson[row.service_id] = [];
    }

    calendarDatesJson[row.service_id].push({
        date: row.date,
        exception_type: row.exception_type,
    });
}

/* connection */
const tripMap2 = new Map();

for (const row of tripTimes) {
    if (!tripMap2.has(row.trip_id)) {
        tripMap2.set(row.trip_id, []);
    }

    tripMap2.get(row.trip_id).push(row);
}

for (const stops of tripMap2.values()) {
    stops.sort((a, b) => a.stop_sequence - b.stop_sequence);
}

const connections = [];
for (const stops of tripMap2.values()) {
    for (let i = 0; i < stops.length - 1; i++) {
        const from = stops[i];
        const to = stops[i + 1];

        connections.push({
            from: from.stop_key,
            to: to.stop_key,

            trip_id: from.trip_id,

            departure_time: from.departure_time,

            arrival_time: to.departure_time,

            departure_sequence: from.stop_sequence,

            arrival_sequence: to.stop_sequence,

            service_id: from.service_id,
        });
    }
}

/* stop connections */

const stopConnections = {};

for (const c of connections) {
    stopConnections[c.from] ??= new Set();

    stopConnections[c.from].add(c.to);
}
const output = {};

for (const [stop, set] of Object.entries(stopConnections)) {
    output[stop] = [...set];
}

// tripinfo
const tripInfo = {};

for (const [patternId, pattern] of Object.entries(patterns)) {
    for (const tripId of pattern.trip_ids) {
        tripInfo[tripId] = {
            route_id: pattern.route_id,

            pattern_id: patternId,

            destination: pattern.stops.at(-1),
        };
    }
}
// allstalist
const stationList = Object.keys(stopPatterns).sort();

// tripstoptime
const tripStopTimes = {};

for (const row of tripTimes) {
    tripStopTimes[row.trip_id] ??= [];

    tripStopTimes[row.trip_id].push({
        stop_key: row.stop_key,

        departure_time: row.departure_time,

        stop_sequence: row.stop_sequence,
    });
}
for (const tripId in tripStopTimes) {
    tripStopTimes[tripId].sort((a, b) => a.stop_sequence - b.stop_sequence);
}
//
// write
//

if (!fs.existsSync(`./gtfs_parsed/${directoryName}`)) {
    fs.mkdirSync(`./gtfs_parsed/${directoryName}`, { recursive: true });
}

fs.writeFileSync(`./gtfs_parsed/${directoryName}/route-list.json`, JSON.stringify(routeList, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/stop-patterns.json`, JSON.stringify(stopPatterns, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/stop-ids.json`, JSON.stringify(stopIds, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/patterns.json`, JSON.stringify(patterns, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/trip-times.json`, JSON.stringify(tripTimes, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/calendar.json`, JSON.stringify(calendarJson, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/connections.json`, JSON.stringify(connections, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/stop-connections.json`, JSON.stringify(output, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/trip-info.json`, JSON.stringify(tripInfo, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/station-list.json`, JSON.stringify(stationList, null, 2));
fs.writeFileSync(`./gtfs_parsed/${directoryName}/trip-stop-times.json`, JSON.stringify(tripStopTimes, null, 2));

if (Object.keys(calendarDatesJson).length) {
    fs.writeFileSync(`./gtfs_parsed/${directoryName}/calendar-dates.json`, JSON.stringify(calendarDatesJson, null, 2));
}

console.log("done");
