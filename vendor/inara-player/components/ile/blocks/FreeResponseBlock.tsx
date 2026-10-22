"use client";

// Copied from inara-next components/ile/blocks/FreeResponseBlock.tsx @ 767dad963cb6 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { useEffect, useId, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import Markdown from "@/vendor/inara-player/components/Markdown";
import { FREE_RESPONSE_FIELD_MAX_CHARS, FREE_RESPONSE_MAX_CHARS, type LessonBlock } from "@/vendor/inara-player/lib/lesson-content/schema";
import { useLessonProgress } from "@/vendor/inara-player/components/ile/LessonProgressProvider";
import { useLessonText } from "@/vendor/inara-player/components/ile/LessonLanguageProvider";
import { BlockButton, BlockCard, BlockFeedback } from "@/vendor/inara-player/components/ile/blocks/BlockCard";
import { EXPLORE_POINTS } from "@/vendor/inara-player/lib/ile/scoring";
import {
  completeEntryCount,
  countResponseWords,
  decodeFormResponse,
  encodeFormResponse,
  fieldMaxChars,
  formEntryCounts,
  groupRatingFields,
  isEntryComplete,
  isResponseLongEnough,
  type FormEntries,
} from "@/vendor/inara-player/lib/ile/responses";
import { loadLessonResponses, saveLessonResponse } from "@/vendor/inara-player/lib/ile/responses-client";
import FormPreviewCard from "@/vendor/inara-player/components/ile/blocks/FormPreviewCard";

type SaveState = "idle" | "saving" | "saved" | "error";
type FreeResponse = Extract<LessonBlock, { type: "free_response" }>;

const inputClass =
  "w-full rounded-xl border-[1.5px] border-slate-200 bg-white px-3.5 py-2.5 text-[14px] leading-relaxed text-slate-800 focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30";

/**
 * The learner's saved answer and how to save a new one. Brings back an answer saved earlier
 * (another device, or before the lesson was completed) and hands it to `onLoaded`; the admin
 * preview has no learner, so it never calls the API.
 */
function useSavedResponse(block: FreeResponse, onLoaded: (saved: string) => void) {
  const { lessonId, persistPoints, markBlockComplete, isBlockComplete } = useLessonProgress();
  const complete = isBlockComplete(block.id);
  const [saved, setSaved] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  useEffect(() => {
    if (!persistPoints) return;
    let cancelled = false;
    void loadLessonResponses(lessonId).then((all) => {
      const value = all[block.id];
      if (cancelled || value === undefined) return;
      setSaved(value);
      onLoadedRef.current(value);
    });
    return () => {
      cancelled = true;
    };
  }, [lessonId, persistPoints, block.id]);

  /** Save an answer; resolves true once it is stored. */
  const save = async (response: string): Promise<boolean> => {
    if (state === "saving") return false;
    setState("saving");
    const ok = persistPoints ? await saveLessonResponse(lessonId, block.id, response) : true;
    if (!ok) {
      setState("error");
      return false;
    }
    setSaved(response);
    setState("saved");
    if (!complete) markBlockComplete(block.id);
    return true;
  };

  return { saved, state, setState, save, complete };
}

function Guidance({ items }: { items?: string[] }) {
  const t = useLessonText();
  if (!items?.length) return null;
  return (
    <BlockFeedback tone="neutral">
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.1em] text-slate-600 rtl:tracking-normal">
        {t("freeResponseGuidance")}
      </span>
      <ul className="list-disc space-y-1 ps-5">
        {items.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
    </BlockFeedback>
  );
}

const secondaryButtonClass =
  "flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50";

/**
 * Under a submitted answer: "Submitted" once the block is done, or, after a lesson reset
 * (answer kept, block not done), a button to submit it again as it is. Edit reopens it.
 */
