import crypto from "crypto";
import db from "external/mongo/db";
import { AppendLogCtx, KtLogger } from "lib/logger/logger";
import {
	Game,
	ImportTypes,
	integer,
	PBScoreDocument,
	Playtypes,
	ScoreDocument,
	SessionDocument,
	SessionInfoReturn,
	SessionScoreInfo,
} from "tachi-common";
import { GetScoresFromSession } from "utils/session";
import { ScorePlaytypeMap } from "../common/types";
import { CreateSessionCalcData } from "./calculated-data";
import { GenerateRandomSessionName } from "./name-generation";

const TWO_HOURS = 1000 * 60 * 60 * 2;

export async function CreateSessions(
	userID: integer,
	importType: ImportTypes,
	game: Game,
	scorePtMap: ScorePlaytypeMap,
	logger: KtLogger
) {
	const allSessionInfo = [];

	/* eslint-disable no-await-in-loop */
	for (const playtype in scorePtMap) {
		// @ts-expect-error This is my least favourite thing about ts.
		const scores = scorePtMap[playtype] as ScoreDocument[];

		const sessionInfo = await LoadScoresIntoSessions(
			userID,
			importType,
			scores,
			game,
			playtype as Playtypes[Game],
			logger
		);

		allSessionInfo.push(...sessionInfo);
	}
	/* eslint-enable no-await-in-loop */

	return allSessionInfo;
}

/**
 * Compares a score and the previous PB the user had and returns the difference
 * as a SessionScoreInfo object.
 */
function ProcessScoreIntoSessionScoreInfo(
	score: ScoreDocument,
	previousPB: PBScoreDocument | undefined
): SessionScoreInfo {
	if (!previousPB) {
		return {
			scoreID: score.scoreID,
			isNewScore: true,
		};
	}

	return {
		scoreID: score.scoreID,
		isNewScore: false,
		gradeDelta: score.scoreData.gradeIndex - previousPB.scoreData.gradeIndex,
		lampDelta: score.scoreData.lampIndex - previousPB.scoreData.lampIndex,
		percentDelta: score.scoreData.percent - previousPB.scoreData.percent,
		scoreDelta: score.scoreData.score - previousPB.scoreData.score,
	};
}

export function CreateSessionID() {
	return `Q${crypto.randomBytes(20).toString("hex")}`;
}

function UpdateExistingSession(
	existingSession: SessionDocument,
	newInfo: SessionScoreInfo[],
	oldScores: ScoreDocument[],
	newScores: ScoreDocument[]
) {
	const allScores = [...oldScores, ...newScores];

	const calculatedData = CreateSessionCalcData(
		existingSession.game,
		existingSession.playtype,
		allScores
	);

	existingSession.calculatedData = calculatedData;
	existingSession.scoreInfo = [...existingSession.scoreInfo, ...newInfo];

	if (newScores[0].timeAchieved! < existingSession.timeStarted) {
		existingSession.timeStarted = newScores[0].timeAchieved!;
	}

	if (newScores[newScores.length - 1].timeAchieved! > existingSession.timeEnded) {
		existingSession.timeEnded = newScores[newScores.length - 1].timeAchieved!;
	}

	return existingSession;
}

function CreateSession(
	userID: integer,
	importType: ImportTypes,
	groupInfo: SessionScoreInfo[],
	groupScores: ScoreDocument[],
	game: Game,
	playtype: Playtypes[Game]
): SessionDocument {
	const name = GenerateRandomSessionName();

	const calculatedData = CreateSessionCalcData(game, playtype, groupScores);

	return {
		userID,
		importType,
		name,
		sessionID: CreateSessionID(),
		desc: null,
		game,
		playtype,
		highlight: false,
		scoreInfo: groupInfo,
		timeInserted: Date.now(),
		timeStarted: groupScores[0].timeAchieved!,
		timeEnded: groupScores[groupScores.length - 1].timeAchieved!,
		calculatedData,
		views: 0,
	};
}

