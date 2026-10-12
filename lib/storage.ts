import path from "path"

/**
 * Where uploaded images are stored (courses and lessons are in the database,
 * lib/db). Defaults to the project folder for local development; in
 * production point DATA_DIR at a persistent disk (e.g. /var/data on Render)
 * so uploads survive deploys and restarts.
 */
export const DATA_DIR = process.env.DATA_DIR || process.cwd()

/** Where courses were stored before the database; read only by scripts/import-files-to-db.ts. */
export const COURSE_DIR = path.join(DATA_DIR, "course")
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads")
