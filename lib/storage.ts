import path from "path"

/**
 * Where courses and uploads are stored. Defaults to the project folder for
 * local development; in production point DATA_DIR at a persistent disk
 * (e.g. /var/data on Render) so data survives deploys and restarts.
 */
export const DATA_DIR = process.env.DATA_DIR || process.cwd()

export const COURSE_DIR = path.join(DATA_DIR, "course")
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads")
