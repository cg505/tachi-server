import { NextFunction, Request, Response } from "express";
import CreateLogCtx from "../logger";

const logger = CreateLogCtx("require-logged-in.ts");

export function RequireLoggedIn(req: Request, res: Response, next: NextFunction) {
    if (!req.session.ktchi?.userID) {
        logger.info(`Received unauthorised request from ${req.ip} from ${req.originalUrl}`);

        return res.status(401).json({
            success: false,
            description: `You are not authorised to perform this action.`,
        });
    }

    next();
}
