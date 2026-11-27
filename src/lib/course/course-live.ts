/**
 * Whether the free course (/course/*) is public. Owner decision 2026-11-18: not yet.
 *
 * The ONE switch: src/app/course/layout.tsx shows a "Coming soon" placeholder while this is false,
 * and every page that links to the course (e.g. /roadmap) labels those links "(coming soon)" and
 * makes them non-clickable instead of sending visitors to that placeholder. Flip to true to launch.
 */
export const COURSE_LIVE: boolean = false;
