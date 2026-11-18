/**
 * Named limits and thresholds shared by the static detectors.
 * The values are those of design section 4 of the detectors-static spec.
 * The visual thresholds are the research's own suggestions (section B.5 of
 * docs/research/dark-patterns.md), not regulator values.
 */

/** Element budget per sample (full / reload). */
export const MAX_ELEMENTS_CONSIDERED = 1500;
export const MAX_RELOAD_ELEMENTS_CONSIDERED = 750;

/** Text cut before any other work (full / reload sample). */
export const MAX_TEXT_READ = 300;
export const RELOAD_TEXT_CAP = 120;

/** Caps for attribute values, style values, and role and tag names. */
export const MAX_ATTR_READ = 200;
export const MAX_STYLE_READ = 64;
export const MAX_ROLE_TAG_READ = 32;

/** Synthetic id parsing limits. */
export const MAX_ID_CHARS = 256;
export const MAX_ID_DEPTH = 64;

/** Tokeniser and word list limits. */
export const MAX_TOKENS_PER_TEXT = 80;
export const MAX_PHRASE_TOKENS = 6;

/** Longest quoted page text, before the ellipsis. */
export const MAX_QUOTE_CHARS = 120;

/** Findings kept per detector. */
export const MAX_FINDINGS_PER_DETECTOR = 20;

/** Choice group budget. */
export const MAX_CHOICE_GROUPS = 50;
export const MAX_CONTROLS_PER_GROUP = 8;

/** Container search depth for groups and labels. */
export const GROUP_MAX_LEVELS = 3;
export const LABEL_MAX_LEVELS = 3;

/** Reload gap limits and the base tolerance for countdown comparison, in seconds. */
export const MIN_GAP_SECONDS = 3;
export const MAX_GAP_SECONDS = 120;
export const TOLERANCE_BASE_SECONDS = 2;

/** Unknown time zone of a page date, in hours. */
export const DATE_ZONE_SLACK_HOURS = 14;

/** Largest stock number that supports a scarcity claim. */
export const LOW_STOCK_MAX = 10;

/** Size measures. */
export const AREA_RATIO_MIN = 2;
export const FONT_RATIO_MIN = 1.4;
export const SMALL_FONT_PX = 12;

/** Colour measures. */
export const DECLINE_CONTRAST_MAX = 3;
export const ACCEPT_CONTRAST_MIN = 4.5;
export const DECLINE_OPACITY_MAX = 0.7;

/** Close control measures. */
export const CLOSE_MIN_PX = 16;
export const CLOSE_CONTRAST_MIN = 3;

/** Largest area ratio, in either direction, still counted as equal style. */
export const EQUAL_AREA_RATIO_MAX = 1.25;

/** Opacity at or below which an element counts as hidden. */
export const HIDDEN_OPACITY_MAX = 0.01;

/** Time bound per detector in the hostile-input test, in milliseconds. */
export const HOSTILE_TIME_BUDGET_MS = 2000;