export async function LoadScoresIntoSessions(
	userID: integer,
	importType: ImportTypes,
	importScores: ScoreDocument[],
	game: Game,
	playtype: Playtypes[Game],
	baseLogger: KtLogger
): Promise<SessionInfoReturn[]> {
	const logger = AppendLogCtx("Session Generation", baseLogger);

	const timestampedScores = [];

	for (const score of importScores) {
		if (!score.timeAchieved) {
			logger.verbose(`Ignored score ${score.scoreID}, as it had no timeAchieved.`);
			// ignore scores without timestamps. We can't use these for sessions.
			continue;
		}

		timestampedScores.push(score);
	}

	// If we have nothing to work with, why bother?
	if (timestampedScores.length === 0) {
		logger.verbose(`Skipped calculating sessions as there were no timestamped scores`);
		return [];
	}

	// sort scores ascendingly.
	timestampedScores.sort((a, b) => a.timeAchieved! - b.timeAchieved!);

	// The "Score Groups" for the array of scores provided.
	// This contains scores split on 2hr margins, which allows for more optimised
	// session db requests.
	const sessionScoreGroups: ScoreDocument[][] = [];
	let curGroup: ScoreDocument[] = [];
	let lastTimestamp = 0;

	for (const score of timestampedScores) {
		if (score.timeAchieved! < lastTimestamp + TWO_HOURS) {
			curGroup.push(score);
		} else {
			sessionScoreGroups.push(curGroup);
			curGroup = [score];
		}
		lastTimestamp = score.timeAchieved!;
	}

	// There's no state here where curGroup is empty,
	// so push the group (which is guaranteed to have atleast one score)
	sessionScoreGroups.push(curGroup);

	logger.verbose(`Created ${sessionScoreGroups.length} groups from timestamped scores.`);

	const sessionInfoReturns: SessionInfoReturn[] = [];

	// All async operations inside here *need* to be done in lockstep to avoid colliding sessions.
	// realistically, that shouldn't be possible, but hey.
	/* eslint-disable no-await-in-loop */
	for (const groupScores of sessionScoreGroups) {
		if (groupScores.length === 0) {
			continue;
		}

		const startOfGroup = groupScores[0].timeAchieved!;
		const endOfGroup = groupScores[groupScores.length - 1].timeAchieved!;

		// A bug exists here where if a session is created
		// backwards in time, this will grab your PBs
		// from the future.
		// @todo #179
		const pbs = await db["personal-bests"].find({
			chartID: { $in: groupScores.map((e) => e.chartID) },
			userID,
		});

		const pbMap: Map<string, PBScoreDocument> = new Map();
		for (const pb of pbs) {
			pbMap.set(pb.chartID, pb);
		}

		const groupInfo = groupScores.map((e) =>
			ProcessScoreIntoSessionScoreInfo(e, pbMap.get(e.chartID))
		);

		// Find any sessions with +/-2hrs of this group. This is rather exhaustive, and could result in some issues
		// if this query returns more than one session. We should account for that by smushing sessions together.
		// As of now, we dont currently do it. @TODO #148.
		const nearbySession = await db.sessions.findOne({
			userID,
			game,
			playtype,
			importType,
			$or: [
				{ timeStarted: { $gte: startOfGroup - TWO_HOURS, $lt: endOfGroup + TWO_HOURS } },
				{ timeEnded: { $gte: startOfGroup - TWO_HOURS, $lt: endOfGroup + TWO_HOURS } },
			],
		});

		let infoReturn: SessionInfoReturn;

		if (nearbySession) {
			logger.verbose(
				`Found nearby session for ${userID} (${game} ${playtype}) around ${startOfGroup} ${endOfGroup}.`
			);

			const oldScores = await GetScoresFromSession(nearbySession);

			const session = UpdateExistingSession(nearbySession, groupInfo, oldScores, groupScores);

			infoReturn = { sessionID: session.sessionID, type: "Appended" };

			await db.sessions.update(
				{
					sessionID: session.sessionID,
				},
				{
					$set: session,
				}
			);
		} else {
			logger.debug(
				`Creating new session for ${userID} (${game} ${playtype}) around ${startOfGroup} ${endOfGroup}.`
			);

			const session = CreateSession(
				userID,
				importType,
				groupInfo,
				groupScores,
				game,
				playtype
			);

			infoReturn = { sessionID: session.sessionID, type: "Created" };
			await db.sessions.insert(session);
		}

		sessionInfoReturns.push(infoReturn);
	}
	/* eslint-enable no-await-in-loop */

	return sessionInfoReturns;
}
