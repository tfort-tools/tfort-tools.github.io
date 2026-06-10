const fs = require("fs");
const path = require("path");

const BASE_DIR = path.join(__dirname, "gtfs_parsed");
const RTD_DIR = path.join(BASE_DIR, "rtd");
const TRANSFORT_DIR = path.join(BASE_DIR, "transfort");
const MERGED_DIR = path.join(BASE_DIR, "merged");

const TARGET_FILES = ["calendar-dates.json", "calendar.json", "connections.json", "patterns.json", "route-list.json", "station-list.json", "stop-patterns.json", "trip-info.json", "trip-times.json"];

if (!fs.existsSync(MERGED_DIR)) {
    fs.mkdirSync(MERGED_DIR, { recursive: true });
}

const mergeObjects = (a, b) => ({ ...a, ...b });
const mergeArrays = (a, b) => [...a, ...b];

(() => {
    TARGET_FILES.forEach((fileName) => {
        const rtdPath = path.join(RTD_DIR, fileName);
        const transfortPath = path.join(TRANSFORT_DIR, fileName);
        const mergedPath = path.join(MERGED_DIR, fileName);

        let rtdData = null;
        let transfortData = null;

        if (fs.existsSync(rtdPath)) {
            rtdData = JSON.parse(fs.readFileSync(rtdPath, "utf8"));
        }
        if (fs.existsSync(transfortPath)) {
            transfortData = JSON.parse(fs.readFileSync(transfortPath, "utf8"));
        }

        let mergedResult;

        if (Array.isArray(rtdData || transfortData)) {
            mergedResult = mergeArrays(rtdData || [], transfortData || []);
        } else {
            mergedResult = mergeObjects(rtdData || {}, transfortData || {});
        }

        fs.writeFileSync(mergedPath, JSON.stringify(mergedResult, null, 2));
        console.log(`generated /gtfs_parsed/merged/${fileName}`);
    });

    console.log("done");
})();
