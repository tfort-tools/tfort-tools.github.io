# How to Use
1. Obtain GTFS Bundle from certain sources.
2. Unzip downloaded file.
3. (Optional) Keep these, and delete other files in the directory.
    - `calendar_dates.txt`
    - `calendar.txt`
    - `routes.txt`
    - `stop_times.txt`
    - `stops.txt`
    - `trips.txt`
4. Move these files into `/gtfs/${agency_name}`.
5. (Optional) Create file which defines transfers between different stations.
`/gtfs_addon/${agency_name}/walking_connections.json`
6. (Optional) Run `_gtfsFilterer.js`, you can remove unnecessary routes especially when file is too large.
Change `TARGET_ROUTE_IDS` and `GTFS_DIR` to proper string.
On GitHub, you are very likely to reach file size limit, so this step is recommended.
7. Run `_gtfsParser.js` to convert GTFS into JSON.
Change `company` to proper string.
8. (Optional) Run `_gtfsJsonMerger.js`, you can concat two JSONs into single large JSON.
This is not optimized for general use, only can concat RTD and Transfort data as current version.
9. Update link queries in `index.html` to access any generated data.
10. Deploy as web server. This won't work when accessed as local resources.