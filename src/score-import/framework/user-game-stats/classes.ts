import { Game, Playtypes, integer, UserGameStats, ClassDelta } from "kamaitachi-common";
import { gameClassValues, ClassData } from "kamaitachi-common/js/game-classes";
import deepmerge from "deepmerge";
import { KtLogger } from "../../../types";
import { CalculateGitadoraColour, CalculateJubeatColour } from "./builtin-class-handlers";
import { ReturnClassIfGreater } from "../../../common/class";

export interface ClassHandler {
    (
        game: Game,
        playtype: Playtypes[Game],
        userID: integer,
        customRatings: Record<string, number>
    ): Promise<Record<string, string>> | Record<string, string>;
}

type ClassHandlerMap = {
    [G in Game]:
        | {
              [P in Playtypes[G]]: ClassHandler;
          }
        | null;
};

/**
 * Describes the static class handlers for a game, I.E. ones that are
 * always meant to be called when new scores are found.
 *
 * These can be calculated without any external (i.e. user/api-provided) data.
 *
 * A good example of this would be, say, jubeat's colours - the boundaries depend entirely
 * on your profile skill level, which is known at the time this function is called.
 */
const STATIC_CLASS_HANDLERS: ClassHandlerMap = {
    iidx: null,
    bms: null,
    chunithm: null,
    ddr: null,
    gitadora: {
        Gita: CalculateGitadoraColour,
        Dora: CalculateGitadoraColour,
    },
    jubeat: {
        Single: CalculateJubeatColour,
    },
    maimai: null,
    museca: null,
    popn: null,
    sdvx: null,
    usc: null,
};

/**
 * Calculates a Users' Game Stats Classes. This function is rather complex, because the reality is rather complex.
 *
 * A class is simply a hard bounded division dependent on a user. Such as a Dan or a skill level dependent on a statistic.
 * Not all services expose this information in the same way, so this function takes an async resolve function,
 * which is allowed to return its own classes. These will be merged with the classes that *we* can calculate.
 *
 * As an example, we are always able to calculate things like Gitadora's colours. We know the users' skill statistic,
 * and a colour is just between X-Y skill. However, we cannot always calculate something like IIDX's dans. Infact,
 * there's no calculation involved. We need to instead request this information from a service. For things like ARC
 * they expose this on a dedicated endpoint.
 * The custom function allows us to request that data from a custom endpoint, and merge it with things we can always
 * calculate.
 *
 * @param customRatings - A users customRatings. This is calculated in rating.ts, and passed via update-ugs.ts.
 * We request this because we need it for things like gitadora's skill divisions - We don't need to calculate our skill
 * statistic twice if we just request it be passed to us!
 * @param ImportTypeClassResolveFn - The Custom Resolve Function that certain import types may pass to us as a means
 * for retrieving information about a class. This returns the same thing as this function, and it is merged with the
 * defaults.
 */
export async function UpdateUGSClasses(
    game: Game,
    playtype: Playtypes[Game],
    userID: integer,
    customRatings: Record<string, number>,
    ClassHandler: ClassHandler | null,
    logger: KtLogger
): Promise<Record<string, string>> {
    let classes: Record<string, string> = {};

    // @ts-expect-error This one sucks - I need to look into a better way of representing these types
    if (STATIC_CLASS_HANDLERS[game] && STATIC_CLASS_HANDLERS[game][playtype]) {
        // @ts-expect-error see above
        classes = await STATIC_CLASS_HANDLERS[game][playtype](
            game,
            playtype,
            userID,
            customRatings
        );
    }

    if (ClassHandler) {
        logger.debug(`Calling custom class handler.`);
        let customClasses = await ClassHandler(game, playtype, userID, customRatings);

        classes = deepmerge(customClasses, classes);
    }

    return classes;
}

/**
 * Calculates the class "deltas" for this users classes.
 * This is for calculating scenarios where a users class has improved (i.e. they have gone from 9th dan to 10th dan).
 *
 * Knowing this information allows us to attach it onto the import, and also emit things on redis
 * so that other services can listen for it. In the future we might allow webhooks, too.
 */
export function CalculateClassDeltas(
    game: Game,
    playtype: Playtypes[Game],
    classes: Record<string, string>,
    userGameStats: UserGameStats | null,
    logger: KtLogger
): ClassDelta[] {
    // @ts-expect-error It's complaining about Game+PT permutations instead of Game->PT permutations.
    let gcv = gameClassValues[game]?.[playtype];

    if (Object.keys(classes).length !== 0 && !gcv) {
        logger.severe(
            `Classes were attempted to be processed for ${game} ${playtype}, but no class values exist for this.`,
            {
                classes,
            }
        );

        return [];
    }

    let deltas = [];

    for (const setName in classes) {
        try {
            let isGreater = ReturnClassIfGreater(
                game,
                playtype,
                setName,
                classes[setName],
                userGameStats
            );

            if (isGreater === false) {
                continue;
            } else if (isGreater === null) {
                // @todo REDISIPC-New Class Achieved
                deltas.push({
                    game,
                    playtype,
                    old: null,
                    new: classes[setName],
                });
            }

            // @todo REDISIPC-Class Improved!
            deltas.push({
                game,
                playtype,
                old: userGameStats!.classes[setName],
                new: classes[setName],
            });
        } catch (err) {
            logger.error(err);
        }
    }

    return deltas;
}
