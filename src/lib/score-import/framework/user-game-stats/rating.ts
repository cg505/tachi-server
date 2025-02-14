import {
	Game,
	Playtypes,
	integer,
	ScoreCalculatedDataLookup,
	IDStrings,
	UserGameStats,
	PBScoreDocument,
} from "tachi-common";
import db from "external/mongo/db";
import { KtLogger } from "lib/logger/logger";

type CustomCalcNames = ScoreCalculatedDataLookup[IDStrings];

function LazySumAll(key: CustomCalcNames) {
	return async (game: Game, playtype: Playtypes[Game], userID: integer) => {
		const sc = await db["personal-bests"].find({
			game: game,
			playtype: playtype,
			userID: userID,
			isPrimary: true,
			[`calculatedData.${key}`]: { $gt: 0 },
		});

		const result = sc.reduce((a, b) => a + b.calculatedData[key]!, 0);

		return result;
	};
}

function LazyCalcN(key: CustomCalcNames, n: integer, returnMean?: boolean) {
	return async (game: Game, playtype: Playtypes[Game], userID: integer) => {
		const sc = await db["personal-bests"].find(
			{
				game: game,
				playtype: playtype,
				userID: userID,
				isPrimary: true,
				[`calculatedData.${key}`]: { $gt: 0 },
			},
			{
				limit: n,
				sort: { [`calculatedData.${key}`]: -1 },
			}
		);

		let result = sc.reduce((a, b) => a + b.calculatedData[key]!, 0);

		if (returnMean) {
			result = result / n;
		}

		return result;
	};
}

const LazySumN = (key: CustomCalcNames, n: integer) => LazyCalcN(key, n, false);
const LazyMeanN = (key: CustomCalcNames, n: integer) => LazyCalcN(key, n, true);

type RatingFunctions = {
	[G in Game]: {
		[P in Playtypes[G]]: (
			game: Game,
			playtype: Playtypes[Game],
			userID: integer,
			logger: KtLogger
		) => Promise<UserGameStats["ratings"]>;
	};
};

const RatingFunctions: RatingFunctions = {
	iidx: {
		SP: async (g, p, u) => ({
			BPI: await LazyMeanN("BPI", 20)(g, p, u),
			ktRating: await LazyMeanN("ktRating", 20)(g, p, u),
			ktLampRating: await LazyMeanN("ktLampRating", 20)(g, p, u),
		}),
		DP: async (g, p, u) => ({
			BPI: await LazyMeanN("BPI", 20)(g, p, u),
			ktRating: await LazyMeanN("ktRating", 20)(g, p, u),
			ktLampRating: await LazyMeanN("ktLampRating", 20)(g, p, u),
		}),
	},
	sdvx: {
		Single: async (g, p, u) => ({
			VF6: await LazySumN("VF6", 50)(g, p, u),
		}),
	},
	usc: {
		Keyboard: async (g, p, u) => ({
			VF6: await LazySumN("VF6", 50)(g, p, u),
		}),
		Controller: async (g, p, u) => ({
			VF6: await LazySumN("VF6", 50)(g, p, u),
		}),
	},
	ddr: {
		SP: async (g, p, u) => ({
			MFCP: await LazySumAll("MFCP")(g, p, u),
			ktRating: await LazyMeanN("ktRating", 20)(g, p, u),
		}),
		DP: async (g, p, u) => ({
			MFCP: await LazySumAll("MFCP")(g, p, u),
			ktRating: await LazyMeanN("ktRating", 20)(g, p, u),
		}),
	},
	gitadora: {
		Gita: async (g, p, u, l) => ({ skill: await CalculateGitadoraSkill(g, p, u, l) }),
		Dora: async (g, p, u, l) => ({ skill: await CalculateGitadoraSkill(g, p, u, l) }),
	},
	bms: {
		"7K": async (g, p, u) => ({
			ktLampRating: await LazyMeanN("ktLampRating", 20)(g, p, u),
		}),
		"14K": async (g, p, u) => ({
			ktLampRating: await LazyMeanN("ktLampRating", 20)(g, p, u),
		}),
	},
	chunithm: {
		Single: async (g, p, u) => ({
			naiveRating: await LazyMeanN("rating", 20)(g, p, u),
		}),
	},
	// popn: {
	// 	"9B": async () => ({}),
	// },
	museca: {
		Single: async (g, p, u) => ({
			ktRating: await LazyMeanN("ktRating", 20)(g, p, u),
		}),
	},
	maimai: {
		Single: async (g, p, u) => ({
			ktRating: await LazyMeanN("ktRating", 20)(g, p, u),
		}),
	},
	// jubeat: {
	// 	Single: async (g, p, u, l) => ({
	// 		jubility: await CalculateJubility(g, p, u, l),
	// 	}),
	// },
};

