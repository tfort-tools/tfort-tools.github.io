const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify');

// ==========================================
// 設定：抽出したい route_id の配列
// ==========================================
const TARGET_ROUTE_IDS = ['FF1', 'FF2', "GS", "107R", "101E", "101T", "101C", "103W", "113B", "113G", "A", "117N"]; 
const GTFS_DIR = './gtfs/rtd'; // GTFSファイルの入っているディレクトリ

// 配列を高速検索用のSetに変換
const targetRoutes = new Set(TARGET_ROUTE_IDS);

// メモリ節約のため、紐づくIDを保持するSet
const keepTripIds = new Set();
const keepServiceIds = new Set();
const keepStopIds = new Set();

/**
 * 1行ずつCSVをストリーム読み込みして処理する汎用関数 (メモリ対策)
 */
function processFileLines(fileName, onRow) {
    return new Promise((resolve) => {
        const filePath = path.join(GTFS_DIR, fileName);
        if (!fs.existsSync(filePath)) {
            console.log(`[スキップ] ${fileName} が見つかりません。`);
            return resolve();
        }

        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        let header = null;
        rl.on('line', (line) => {
            if (!header) {
                // 初めの1行をヘッダーとしてパース
                header = parse(line)[0];
                return;
            }
            // 2行目以降をパース
            const parsed = parse(line)[0];
            if (!parsed) return;

            // 配列をオブジェクトに変換
            const row = {};
            header.forEach((key, index) => { row[key] = parsed[index]; });
            onRow(row);
        });

        rl.on('close', () => resolve());
    });
}

/**
 * 条件に合う行だけを新しいファイルに書き出すストリーム関数
 */
function filterAndSaveFile(fileName, shouldKeepRow) {
    return new Promise((resolve) => {
        const inputPath = path.join(GTFS_DIR, fileName);
        const outputPath = path.join(GTFS_DIR, `_tmp_${fileName}`);

        if (!fs.existsSync(inputPath)) return resolve();

        const fileStream = fs.createReadStream(inputPath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        const writeStream = fs.createWriteStream(outputPath);

        const stringifier = stringify({ header: true });
        stringifier.pipe(writeStream);

        let header = null;
        rl.on('line', (line) => {
            if (!header) {
                header = parse(line)[0];
                return;
            }
            const parsed = parse(line)[0];
            if (!parsed) return;

            const row = {};
            header.forEach((key, index) => { row[key] = parsed[index]; });

            if (shouldKeepRow(row)) {
                stringifier.write(row);
            }
        });

        rl.on('close', () => {
            stringifier.end();
            writeStream.on('finish', () => {
                // 一時ファイルを本番ファイルに上書き置換
                fs.unlinkSync(inputPath);
                fs.renameSync(outputPath, inputPath);
                console.log(`[完了] ${fileName} の上書き保存が完了しました。`);
                resolve();
            });
        });
    });
}

// ==========================================
// メイン処理フロー
// ==========================================
async function main() {
    console.log('--- 1段階目: 関係するIDの収集 (ストリーム解析) ---');

    // 1. routes.txt から対象の route_id をフィルタリング
    // (routesは通常小さいためメモリ上で処理しても安全ですが統一のためストリーム処理)
    console.log('routes.txt を解析中...');
    await filterAndSaveFile('routes.txt', (row) => targetRoutes.has(row.route_id));

    // 2. trips.txt を解析して、対象の route_id に紐づく trip_id と service_id を収集
    console.log('trips.txt を解析中...');
    await processFileLines('trips.txt', (row) => {
        if (targetRoutes.has(row.route_id)) {
            keepTripIds.add(row.trip_id);
            keepServiceIds.add(row.service_id);
        }
    });

    // 3. 巨大な stop_times.txt を一度走査して、必要な stop_id を収集
    console.log('stop_times.txt から必要な駅IDを収集中...');
    await processFileLines('stop_times.txt', (row) => {
        if (keepTripIds.has(row.trip_id)) {
            keepStopIds.add(row.stop_id);
        }
    });

    console.log(`収集完了: Trips=${keepTripIds.size}件, Services=${keepServiceIds.size}件, Stops=${keepStopIds.size}件`);
    console.log('--- 2段階目: ファイルの間引きと上書き実行 ---');

    // 4. trips.txt を必要な行だけに上書き
    await filterAndSaveFile('trips.txt', (row) => targetRoutes.has(row.route_id));

    // 5. 巨大な stop_times.txt を必要な行だけに上書き (ストリームなので安全)
    console.log('stop_times.txt を書き換え中...');
    await filterAndSaveFile('stop_times.txt', (row) => keepTripIds.has(row.trip_id));

    // 6. stops.txt を上書き
    console.log('stops.txt を書き換え中...');
    await filterAndSaveFile('stops.txt', (row) => keepStopIds.has(row.stop_id));

    // 7. calendar.txt を上書き
    console.log('calendar.txt を書き換え中...');
    await filterAndSaveFile('calendar.txt', (row) => keepServiceIds.has(row.service_id));

    // 8. calendar_dates.txt を上書き
    console.log('calendar_dates.txt を書き換え中...');
    await filterAndSaveFile('calendar_dates.txt', (row) => keepServiceIds.has(row.service_id));

    console.log('🎉 すべてのGTFSファイルの間引き・上書きが安全に完了しました！');
}

main().catch(console.error);
