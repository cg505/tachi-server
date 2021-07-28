import { KtLogger } from "lib/logger/logger";
import { ParseKaiIIDX } from "../../common/api-kai/iidx/parser";
import { KaiAuthDocument } from "tachi-common";

export function ParseEagIIDX(authDoc: KaiAuthDocument, logger: KtLogger) {
	return ParseKaiIIDX("EAG", authDoc, logger);
}