export function CalculateRatings(
	game: Game,
	playtype: Playtypes[Game],
	userID: integer,
	logger: KtLogger
): Promise<Partial<Record<CustomCalcNames, number>>> {
	// @ts-expect-error too lazy to type this properly
	return RatingFunctions[game][playtype](game, playtype, userID, logger);
}

async function CalculateGitadoraSkill(
	game: Game,
	playtype: Playtypes[Game],
	userID: integer,
	logger: KtLogger
) {
	const hotSongIDs = (
		await db.songs.gitadora.find({ "data.isHot": true }, { projection: { id: 1 } })
	).map((e) => e.id);

	// get it
	const coldSongIDs = (
		await db.songs.gitadora.find({ "data.isHot": false }, { projection: { id: 1 } })
	).map((e) => e.id);

	const [bestHotScores, bestScores] = await Promise.all([
		GetBestRatingOnSongs(hotSongIDs, userID, game, playtype, "skill"),
		GetBestRatingOnSongs(coldSongIDs, userID, game, playtype, "skill"),
	]);

	let skill = 0;
	skill += bestHotScores.reduce((a, r) => a + r.calculatedData.skill!, 0);
	skill += bestScores.reduce((a, r) => a + r.calculatedData.skill!, 0);

	return skill;
}

export async function GetBestRatingOnSongs(
	songIDs: integer[],
	userID: integer,
	game: Game,
	playtype: Playtypes[Game],
	ratingProp: "skill",
	limit = 25
): Promise<PBScoreDocument[]> {
	const r = await db["personal-bests"].aggregate([
		{
			$match: {
				game,
				playtype,
				userID,
				songID: { $in: songIDs },
			},
		},
		{
			$sort: {
				[`calculatedData.${ratingProp}`]: -1,
			},
		},
		{
			$group: {
				_id: "$songID",
				doc: { $first: "$$ROOT" },
			},
		},
		{
			$limit: limit,
		},
	]);

	return r.map((e: { _id: integer; doc: PBScoreDocument }) => e.doc);
}

// async function CalculateJubility(
// 	game: Game,
// 	playtype: Playtypes[Game],
// 	userID: integer,
// 	logger: KtLogger
// ): Promise<number> {
// 	const hotCharts = await db.charts.jubeat.find(
// 		{ "flags.HOT N-1": true },
// 		{ projection: { chartID: 1 } }
// 	);

// 	const hotChartIDs = hotCharts.map((e) => e.chartID);

// 	const [bestHotScores, bestScores] = await Promise.all([
// 		db["personal-bests"].find(
// 			{ userID, chartID: { $in: hotChartIDs } },
// 			{
// 				sort: { "calculatedData.jubility": -1 },
// 				limit: 25,
// 				projection: { "calculatedData.jubility": 1 },
// 			}
// 		),
// 		// @inefficient
// 		// see gitadoraskillcalc
// 		db["personal-bests"].find(
// 			{ userID, chartID: { $nin: hotChartIDs } },
// 			{
// 				sort: { "calculatedData.jubility": -1 },
// 				limit: 25,
// 				projection: { "calculatedData.jubility": 1 },
// 			}
// 		),
// 	]);

// 	let skill = 0;
// 	skill += bestHotScores.reduce((a, r) => a + r.calculatedData.jubility!, 0);
// 	skill += bestScores.reduce((a, r) => a + r.calculatedData.jubility!, 0);

// 	return skill;
// }
