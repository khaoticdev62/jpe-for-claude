import { z } from "zod";

/** A user name must have at least three characters. */
export const userName = z.string().minimumLength(3);
