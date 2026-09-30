import { imageSrc } from "@/lib/uploads"

/** A course's cover image for list rows; an empty box keeps rows aligned when there is none. */
export function CourseThumb({ src }: { src: string | null }) {
  if (!src) return <span className="db-row-cover" aria-hidden />
  // eslint-disable-next-line @next/next/no-img-element -- arbitrary author-supplied URLs
  return <img className="db-row-cover" src={imageSrc(src)} alt="" />
}
