import { KtLogger } from "lib/logger/logger";
import { BatchManualScore } from "tachi-common";
import { ParseBatchManualFromObject } from "../../common/batch-manual/parser";
import { BatchManualContext } from "../../common/batch-manual/types";
import { ParserFunctionReturns } from "../../common/types";

/**
 * Parses an object of BATCH-MANUAL data.
 * @param fileData - The buffer to parse.
 * @param body - The request body that made this file import request.
 */
function ParseDirectManual(
	body: Record<string, unknown>,
	logger: KtLogger
): ParserFunctionReturns<BatchManualScore, BatchManualContext> {
	return ParseBatchManualFromObject(body, "ir/direct-manual", logger);
}

export default ParseDirectManual;
