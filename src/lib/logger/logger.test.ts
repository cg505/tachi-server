import t from "tap";
import { CloseAllConnections } from "../../test-utils/close-connections";
import CreateLogCtx, { Transports } from "./logger";

t.test("Logger Tests", (t) => {
	const logger = CreateLogCtx(__filename);

	Transports[0].level = "debug"; // lol

	logger.debug("Debug Message Test");
	logger.verbose("Verbose Message Test");
	logger.info("Info Message Test");
	logger.warn("Warning Message Test");
	logger.error("Error Message Test");
	logger.severe("Severe Message Test");
	logger.crit("Critical Message Test");

	Transports[0].level = process.env.LOG_LEVEL ?? "info";

	logger.debug("This message shouldn't appear.");

	t.end();
});

t.teardown(CloseAllConnections);
