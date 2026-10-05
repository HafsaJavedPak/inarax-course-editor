"use client";

// Copied from inara-next components/ile/blocks/ImageBlock.tsx @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import Image from "next/image";
import { useState } from "react";
import type { ImageAlign, ImageSize, LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";

/** Phones get more room at the small sizes; a 40%-wide image on a 360px screen is a thumbnail. */
const SIZE_CLASS: Record<ImageSize, string> = {
  small: "w-2/3 sm:w-2/5",
  medium: "w-full sm:w-3/5",
  large: "w-full sm:w-4/5",
  full: "w-full",
};

const ALIGN_CLASS: Record<ImageAlign, { figure: string; caption: string }> = {
  left: { figure: "me-auto", caption: "text-start" },
  center: { figure: "mx-auto", caption: "text-center" },
  right: { figure: "ms-auto", caption: "text-end" },
};

export default function ImageBlock({ block }: { block: Extract<LessonBlock, { type: "image" }> }) {
  const { image_url, alt, caption, size = "full", align = "center" } = block.data;
  const [failed, setFailed] = useState(false);
  const placement = ALIGN_CLASS[align];

  return (
    <figure className={`ile-block ile-image my-8 ${SIZE_CLASS[size]} ${placement.figure}`}>
      {failed ? (
        <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
          Image unavailable: {alt}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <Image
            src={image_url}
            alt={alt}
            width={0}
            height={0}
            unoptimized
            sizes="(max-width: 768px) 100vw, 704px"
            className="h-auto w-full"
            onError={() => setFailed(true)}
          />
        </div>
      )}
      {caption ? (
        <figcaption className={`mt-3 text-sm text-slate-500 ${placement.caption}`}>{caption}</figcaption>
      ) : null}
    </figure>
  );
}