function SubmittedActions({
  complete,
  saving,
  onResubmit,
  onEdit,
}: {
  complete: boolean;
  saving: boolean;
  onResubmit: () => void;
  onEdit: () => void;
}) {
  const t = useLessonText();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {complete ? (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700" aria-live="polite">
          <Check className="h-4 w-4" aria-hidden /> {t("freeResponseSubmitted")}
        </span>
      ) : (
        <BlockButton onClick={onResubmit} disabled={saving}>
          {t("freeResponseSubmit")}
        </BlockButton>
      )}
      <button type="button" onClick={onEdit} className={secondaryButtonClass}>
        <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("freeResponseEdit")}
      </button>
    </div>
  );
}

export default function FreeResponseBlock({ block }: { block: FreeResponse }) {
  return block.data.fields ? <FormResponse block={block} /> : <TextResponse block={block} />;
}

/**
 * One box: the learner writes at least `min_words` words and saves. A saved answer shows
 * read-only, with Edit to change it.
 */
function TextResponse({ block }: { block: FreeResponse }) {
  const t = useLessonText();
  const { prompt, placeholder, min_words: minWords, guidance } = block.data;
  const fieldId = useId();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(true);
  const touched = useRef(false);
  // A saved answer fills the box and shows read-only, unless the learner has started typing.
  const { saved, state, setState, save, complete } = useSavedResponse(block, (value) => {
    if (touched.current) return;
    setText(value);
    setEditing(false);
  });

  const words = countResponseWords(text);
  const ready = isResponseLongEnough(text, minWords);
  const submit = async (value: string) => {
    if (await save(value)) setEditing(false);
  };

  return (
    <BlockCard
      kind="free_response"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={t("freeResponseHint", { min: minWords })}
      complete={complete}
    >
      <Markdown content={prompt} variant="lesson" />
      <Guidance items={guidance} />
      {!editing && saved !== null ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="mb-1 text-xs font-bold uppercase tracking-[0.1em] text-slate-500 rtl:tracking-normal">
              {t("freeResponseYourAnswer")}
            </div>
            <p className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-800">{saved}</p>
          </div>
          <SubmittedActions
            complete={complete}
            saving={state === "saving"}
            onResubmit={() => void submit(saved)}
            onEdit={() => setEditing(true)}
          />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor={fieldId} className="sr-only">
              {t("blockFreeResponse")}
            </label>
            <textarea
              id={fieldId}
              value={text}
              onChange={(e) => {
                touched.current = true;
                setText(e.target.value);
                if (state !== "saving") setState("idle");
              }}
              placeholder={placeholder}
              maxLength={FREE_RESPONSE_MAX_CHARS}
              rows={6}
              className={`${inputClass} resize-y py-3`}
            />
            <div className="text-sm text-slate-500" aria-live="polite">
              {t("freeResponseWords", { n: words, min: minWords })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <BlockButton onClick={() => ready && void submit(text)} disabled={!ready || state === "saving"}>
              {saved === null ? t("freeResponseSave") : t("freeResponseUpdate")}
            </BlockButton>
            {saved !== null ? (
              <button
                type="button"
                onClick={() => {
                  setText(saved);
                  setEditing(false);
                }}
                className={secondaryButtonClass}
              >
                {t("freeResponseCancel")}
              </button>
            ) : null}
          </div>
        </>
      )}
      {state === "error" ? <BlockFeedback tone="warn">{t("freeResponseError")}</BlockFeedback> : null}
    </BlockCard>
  );
}

/** A submitted form, read-only: each entry that has anything in it, field by field. */
/**
 * The field whose answer names an entry's card: the first one, when it's a one-line answer
 * like a task name. A long answer or a choice would make a poor title, so the card is then
 * called "{entry label} {n}".
 */
function titleField(fields: NonNullable<FreeResponse["data"]["fields"]>) {
  const first = fields[0];
  return first && !first.long && !first.options ? first : null;
}

