import { z } from "zod";

// One check for "is this a UUID", used before an id from a URL or a request reaches a query. A malformed id is a plain
// not-found, never a database error.
export const isUuid = (value: string): boolean => z.uuid().safeParse(value).success;
