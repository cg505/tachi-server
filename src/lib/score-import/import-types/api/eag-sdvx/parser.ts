import { KtLogger } from "../../../../logger/logger";
import { KaiAuthDocument } from "tachi-common";
import { ParseKaiSDVX } from "../../common/api-kai/sdvx/parser";

export function ParseEagSDVX(authDoc: KaiAuthDocument, logger: KtLogger) {
	return ParseKaiSDVX("EAG", authDoc, logger);
}
