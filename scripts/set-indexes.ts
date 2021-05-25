import monk from "monk";
import { Command } from "commander";
import CreateLogCtx from "../src/common/logger";
import { IndexOptions } from "mongodb";
import { ValidDatabases } from "kamaitachi-common";
import { supportedGames } from "kamaitachi-common/js/config";

const logger = CreateLogCtx(__filename);

const program = new Command();

program.option("-d, --db <database>", "The database to index.");
program.option(
    "-r, --reset",
    "Whether to reset all indexes on this database before indexing or not."
);

program.parse(process.argv);
const options = program.opts();

const db = monk(`${process.env.MONGO_BASE_URL ?? "127.0.0.1"}/${options.db ?? "ktblackdb"}`);

interface Index {
    fields: Record<string, unknown>;
    options?: IndexOptions;
}

function index(fields: Record<string, unknown>, options?: IndexOptions) {
    return { fields, options };
}

const UNIQUE = { unique: true };

const staticIndexes: Partial<Record<ValidDatabases, Index[]>> = {
    scores: [index({ scoreID: 1 }, UNIQUE)],
    "score-pbs": [
        index({ chartID: 1, userID: 1 }, UNIQUE),
        index({ chartID: 1, "scoreData.percent": 1 }),
    ],
    sessions: [
        // lol
        index({ timeStarted: 1, timeEnded: 1, userID: 1, game: 1, playtype: 1 }),
    ],
    "game-stats": [index({ userID: 1, game: 1, playtype: 1 }, UNIQUE)],
    "folder-chart-lookup": [index({ chartID: 1, folderID: 1 }, UNIQUE)],
    "tierlist-data": [
        index({ tierlistDataID: 1 }, UNIQUE),
        index({ chartID: 1, tierlistID: 1 }),
        index({ chartID: 1, tierlistID: 1, type: 1 }),
        index({ chartID: 1, tierlistID: 1, type: 1, key: 1 }, UNIQUE),
    ],
    goals: [index({ goalID: 1 }, UNIQUE)],
    "user-goals": [index({ goalID: 1, userID: 1 }, UNIQUE), index({ goalID: 1 })],
    milestones: [index({ milestoneID: 1 }, UNIQUE), index({ group: 1, game: 1, playtype: 1 })],
    "user-milestones": [
        index({ milestoneID: 1, userID: 1 }, UNIQUE),
        index({ userID: 1, game: 1, playtype: 1 }),
    ],
    imports: [index({ importID: 1 }, UNIQUE)],
    "import-timings": [
        index({ importID: 1 }, UNIQUE),
        index({ timestamp: 1 }),
        index({ total: 1 }),
    ],
    // @todo #96 Add more indexes to the users collection.
    users: [index({ id: 1 }, UNIQUE)],
    tierlists: [
        index({ tierlistID: 1 }, UNIQUE),
        index({ game: 1, playtype: 1, isDefault: 1 }, UNIQUE),
    ],
    folders: [
        index({ folderID: 1 }, UNIQUE),
        index({ game: 1, playtype: 1 }),
        index({ game: 1, playtype: 1, table: 1 }),
        index({ game: 1, playtype: 1, table: 1, tableIndex: 1 }),
    ],
    "kai-auth-tokens": [index({ userID: 1, service: 1 }, UNIQUE)],
    "charts-iidx": [
        index(
            { "data.arcChartID": 1 },
            { unique: true, partialFilterExpression: { "data.arcChartID": { $type: "string" } } }
        ),
        index({ "data.hashSHA256": 1 }),
    ],
};

const indexes: Partial<Record<ValidDatabases, Index[]>> = staticIndexes;

for (const game of supportedGames) {
    if (indexes[`charts-${game}` as "charts-iidx"]) {
        indexes[`charts-${game}` as "charts-iidx"]!.push(
            index({ chartID: 1 }, UNIQUE),
            index(
                { songID: 1, difficulty: 1, playtype: 1, isPrimary: 1 },
                { unique: true, partialFilterExpression: { isPrimary: { $eq: true } } }
            )
        );
    } else {
        indexes[`charts-${game}` as "charts-iidx"] = [
            index({ chartID: 1 }, UNIQUE),
            index({ songID: 1, difficulty: 1, playtype: 1, isPrimary: 1 }, UNIQUE),
        ];
    }

    if (indexes[`songs-${game}` as "songs-iidx"]) {
        indexes[`songs-${game}` as "songs-iidx"]!.push(
            index({ id: 1 }, UNIQUE),
            index({ title: 1 })
        );
    } else {
        indexes[`songs-${game}` as "songs-iidx"] = [index({ id: 1 }, UNIQUE), index({ title: 1 })];
    }
}

(async () => {
    logger.info(`Starting indexing for ${options.db ?? "ktblackdb"}...`);

    for (const collection in indexes) {
        if (options.reset) {
            // eslint-disable-next-line no-await-in-loop
            await db.get(collection).dropIndexes();
        }

        // @ts-expect-error dru(n)kts
        for (const index of indexes[collection]) {
            // eslint-disable-next-line no-await-in-loop
            const r = await db.get(collection).createIndex(index.fields, index.options);

            logger.info(r);
        }
    }

    logger.info("Done.");
})();
