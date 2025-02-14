import { Router } from "express";
import { ServerConfig } from "lib/setup/config";
import { RequireBokutachi } from "server/middleware/type-require";

const router: Router = Router({ mergeParams: true });

/**
 * Returns the value of the BEATORAJA_QUEUE_SIZE.
 *
 * @name GET /api/v1/config/beatoraja-queue-size
 */
router.get("/beatoraja-queue-size", RequireBokutachi, (req, res) =>
	res.status(200).json({
		success: true,
		description: `Returned BEATORAJA_QUEUE_SIZE.`,
		body: ServerConfig.BEATORAJA_QUEUE_SIZE,
	})
);

/**
 * Returns the value of the USC_QUEUE_SIZE.
 *
 * @name GET /api/v1/config/usc-queue-size
 */
router.get("/usc-queue-size", RequireBokutachi, (req, res) =>
	res.status(200).json({
		success: true,
		description: `Returned USC_QUEUE_SIZE.`,
		body: ServerConfig.USC_QUEUE_SIZE,
	})
);

export default router;
