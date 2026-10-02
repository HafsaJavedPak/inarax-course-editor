// Copied from inara-next lib/ile/strings.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
import { normalizeLessonLanguage, type LessonLanguage } from "@/vendor/inara-player/lib/lesson-language";

/**
 * Interface strings rendered INSIDE a lesson.
 *
 * The platform's chrome (navigation, admin, settings) stays English; this covers only the
 * labels the renderer prints between translated content, where English reads as a fault in
 * the translation rather than as part of the app. An Arabic learner seeing "Submit answer"
 * under an Arabic question assumes the translation broke.
 *
 * Kept here rather than sent through the translation pipeline because they are fixed,
 * shared by every lesson, and must be identical every time. Paying a model to translate
 * "Try again" once per lesson would also let two lessons word it differently.
 *
 * Adding a language means adding one column here; nothing else in the renderer changes.
 */
const STRINGS = {
  // Section navigation
  sectionFallback: { English: "Part {n}", Arabic: "الجزء {n}" },
  loadingProgress: { English: "Loading lesson progress…", Arabic: "جارٍ تحميل تقدّم الدرس…" },
  endOfPreview: { English: "End of preview", Arabic: "نهاية المعاينة" },
  reset: { English: "Reset", Arabic: "إعادة" },

  // Lesson intro (first part only)
  introObjectives: { English: "By the end, you'll be able to:", Arabic: "في نهاية هذا الدرس ستكون قادرًا على:" },
  introMinutes: { English: "{min}–{max} min", Arabic: "{min}–{max} دقيقة" },
  introParts: { English: "{n} parts", Arabic: "{n} أجزاء" },
  introPoints: { English: "Up to {points} points", Arabic: "حتى {points} نقطة" },

  // Interactive block card headers
  blockMcq: { English: "Multiple choice", Arabic: "اختيار من متعدد" },
  blockFillBlank: { English: "Fill in the blanks", Arabic: "أكمل الفراغات" },
  blockCategorization: { English: "Sort into groups", Arabic: "صنّف في مجموعات" },
  blockSequencing: { English: "Put in order", Arabic: "رتّب الخطوات" },
  blockFlipCards: { English: "Flip cards", Arabic: "بطاقات قلب" },
  blockExplore: { English: "Explore", Arabic: "استكشف" },
  blockTimeline: { English: "Step through", Arabic: "خطوة بخطوة" },
  blockHotspot: { English: "Explore the image", Arabic: "استكشف الصورة" },
  ptsTotal: { English: "{points} pts", Arabic: "{points} نقطة" },
  ptsEach: { English: "{points} pts each", Arabic: "{points} نقطة لكل فراغ" },
  ptsPerMatch: { English: "{points} pts per match", Arabic: "{points} نقطة لكل مطابقة" },

  // Footer navigation
  back: { English: "Back", Arabic: "رجوع" },
  previous: { English: "Previous", Arabic: "السابق" },
  continue: { English: "Continue", Arabic: "متابعة" },
  quizPassed: { English: "Quiz Passed", Arabic: "تم اجتياز الاختبار" },
  completeRequired: {
    English: "Complete required activities",
    Arabic: "أكمل الأنشطة المطلوبة",
  },

  // Shared block states
  completed: { English: "Completed", Arabic: "مكتمل" },
  tryAgain: { English: "Try again", Arabic: "حاول مرة أخرى" },
  notQuite: { English: "Not quite…", Arabic: "ليست الإجابة الصحيحة…" },
  points: { English: "+{earned} points", Arabic: "+{earned} نقطة" },
  pointsOf: { English: "+{earned} points of {max}", Arabic: "+{earned} نقطة من {max}" },

  // Multiple choice
  submitAnswer: { English: "Submit answer", Arabic: "إرسال الإجابة" },
  mcqWrong: { English: "Not quite. Pick another option and submit again.", Arabic: "إجابة غير صحيحة. اختر إجابة أخرى وأرسلها مرة أخرى." },
  mcqMultiWrong: {
    English: "Not quite. Adjust your choices and submit again.",
    Arabic: "ليست كل اختياراتك صحيحة. عدّلها وأرسلها مرة أخرى.",
  },
  mcqSelectAll: { English: "Select all that apply.", Arabic: "اختر كل ما ينطبق." },

  // Fill in the blanks
  selectPlaceholder: { English: "Select…", Arabic: "اختر…" },
  fillWrong: {
    English: "Not quite. Change the highlighted answers and check again.",
    Arabic: "ليست كل الإجابات صحيحة. غيّر الإجابات المميّزة وتحقق مرة أخرى.",
  },

  // Categorization
  categorizationHint: {
    English: "Drag each item into the right group, or tap an item and then a group.",
    Arabic: "اسحب كل عنصر إلى المجموعة الصحيحة، أو اضغط على العنصر ثم على المجموعة.",
  },
  checkAnswers: { English: "Check answers", Arabic: "تحقق من الإجابات" },
  /** On each bucket after a check: how many of the items placed in it belong there. */
  bucketCount: { English: "{correct} of {total} correct", Arabic: "{correct} من {total} صحيحة" },

  // Sequencing
  checkOrder: { English: "Check order", Arabic: "تحقق من الترتيب" },
  sequencingWrong: {
    English: "Not quite. None of the steps are in the right place yet.",
    Arabic: "لا توجد خطوة في مكانها الصحيح بعد.",
  },
  /** The rows in place are ticked above; this line gives the count. */
  sequencingPartial: {
    English: "{correct} of {total} steps are in the right place.",
    Arabic: "{correct} من {total} خطوات في مكانها الصحيح.",
  },

  // Flip cards
  flipReveal: { English: "Tap to reveal", Arabic: "اضغط للكشف" },

  // Accordion / tabs
  accordionHint: {
    English: "Expand every section to continue.",
    Arabic: "وسّع كل قسم للمتابعة.",
  },

  // Timeline
  timelineHint: {
    English: "Go through every step to continue.",
    Arabic: "مرّ على كل الخطوات للمتابعة.",
  },
  timelineStepOf: { English: "Step {n} of {total}", Arabic: "الخطوة {n} من {total}" },
  timelineNext: { English: "Next step", Arabic: "الخطوة التالية" },

  // Wheel diagram
  wheelHint: {
    English: "Open every slice of the wheel to continue.",
    Arabic: "افتح كل جزء من العجلة للمتابعة.",
  },

  // Nested layers
  layersHint: {
    English: "Open every layer to continue.",
    Arabic: "افتح كل طبقة للمتابعة.",
  },
  layerAria: {
    English: "Layer {n} of {total}: {label}",
    Arabic: "الطبقة {n} من {total}: {label}",
  },

  // Format switcher
  switcherHintAll: {
    English: "Open every option to continue.",
    Arabic: "افتح كل خيار للمتابعة.",
  },

  // Image switcher
  imageSwitcherHint: {
    English: "Use the buttons to view every image.",
    Arabic: "استخدم الأزرار لعرض كل صورة.",
  },

  // Vertical roadmap

  // Card headers for the newer explore blocks
  blockWheel: { English: "Explore the wheel", Arabic: "استكشف العجلة" },
  blockLayers: { English: "Explore the layers", Arabic: "استكشف الطبقات" },
  blockFormats: { English: "Compare formats", Arabic: "قارن الصيغ" },
  blockImages: { English: "Step through the images", Arabic: "تنقّل بين الصور" },
  blockRoadmap: { English: "Roadmap", Arabic: "المسار الزمني" },
  imageUnavailable: { English: "Image unavailable: {alt}", Arabic: "الصورة غير متاحة: {alt}" },

  // Add the next layer
  blockBuildUp: { English: "Build it up", Arabic: "ابنِها طبقة طبقة" },
  addNextLayer: { English: "Add the next layer", Arabic: "أضف الطبقة التالية" },
  layerOf: { English: "Layer {n} of {total}", Arabic: "الطبقة {n} من {total}" },

  // Lesson page chrome: header, sidebar and footer around the lesson body.
  next: { English: "Next", Arabic: "التالي" },
  takeModuleQuiz: { English: "Take Module Quiz", Arabic: "ابدأ اختبار الوحدة" },
  finishCourse: { English: "Finish Course", Arabic: "إنهاء الدورة" },
  moduleQuizPassed: { English: "Module Quiz Passed", Arabic: "تم اجتياز اختبار الوحدة" },
  backToCourse: { English: "Back to course overview", Arabic: "العودة إلى نظرة عامة على الدورة" },
  courseProgress: { English: "Course progress", Arabic: "تقدّم الدورة" },

  // Module quiz. The mandatory gated exit from every module, so its chrome has to follow
  // the learner's language the way a lesson's does.
  moduleQuizLabel: { English: "Module Quiz", Arabic: "اختبار الوحدة" },
  moduleQuizProgress: {
    English: "Question {current} of {total} · {percent}% required to pass",
    Arabic: "السؤال {current} من {total} · {percent}% للنجاح",
  },
  moduleQuizNotYet: { English: "Not quite yet", Arabic: "ليس بعد" },
  moduleQuizAlreadyPassed: {
    English: "You've already passed this quiz — your result is saved, so there's nothing to retake.",
    Arabic: "لقد اجتزت هذا الاختبار بالفعل — نتيجتك محفوظة ولا حاجة لإعادته.",
  },
  moduleQuizScore: { English: "Your score: {percent}%", Arabic: "نتيجتك: {percent}%" },
  moduleQuizReviewHeading: { English: "Review your answers", Arabic: "مراجعة إجاباتك" },
  moduleQuizYourAnswer: { English: "Your answer: {answer}", Arabic: "إجابتك: {answer}" },
  moduleQuizCorrectAnswer: {
    English: "Correct answer: {answer}",
    Arabic: "الإجابة الصحيحة: {answer}",
  },
  submitQuiz: { English: "Submit Quiz", Arabic: "إرسال الاختبار" },
  viewCertificate: { English: "View Certificate", Arabic: "عرض الشهادة" },
  loadingQuiz: { English: "Loading quiz…", Arabic: "جارٍ تحميل الاختبار…" },
  lessonResources: { English: "Lesson resources", Arabic: "مصادر الدرس" },
  closeOutline: { English: "Close course outline", Arabic: "إغلاق محتويات الدورة" },
  openOutline: { English: "Course outline", Arabic: "محتويات الدورة" },
  sectionSummary: { English: "Part {current} of {total}", Arabic: "الجزء {current} من {total}" },
  enterFocusMode: { English: "Hide side panels", Arabic: "إخفاء اللوحات الجانبية" },
  exitFocusMode: { English: "Show side panels", Arabic: "إظهار اللوحات الجانبية" },
  toggleNavigation: { English: "Toggle navigation", Arabic: "إظهار أو إخفاء القائمة" },
  activitiesRemaining: {
    English: "{n} more activities in this part",
    Arabic: "بقي {n} من الأنشطة في هذا الجزء",
  },
  activityRemaining: {
    English: "1 more activity in this part",
    Arabic: "بقي نشاط واحد في هذا الجزء",
  },
  completeToContinue: {
    English: "Complete all required activities in this part to continue",
    Arabic: "أكمل جميع الأنشطة المطلوبة في هذا الجزء للمتابعة",
  },

  // Callout labels. These are the DEFAULT shown when a ::: directive carries no explicit
  // title; an author-provided title is content and is translated with the lesson.
  calloutClarification: { English: "Clarification", Arabic: "توضيح" },
  calloutInformation: { English: "Information", Arabic: "معلومة" },
  calloutWarning: { English: "Warning", Arabic: "تنبيه" },
  calloutNote: { English: "Note", Arabic: "ملاحظة" },
  calloutTip: { English: "Tip", Arabic: "نصيحة" },
  calloutGood: { English: "Good for", Arabic: "مفيد في" },
  calloutSteps: { English: "Steps", Arabic: "خطوات" },
  calloutTerminal: { English: "Terminal", Arabic: "الطرفية" },
  calloutCode: { English: "Code", Arabic: "الشيفرة" },
  calloutOutput: { English: "Expected Output", Arabic: "المخرجات المتوقعة" },
  calloutPlatform: { English: "Platform", Arabic: "المنصة" },
  calloutChecklist: { English: "Checklist", Arabic: "قائمة تحقّق" },

  // Image hotspots
  hotspotHint: {
    English: "Click each numbered point on the image to learn more.",
    Arabic: "اضغط على كل نقطة مرقّمة في الصورة لمعرفة المزيد.",
  },
  hotspotFindHint: {
    English: "Click the image wherever you spot something. Find them all to continue.",
    Arabic: "اضغط على الصورة حيث تلاحظ شيئًا. اعثر عليها كلها للمتابعة.",
  },
  hotspotFound: { English: "{found} of {total} found", Arabic: "تم العثور على {found} من {total}" },
  hotspotShowRest: { English: "Show the rest", Arabic: "أظهر الباقي" },
  hotspotHidden: { English: "Hidden spot {n}", Arabic: "نقطة مخفية {n}" },
  hotspotNext: { English: "Next point", Arabic: "النقطة التالية" },
  interactiveDiagram: { English: "Interactive diagram", Arabic: "رسم تفاعلي" },
  close: { English: "Close", Arabic: "إغلاق" },
} as const satisfies Record<string, Record<LessonLanguage, string>>;

export type IleStringKey = keyof typeof STRINGS;

/**
 * Every key, for tests that must not be able to miss one.
 *
 * The Arabic-coverage test used to enumerate keys by hand, so a key added without a test
 * entry was simply never checked — which is how three keys reached main unused and four
 * blocks kept hardcoding English beside them. A list derived from the source cannot go
 * stale.
 */
export const ILE_STRING_KEYS = Object.keys(STRINGS) as IleStringKey[];

/**
 * A lesson-body string in the learner's language.
 *
 * `{name}` placeholders are filled from `params`. Numbers stay Western digits, matching
 * the numerals used in the translated content itself and in the stepper's own badges.
 */
export function ileText(
  key: IleStringKey,
  language: string | null | undefined,
  params?: Record<string, string | number>,
): string {
  const lang = normalizeLessonLanguage(language);
  let out: string = STRINGS[key][lang];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.replace(`{${name}}`, String(value));
    }
  }
  return out;
}