function FormSummary({
  fields,
  entries,
  entryLabel,
}: {
  fields: NonNullable<FreeResponse["data"]["fields"]>;
  entries: FormEntries;
  entryLabel: string;
}) {
  const t = useLessonText();
  const filled = entries
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => fields.some((f) => (entry[f.id] ?? "").trim()));
  const many = entries.length > 1;
  const named = many ? titleField(fields) : null;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500 rtl:tracking-normal">
        {t("freeResponseYourAnswer")}
      </div>
      {filled.map(({ entry, i }) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          {many ? (
            <div className="mb-2 flex items-center gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">
                {i + 1}
              </span>
              <span className="font-semibold text-slate-900">
                {(named ? (entry[named.id] ?? "").trim() : "") || `${entryLabel} ${i + 1}`}
              </span>
            </div>
          ) : null}
          <dl className="m-0 flex flex-col gap-2">
            {fields.filter((f) => f !== named).map((f) => (
              <div key={f.id}>
                <dt className="text-[13px] font-semibold text-slate-500">{f.label}</dt>
                <dd className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed text-slate-800">
                  {(entry[f.id] ?? "").trim() || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * A form, like a lab: labelled fields, repeated once per entry ("System 1"…"System 5").
 * The learner submits the whole form once enough entries are complete; a submitted form
 * shows read-only, with Edit to change it.
 */
function FormResponse({ block }: { block: FreeResponse }) {
  const t = useLessonText();
  const baseId = useId();
  const { prompt, guidance, entry_label: entryLabel, preview } = block.data;
  const fields = block.data.fields ?? [];
  const { total, min } = formEntryCounts(block);
  const [entries, setEntries] = useState<FormEntries>(() => decodeFormResponse(null, fields, total));
  const touched = useRef(false);
  const [editing, setEditing] = useState(true);

  // A saved submission fills the form and shows read-only, unless the learner has started typing.
  const restore = (value: string) => {
    // A choice saved in another lesson language isn't one of these options, and the server
    // would refuse it, so it's cleared for the learner to pick again.
    const restored = decodeFormResponse(value, fields, total).map((entry) =>
      Object.fromEntries(Object.entries(entry).map(([id, v]) => {
        const options = fields.find((f) => f.id === id)?.options;
        return [id, options && v && !options.includes(v) ? "" : v];
      })),
    );
    setEntries(restored);
    setEditing(false);
  };
  const { saved, state, setState, save, complete } = useSavedResponse(block, (value) => {
    if (!touched.current) restore(value);
  });

  const done = completeEntryCount(entries, fields);
  const ready = done >= min;
  const encoded = encodeFormResponse(entries);
  const submit = async (value: string) => {
    if (await save(value)) setEditing(false);
  };
  const label = entryLabel ?? t("freeResponseEntry");

  const setField = (i: number, fieldId: string, value: string) => {
    touched.current = true;
    setEntries((prev) => prev.map((e, ei) => (ei === i ? { ...e, [fieldId]: value } : e)));
    if (state !== "saving") setState("idle");
  };

  /** Several ratings with the same choices, as one table: each check and its question, then the choices. */
  const renderRatings = (i: number, rows: typeof fields, options: string[]) => (
    <div key={rows[0].id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map((f, r) => {
        const value = entries[i]?.[f.id] ?? "";
        return (
          <div
            key={f.id}
            role="group"
            aria-label={f.label}
            className={`flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${r ? "border-t border-slate-100" : ""}`}
          >
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-slate-800">
                {f.label}
                {f.optional ? <span className="font-normal text-slate-500"> ({t("formOptional")})</span> : null}
              </div>
              {f.hint ? <div className="text-[13px] text-slate-500">{f.hint}</div> : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={value === o}
                  onClick={() => setField(i, f.id, o)}
                  className={`rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    value === o
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderFields = (i: number) => (
    <div className="flex flex-col gap-3.5">
      {groupRatingFields(fields).map((g) => {
        if (g.kind === "ratings") return renderRatings(i, g.fields, g.options);
        const f = g.field;
        const id = `${baseId}-${i}-${f.id}`;
        const value = entries[i]?.[f.id] ?? "";
        return (
          <div key={f.id} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-[14px] font-semibold text-slate-800">
              {f.label}
              {f.optional ? <span className="font-normal text-slate-500"> ({t("formOptional")})</span> : null}
              {f.hint ? <span className="mt-0.5 block text-[13px] font-normal text-slate-500">{f.hint}</span> : null}
            </label>
            {f.options ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={f.label} id={id}>
                {f.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={value === o}
                    onClick={() => setField(i, f.id, o)}
                    className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      value === o
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : f.long ? (
              <textarea
                id={id}
                value={value}
                rows={2}
                placeholder={f.placeholder}
                maxLength={fieldMaxChars(f)}
                onChange={(e) => setField(i, f.id, e.target.value)}
                className={`${inputClass} resize-y`}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={value}
                placeholder={f.placeholder}
                maxLength={FREE_RESPONSE_FIELD_MAX_CHARS}
                onChange={(e) => setField(i, f.id, e.target.value)}
                className={inputClass}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <BlockCard
      kind="free_response"
      points={t("ptsTotal", { points: EXPLORE_POINTS })}
      hint={
        min < total
          ? t("freeResponseFormHint", { min, total })
          : fields.some((f) => f.optional)
            ? t("freeResponseFormHintRequired")
            : t("freeResponseFormHintAll")
      }
      complete={complete}
    >
      <Markdown content={prompt} variant="lesson" />
      <Guidance items={guidance} />
      {!editing && saved !== null ? (
        <>
          {preview ? (
            // A form with a card shows the finished card as its summary.
            <div className="mx-auto w-full max-w-md">
              <FormPreviewCard preview={preview} values={decodeFormResponse(saved, fields, total)[0]} canDownload />
            </div>
          ) : (
            <FormSummary fields={fields} entries={decodeFormResponse(saved, fields, total)} entryLabel={label} />
          )}
          <SubmittedActions
            complete={complete}
            saving={state === "saving"}
            onResubmit={() => void submit(saved)}
            onEdit={() => setEditing(true)}
          />
        </>
      ) : total === 1 ? (
        preview ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
            {renderFields(0)}
            <FormPreviewCard preview={preview} values={entries[0]} canDownload={isEntryComplete(entries[0], fields)} />
          </div>
        ) : (
          renderFields(0)
        )
      ) : (
        <div className="flex flex-col gap-2.5">
          {entries.map((entry, i) => {
            const isDone = isEntryComplete(entry, fields);
            const named = titleField(fields);
            const name = named ? (entry[named.id] ?? "").trim() : "";
            return (
              <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      isDone ? "bg-emerald-600 text-white" : "bg-indigo-50 text-indigo-700"
                    }`}
                    aria-hidden
                  >
                    {isDone ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">
                    {name || `${label} ${i + 1}`}
                  </span>
                  {isDone ? (
                    <span className="text-xs font-semibold text-emerald-700">{t("freeResponseEntryDone")}</span>
                  ) : null}
                </div>
                <div className="border-t border-slate-200 px-4 pb-4 pt-3.5">{renderFields(i)}</div>
              </div>
            );
          })}
        </div>
      )}
      {editing || saved === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-500" aria-live="polite">
            {total > 1 ? t("freeResponseEntriesDone", { n: done, total }) : null}
            {total > 1 && min < total ? ` · ${t("freeResponseEntriesNeeded", { min })}` : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {saved !== null ? (
              <button type="button" onClick={() => restore(saved)} className={secondaryButtonClass}>
                {t("freeResponseCancel")}
              </button>
            ) : null}
            <BlockButton onClick={() => ready && void submit(encoded)} disabled={!ready || state === "saving"}>
              {saved === null ? t("freeResponseSubmit") : t("freeResponseResubmit")}
            </BlockButton>
          </div>
        </div>
      ) : null}
      {state === "error" ? <BlockFeedback tone="warn">{t("freeResponseError")}</BlockFeedback> : null}
    </BlockCard>
  );
}
