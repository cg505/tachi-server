/* eslint-disable @typescript-eslint/no-explicit-any */

import db from "external/mongo/db";
import CreateLogCtx from "lib/logger/logger";
import { CreateScoreID } from "lib/score-import/framework/score-importing/score-id";
import { GetGameConfig, GetGamePTConfig, ScoreDocument } from "tachi-common";
import MigrateRecords from "../migrate";
import { oldKTDB } from "../old-db";

const logger = CreateLogCtx(__filename);

async function ConvertFn(c: any): Promise<ScoreDocument | null> {
	const game = c.game;
	const playtype = c.scoreData.playtype;

	const gameConfig = GetGameConfig(game);

	if (!gameConfig.validPlaytypes.includes(playtype)) {
		logger.warn(`Ignored game pt ${game}, ${playtype}`);
		throw new Error(`Ignored game pt ${game}, ${playtype}`);
	}

	const gptConfig = GetGamePTConfig(game, playtype);

	if (!gptConfig) {
		logger.error(`No gptconfig for ${game} ${playtype}?`);
		throw new Error(`No gptconfig for ${game} ${playtype}?`);
	}

	if (c.songID === 1819) {
		c.songID = 1121; // praludium has two songs in kt1 for some reason (tricoro 6)
		// this overrides that
	}

	// @ts-expect-error implicit any is expected
	const chartDoc = await db.charts[game].findOne({
		songID: c.songID,
		difficulty: c.scoreData.difficulty,
		playtype,
	});

	if (!chartDoc) {
		logger.warn(`Cannot find ChartDoc for ${c.songID} ${c.scoreData.difficulty} ${playtype} `);
		return null;
	}

	const base: Omit<ScoreDocument<"iidx:SP" | "iidx:DP">, "scoreID"> = {
		userID: c.userID,
		songID: chartDoc.songID,
		playtype,
		chartID: chartDoc.chartID,
		game: c.game,
		timeAdded: c.timeAdded,
		timeAchieved: Number.isNaN(c.timeAchieved) ? null : c.timeAchieved,
		comment: c.comment ?? null,
		highlight: c.highlight ?? false,
		service: c.service,
		importType: null,
		// we'll just recalc calculated data instead of trying to update
		calculatedData: {},
		isPrimary: chartDoc.isPrimary,
		scoreData: {
			esd: c.scoreData.esd ?? null,
			grade: c.scoreData.grade,
			gradeIndex: gptConfig.grades.indexOf(c.scoreData.grade),
			lamp: c.scoreData.lamp,
			lampIndex: gptConfig.lamps.indexOf(c.scoreData.lamp),
			percent: c.scoreData.percent,
			score: c.scoreData.score,
			judgements: c.scoreData.hitData,
			hitMeta: c.scoreData.hitMeta,
		},
		scoreMeta: {
			random: c.scoreMeta?.optionsRandom ?? null,
			gauge: c.scoreMeta?.optionsGauge ?? null,
			assist: c.scoreMeta?.optionsAssist ?? null,
			range: c.scoreMeta?.optionsRange ?? null,
		},
	};

	if (c.scoreMeta) {
		if (base.playtype === "DP" && !Array.isArray(base.scoreMeta.random)) {
			base.scoreMeta.random = null;
		}

		if (c.scoreData.hitMeta.gauge < 0) {
			c.scoreData.hitMeta.gauge = null;
		}

		if (!Array.isArray(c.scoreData.hitMeta.gaugeHistory)) {
			c.scoreData.hitMeta.gaugeHistory = null;
		}

		// @ts-expect-error asdf
		if (base.scoreMeta.range === "") {
			base.scoreMeta.range = "NONE";
		}

		if (c.scoreMeta.deadMeasure || c.scoreMeta.deadNote) {
			base.scoreData.hitMeta.bp = null;
		}
	}

	if (base.scoreData.hitMeta.bp === -1 || Number.isNaN(base.scoreData.hitMeta.bp)) {
		base.scoreData.hitMeta.bp = null;
	}

	if ((base.scoreData.hitMeta.gauge ?? 0) > 200) {
		base.scoreData.hitMeta.gauge = null;
	}

	if (base.scoreData.hitMeta.gaugeHistory) {
		base.scoreData.hitMeta.gaugeHistory = base.scoreData.hitMeta.gaugeHistory.map((e) =>
			(e ?? 0) > 200 ? null : e
		);
	}

	const scoreID = CreateScoreID(base.userID, base, base.chartID);

	const exists = await db.scores.findOne({ scoreID });

	if (exists) {
		logger.warn(`Skipping duplicate score ${base.chartID} ${base.userID}.`);
		return null;
	}

	const score: ScoreDocument = {
		...base,
		scoreID,
	};

	await oldKTDB.get("score-id-lookup").insert({
		old: c.scoreID,
		new: scoreID,
	});

	return score;
}

export async function MigrateIIDXScores() {
	await MigrateRecords(db.scores, "scores", ConvertFn, { game: "iidx" }, true);
}

if (require.main === module) {
	(async () => {
		await MigrateIIDXScores();
		process.exit(0);
	})();
}
