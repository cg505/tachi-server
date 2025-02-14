import { Router } from "express";
import db from "external/mongo/db";
import CreateLogCtx from "lib/logger/logger";
import ScoreImportFatalError from "lib/score-import/framework/score-importing/score-import-error";
import ScoreImportQueue from "lib/score-import/worker/queue";
import { ServerConfig, TachiConfig } from "lib/setup/config";
import { GetRelevantSongsAndCharts } from "utils/db";
import { GetUserWithID } from "utils/user";

const router: Router = Router({ mergeParams: true });

const logger = CreateLogCtx(__filename);

/**
 * Retrieve an import with this ID.
 *
 * @name GET /api/v1/imports/:importID
 */
router.get("/:importID", async (req, res) => {
	const importDoc = await db.imports.findOne({
		importID: req.params.importID,
	});

	if (!importDoc) {
		return res.status(404).json({
			success: false,
			description: `This import does not exist.`,
		});
	}

	const scores = await db.scores.find({
		scoreID: { $in: importDoc.scoreIDs },
	});

	const { songs, charts } = await GetRelevantSongsAndCharts(scores, importDoc.game);

	const sessions = await db.sessions.find({
		sessionID: { $in: importDoc.createdSessions.map((e) => e.sessionID) },
	});

	const user = await GetUserWithID(importDoc.userID);

	if (!user) {
		logger.severe(`User ${importDoc.userID} doesn't exist, yet has a session?`);
		return res.status(500).json({
			success: false,
			description: `An internal server error has occured.`,
		});
	}

	return res.status(200).json({
		success: true,
		description: `Returned info about this session.`,
		body: {
			scores,
			songs,
			charts,
			sessions,
			import: importDoc,
			user,
		},
	});
});

/**
 * Retrieve the status of an ongoing import.
 * If the import has been finalised and was successful, return 200.
 *
 * If the import is ongoing, return its progress.
 *
 * If the import was never ongoing, return 404.
 *
 * If the import was finalised and was unsuccessful (i.e. threw a fatal error)
 * return its error information in expressified form.
 *
 * @name GET /api/v1/import/:importID/poll-status
 */
router.get("/:importID/poll-status", async (req, res) => {
	if (!ServerConfig.USE_EXTERNAL_SCORE_IMPORT_WORKER) {
		return res.status(501).json({
			success: false,
			description: `${TachiConfig.NAME} does not use an external score import worker. Polling imports is not possible. This import may be ongoing, or it may have never occured.`,
		});
	}

	const importDoc = await db.imports.findOne({ importID: req.params.importID });

	if (importDoc) {
		return res.status(200).json({
			success: true,
			description: `Import was completed!`,
			body: {
				importStatus: "completed",
			},
		});
	}

	const job = await ScoreImportQueue.getJob(req.params.importID);

	if (!job) {
		return res.status(404).json({
			success: false,
			description: `There is no ongoing import here.`,
		});
	}

	if (job.isFailed()) {
		const err = await job.finished();

		if (err instanceof ScoreImportFatalError) {
			logger.info(err.message);
			return res.status(err.statusCode).json({
				success: false,
				description: err.message,
			});
		}

		return res.status(500).json({
			success: false,
			description: `An internal service error has occured with this import. This has been reported!`,
		});
	} else if (job.isCompleted()) {
		return res.status(200).json({
			success: true,
			description: `Import was completed!`,
			body: {
				importStatus: "completed",
			},
		});
	}

	const progress = await job.progress();

	return res.status(200).json({
		success: true,
		description: `Import is ongoing.`,
		body: {
			importStatus: "ongoing",
			progress,
		},
	});
});

export default router;
