/**
 * HTTP status code constants.
 * Keeps magic numbers out of controllers and middleware.
 * @module constants/httpStatus
 */

/** @type {200} */
export const OK = 200;

/** @type {201} */
export const CREATED = 201;

/** @type {400} */
export const BAD_REQUEST = 400;

/** @type {409} */
export const CONFLICT = 409;

/** @type {401} */
export const UNAUTHORIZED = 401;

/** @type {403} */
export const FORBIDDEN = 403;

/** @type {404} */
export const NOT_FOUND = 404;

/** @type {500} */
export const INTERNAL_SERVER_ERROR = 500;

/** @type {502} */
export const BAD_GATEWAY = 502;

/** @type {503} */
export const SERVICE_UNAVAILABLE = 503;
