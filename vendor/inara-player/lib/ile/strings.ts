// Copied from inara-next lib/ile/strings.ts @ 767dad963cb6 by scripts/sync-inara-player.mjs.
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
  resetHint: {
    English: "Reset this lesson and attempt the activities again. Your score is already saved and won't change.",
    Arabic: "أعد ضبط هذا الدرس وجرّب الأنشطة مرة أخرى. درجتك محفوظة بالفعل ولن تتغير.",
  },
  blockLoading: { English: "Loading lesson block", Arabic: "جارٍ تحميل جزء من الدرس" },

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

  // Back-to-back multiple choice, shown one question at a time
  quizQuestionOf: { English: "Question {n} of {total}", Arabic: "السؤال {n} من {total}" },
  quizGoTo: { English: "Go to question {n}", Arabic: "انتقل إلى السؤال {n}" },
  quizNext: { English: "Next question", Arabic: "السؤال التالي" },
  quizPrevious: { English: "Previous", Arabic: "السابق" },
  quizSeeResult: { English: "See your result", Arabic: "اعرض نتيجتك" },
  quizDone: { English: "All questions answered", Arabic: "تمت الإجابة عن جميع الأسئلة" },
  quizFirstTry: {
    English: "{correct} of {total} right on the first try",
    Arabic: "{correct} من {total} صحيحة من المحاولة الأولى",
  },
  quizReview: { English: "Review the questions", Arabic: "راجع الأسئلة" },

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

  // Prompt box (```text blocks)
  promptCopy: { English: "Copy", Arabic: "نسخ" },
  promptCopied: { English: "Copied", Arabic: "تم النسخ" },

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
  blockQuickQuestion: { English: "Quick question", Arabic: "سؤال سريع" },
  blockTiles: { English: "Explore", Arabic: "استكشف" },
  blockColorSort: { English: "Sort by colour", Arabic: "صنّف بالألوان" },
  blockFilterCompare: { English: "Try the simulator", Arabic: "جرّب المحاكي" },

  // Read-aloud box (:::listen).
  listenTitle: { English: "Listen", Arabic: "استمع" },
  listenPlay: { English: "Play", Arabic: "تشغيل" },
  listenStop: { English: "Stop", Arabic: "إيقاف" },

  // Form preview card and project download.
  formOptional: { English: "optional", Arabic: "اختياري" },
  cardDownload: { English: "Download my card", Arabic: "حمّل بطاقتي" },
  cardCopy: { English: "Copy", Arabic: "انسخ" },
  cardCopied: { English: "Copied", Arabic: "تم النسخ" },
  exportDownload: { English: "Download my work", Arabic: "حمّل عملي" },
  exportPreparing: { English: "Preparing your file…", Arabic: "جارٍ تجهيز ملفك…" },
  exportEmpty: { English: "Nothing saved yet. Your answers will appear here once you submit them in the lessons.", Arabic: "لا شيء محفوظ بعد. ستظهر إجاباتك هنا بعد إرسالها في الدروس." },
  exportError: { English: "Couldn't fetch your answers. Check your connection and try again.", Arabic: "تعذّر جلب إجاباتك. تحقّق من اتصالك وحاول مرة أخرى." },

  // Quick question (quick_question).
  quickHint: { English: "Pick an answer.", Arabic: "اختر إجابة." },
  quickRightAnswer: { English: "Right answer", Arabic: "الإجابة الصحيحة" },
  quickYourPick: { English: "Your pick", Arabic: "اختيارك" },

  // Tile reveal (tile_reveal).
  tilesHint: { English: "Tap each tile to see more.", Arabic: "اضغط على كل بطاقة لترى المزيد." },

  // Slider set (slider_set).
  blockSliderJudge: { English: "Slide and decide", Arabic: "حرّك وقرّر" },
  blockSliderRate: { English: "Rate yourself", Arabic: "قيّم نفسك" },
  sliderHintJudge: { English: "Set each one, then lock it in.", Arabic: "اضبط كل واحد، ثم ثبّته." },
  sliderHintRate: { English: "Move every slider.", Arabic: "حرّك كل مؤشر." },
  sliderLock: { English: "Lock it in", Arabic: "ثبّت" },
  sliderGood: { English: "Good call.", Arabic: "اختيار موفق." },
  sliderBest: { English: "Hmm. Best: {levels}.", Arabic: "همم. الأنسب: {levels}." },
  sliderOr: { English: " or ", Arabic: " أو " },
  sliderJudgeScore: { English: "{n} of {total} set at a responsible level.", Arabic: "{n} من {total} في مستوى مسؤول." },
  sliderTryAgain: { English: "Try again", Arabic: "حاول مجددًا" },
  sliderMoveAll: { English: "Move every slider to see your summary.", Arabic: "حرّك كل المؤشرات لترى الملخص." },
  sliderEven: { English: "You rated yourself evenly across all {total} at {n}/{max}.", Arabic: "قيّمت نفسك بالتساوي في الـ{total} كلها بـ{n}/{max}." },
  sliderSummary: {
    English: "Your strongest area: {high} ({hn}/{max}). Your area to grow next: {low} ({ln}/{max}).",
    Arabic: "أقوى مجال لديك: {high} ({hn}/{max}). المجال الذي تنمّيه بعد ذلك: {low} ({ln}/{max}).",
  },

  // Colour sort (color_sort).
  sortHint: { English: "Pick a colour for each item.", Arabic: "اختر لونًا لكل عنصر." },
  sortRight: { English: "Correct.", Arabic: "صحيح." },
  sortWrong: { English: "Not quite. It's {label}.", Arabic: "ليس تمامًا. الصحيح: {label}." },
  sortScore: { English: "{n} of {total} correct.", Arabic: "{n} من {total} صحيحة." },
  sortTryAgain: { English: "Try the wrong ones again", Arabic: "أعد المحاولة في الخاطئة" },
  sortCount: { English: "{n} of {total}", Arabic: "{n} من {total}" },

  // Scenario sort (scenario_sort).
  blockScenarioSort: { English: "Sort the tasks", Arabic: "صنّف المهام" },
  scenarioHint: { English: "Pick one, sort every item, then compare.", Arabic: "اختر واحدًا، وصنّف كل عنصر، ثم قارن." },
  scenarioChoose: { English: "Choose one", Arabic: "اختر واحدًا" },
  scenarioCompare: { English: "Compare with the expert", Arabic: "قارن برأي الخبير" },
  scenarioExpert: { English: "Expert view: {label}.", Arabic: "رأي الخبير: {label}." },
  scenarioReset: { English: "Start again", Arabic: "ابدأ من جديد" },

  // Spot the errors (spot_the_errors).
  blockSpotErrors: { English: "Spot the errors", Arabic: "اكتشف الأخطاء" },
  spotHint: { English: "Tap every sentence you think is wrong, then check your review.", Arabic: "اضغط على كل جملة تظن أنها خاطئة، ثم راجع إجاباتك." },
  spotFlags: { English: "Your flags ({n})", Arabic: "علاماتك ({n})" },
  spotEmpty: { English: "Tap a sentence in the text to flag it.", Arabic: "اضغط على جملة في النص لتضع عليها علامة." },
  spotUnflag: { English: "Remove flag", Arabic: "أزل العلامة" },
  spotNote: { English: "Your correction (optional)", Arabic: "تصحيحك (اختياري)" },
  spotCheck: { English: "Check my review", Arabic: "راجع إجاباتي" },
  spotReset: { English: "Start again", Arabic: "ابدأ من جديد" },
  spotScore: { English: "{found}/{total} problems found", Arabic: "عثرت على {found} من {total} مشكلات" },
  spotFalseAlarms: { English: ", {n} false alarm(s)", Arabic: "، و{n} إنذار خاطئ" },
  spotLegend: { English: "In the text: green = caught, red dashed = missed, amber = flagged but fine.", Arabic: "في النص: الأخضر = اكتشفته، والأحمر المتقطع = فاتك، والكهرماني = وضعت عليه علامة لكنه سليم." },
  spotFine: { English: "This sentence was fine. Nothing wrong here.", Arabic: "هذه الجملة سليمة. لا خطأ هنا." },
  spotRight: { English: "Right problem, right label:", Arabic: "المشكلة صحيحة والتصنيف صحيح:" },
  spotMainly: { English: "Good catch. It's mainly {label}:", Arabic: "التقاط جيد. المشكلة أساسًا في {label}:" },
  spotAnswerKey: { English: "Answer key", Arabic: "مفتاح الإجابات" },
  spotMissed: { English: "Missed:", Arabic: "فاتك:" },
  spotFixLabel: { English: "Fix:", Arabic: "التصحيح:" },
  spotCorrected: { English: "The corrected version", Arabic: "النسخة المصحّحة" },

  // Decision tree (decision_tree).
  blockDecisionTree: { English: "Decision tree", Arabic: "شجرة القرار" },
  treeHint: { English: "Answer each question honestly.", Arabic: "أجب عن كل سؤال بصدق." },
  treeQuestion: { English: "Question {n} of {total}", Arabic: "السؤال {n} من {total}" },
  treeYes: { English: "Yes", Arabic: "نعم" },
  treeNo: { English: "No", Arabic: "لا" },
  treeStep: { English: "Q{n}: {answer}", Arabic: "س{n}: {answer}" },
  treeRestart: { English: "Try another one", Arabic: "جرّب حالة أخرى" },

  // Prompt builder (prompt_builder).
  blockPromptBuilder: { English: "Build a prompt", Arabic: "ابنِ موجّهًا" },
  builderHint: { English: "Fill in the blocks to build your prompt.", Arabic: "املأ الأجزاء لتبني موجّهك." },
  builderBrief: { English: "Pick a brief", Arabic: "اختر مهمة" },
  builderAssembled: { English: "Your assembled prompt", Arabic: "موجّهك المجمّع" },
  builderEmpty: { English: "Pick a brief, then fill in the blocks.", Arabic: "اختر مهمة، ثم املأ الأجزاء." },
  builderEmptyNoBrief: { English: "Fill in the blocks to build your prompt.", Arabic: "املأ الأجزاء لتبني موجّهك." },
  builderNeed: { English: "Fill in at least {n} blocks to finish.", Arabic: "املأ {n} أجزاء على الأقل للإنهاء." },
  builderCopy: { English: "Copy prompt", Arabic: "انسخ الموجّه" },
  builderCopied: { English: "Copied", Arabic: "تم النسخ" },
  builderFrame: { English: "Frame preview: the shape and ingredients of your image", Arabic: "معاينة الإطار: شكل صورتك ومكوّناتها" },
  builderNoShape: { English: "Shape not set", Arabic: "الشكل غير محدد" },
  blockTrainModel: { English: "Train a model", Arabic: "درّب نموذجًا" },
  blockMeaningMap: { English: "Explore the map", Arabic: "استكشف الخريطة" },

  // Rule vs learned filter (filter_compare).
  filterHint: { English: "Type a message or pick one below.", Arabic: "اكتب رسالة أو اختر واحدة من الأسفل." },
  filterHintPick: { English: "Pick a message to test.", Arabic: "اختر رسالة للتجربة." },
  filterInputLabel: { English: "Message to test", Arabic: "رسالة للتجربة" },
  filterWaiting: { English: "Waiting…", Arabic: "بانتظار رسالة…" },
  filterRuleHit: { English: "Matched its rule: \"{phrase}\".", Arabic: "طابقت قاعدته: \"{phrase}\"." },
  filterRuleFooled: {
    English: "No exact match for \"{phrase}\", so it let this through. Fooled.",
    Arabic: "لا تطابق تامًا مع \"{phrase}\"، فسمح بمرورها. تم خداعه.",
  },
  filterRuleMiss: { English: "No match for its one rule, so it lets this through.", Arabic: "لا تطابق مع قاعدته الوحيدة، فسمح بمرورها." },
  filterLearnedSignals: { English: "Patterns it noticed: {signals}.", Arabic: "أنماط لاحظها: {signals}." },
  filterLearnedClean: { English: "No patterns it recognises.", Arabic: "لا أنماط يعرفها." },
  filterPercent: { English: "{percent}% likely {label}", Arabic: "احتمال {label}: {percent}٪" },

  // Train your own model (train_model).
  trainStep1: { English: "Label the training data", Arabic: "صنّف بيانات التدريب" },
  trainStep1Sub: {
    English: "Read each message and pick a label. Your labels are what the model will learn from.",
    Arabic: "اقرأ كل رسالة واختر تصنيفًا. سيتعلّم النموذج من تصنيفاتك.",
  },
  trainLabelled: { English: "{n} of {total} labelled", Arabic: "{n} من {total} مصنّفة" },
  trainButton: { English: "Train my model", Arabic: "درّب نموذجي" },
  trainRetrain: { English: "Retrain with my labels", Arabic: "أعد التدريب بتصنيفاتي" },
  trainTraining: { English: "Training… learning patterns from your {n} examples", Arabic: "جارٍ التدريب… يتعلّم الأنماط من أمثلتك الـ{n}" },
  trainStep2: { English: "What your model learned", Arabic: "ما تعلّمه نموذجك" },
  trainStep2Sub: {
    English: "Trained on {desc}. These are the words it found most tied to each label. Nobody told it these words. It found them in the data.",
    Arabic: "تدرّب على {desc}. هذه الكلمات الأكثر ارتباطًا بكل تصنيف. لم يخبره أحد بها، بل وجدها في البيانات.",
  },
  trainSignals: { English: "Signals for \"{label}\"", Arabic: "مؤشرات \"{label}\"" },
  trainNoSignals: { English: "No clear signals. Not enough data.", Arabic: "لا مؤشرات واضحة. البيانات غير كافية." },
  trainStep3: { English: "Test it on messages it has never seen", Arabic: "اختبره على رسائل لم يرها من قبل" },
  trainAccuracy: { English: "accuracy: {ok} of {total} new messages sorted correctly", Arabic: "الدقة: {ok} من {total} رسائل جديدة صُنّفت بشكل صحيح" },
  trainSure: { English: "{label} ({percent}% sure)", Arabic: "{label} (متأكد بنسبة {percent}٪)" },
  trainCorrect: { English: "Correct", Arabic: "صحيح" },
  trainWrong: { English: "Wrong. It should be \"{label}\".", Arabic: "خطأ. الصحيح \"{label}\"." },
  trainStep4: { English: "Experiment with the data", Arabic: "جرّب تغيير البيانات" },
  trainStep4Sub: {
    English: "What happens to your model if the training data changes? Try each experiment and watch the accuracy.",
    Arabic: "ماذا يحدث لنموذجك إذا تغيّرت بيانات التدريب؟ جرّب كل تجربة وراقب الدقة.",
  },
  trainFew: { English: "Train on only 3 examples", Arabic: "درّب على 3 أمثلة فقط" },
  trainSwap: { English: "Swap {n} labels (messy data)", Arabic: "بدّل {n} تصنيفات (بيانات فوضوية)" },
  trainFull: { English: "Back to my full data", Arabic: "عُد إلى بياناتي الكاملة" },
  trainDescYours: { English: "your {n} labelled examples", Arabic: "أمثلتك الـ{n} المصنّفة" },
  trainDescFew: { English: "only your first 3 examples", Arabic: "أول 3 أمثلة فقط" },
  trainDescSwap: { English: "your {n} examples with {k} labels swapped", Arabic: "أمثلتك الـ{n} مع تبديل {k} تصنيفات" },
  trainRunsRun: { English: "Run", Arabic: "التجربة" },
  trainRunsData: { English: "Training data", Arabic: "بيانات التدريب" },
  trainRunsAccuracy: { English: "Accuracy", Arabic: "الدقة" },
  trainPattern: {
    English: "Notice the pattern: less data or wrong labels means a worse model. The model didn't make a mistake. It learned exactly what the data taught it. That's why data quality matters so much in real AI.",
    Arabic: "لاحظ النمط: بيانات أقل أو تصنيفات خاطئة تعني نموذجًا أسوأ. النموذج لم يخطئ، بل تعلّم بالضبط ما علّمته البيانات. لهذا تهمّ جودة البيانات كثيرًا في الذكاء الاصطناعي الحقيقي.",
  },
  trainHint: { English: "Label every message, then train your model.", Arabic: "صنّف كل الرسائل، ثم درّب نموذجك." },
  trainHintExperiments: {
    English: "Label every message, train your model, then try an experiment.",
    Arabic: "صنّف كل الرسائل، ودرّب نموذجك، ثم جرّب تجربة.",
  },

  // Meaning map (meaning_map).
  mapHint: { English: "Tap a word to see its nearest neighbours.", Arabic: "اضغط على كلمة لترى أقرب الكلمات إليها." },
  mapIdle: { English: "Tap a word on the map.", Arabic: "اضغط على كلمة في الخريطة." },
  mapNear: {
    English: "\"{word}\" sits closest to {near}. The AI learned these appear in similar contexts. It's furthest from \"{far}\".",
    Arabic: "\"{word}\" أقرب إلى {near}. تعلّم الذكاء الاصطناعي أنها تظهر في سياقات متشابهة. وأبعد كلمة عنها \"{far}\".",
  },
  imageUnavailable: { English: "Image unavailable: {alt}", Arabic: "الصورة غير متاحة: {alt}" },

  // Add the next layer
  blockBuildUp: { English: "Build it up", Arabic: "ابنِها طبقة طبقة" },
  addNextLayer: { English: "Add the next layer", Arabic: "أضف الطبقة التالية" },
  layerOf: { English: "Layer {n} of {total}", Arabic: "الطبقة {n} من {total}" },

  // Context window slider
  blockContextWindow: { English: "The context window", Arabic: "نافذة السياق" },
  contextWindowHint: {
    English: "Shrink the window until an early detail falls out of view.",
    Arabic: "صغّر النافذة حتى يخرج تفصيل مبكر عن مجال الرؤية.",
  },
  contextWindowLabel: {
    English: "Context window: {n} most recent messages",
    Arabic: "نافذة السياق: أحدث {n} رسائل",
  },
  contextWindowYou: { English: "You", Arabic: "أنت" },
  contextWindowAi: { English: "AI", Arabic: "الذكاء الاصطناعي" },

  // Cliché highlighter
  blockCliche: { English: "Keep your voice", Arabic: "حافظ على صوتك" },
  clicheHint: {
    English: "Spot the common AI phrases in this passage, then reveal them.",
    Arabic: "ابحث عن العبارات الشائعة في كتابة الذكاء الاصطناعي في هذه الفقرة، ثم اكشفها.",
  },
  clicheCheck: { English: "Highlight the AI phrases", Arabic: "ظلّل عبارات الذكاء الاصطناعي" },
  clicheClean: {
    English: "No common AI phrases found.",
    Arabic: "لم يُعثر على عبارات شائعة في كتابة الذكاء الاصطناعي.",
  },
  clicheFew: {
    English: "{count} common AI phrase(s) in {words} words. A few to trim.",
    Arabic: "{count} من العبارات الشائعة في كتابة الذكاء الاصطناعي في {words} كلمة. بعضها يستحق التشذيب.",
  },
  clicheDense: {
    English: "{count} common AI phrase(s) in {words} words. Rewrite the highlighted parts in plain words.",
    Arabic: "{count} من العبارات الشائعة في كتابة الذكاء الاصطناعي في {words} كلمة. أعد صياغة الأجزاء المميّزة بكلمات بسيطة.",
  },

  // Tokenizer playground
  blockTokenizer: { English: "Tokenizer playground", Arabic: "ساحة الرموز" },
  tokenizerHint: {
    English: "Tap at least {n} more examples to compare their tokens.",
    Arabic: "اضغط على {n} أمثلة أخرى على الأقل لتقارن رموزها.",
  },
  tokenizerExamples: { English: "Example texts", Arabic: "نصوص مثال" },
  tokenizerChars: { English: "Characters", Arabic: "أحرف" },
  tokenizerWords: { English: "Words", Arabic: "كلمات" },
  tokenizerTokens: { English: "Tokens", Arabic: "رموز" },

  // Be the model
  blockBeTheModel: { English: "Be the model", Arabic: "كُن النموذج" },
  beTheModelHint: {
    English: "Generate {n} finished sentences to continue.",
    Arabic: "أنشئ {n} جمل مكتملة للمتابعة.",
  },
  beTheModelTemp: { English: "Temperature: {v}", Arabic: "درجة الحرارة: {v}" },
  beTheModelFocused: { English: "Focused and predictable", Arabic: "مركّز ومتوقّع" },
  beTheModelUnusual: { English: "Creative and random", Arabic: "إبداعي وعشوائي" },
  beTheModelOptions: {
    English: "The model's options for the next word:",
    Arabic: "خيارات النموذج للكلمة التالية:",
  },
  beTheModelEnd: { English: ". (end)", Arabic: ". (نهاية)" },
  beTheModelFinished: {
    English: "Sentence finished. Start over, or change the temperature and try again.",
    Arabic: "انتهت الجملة. ابدأ من جديد، أو غيّر درجة الحرارة وجرّب مرة أخرى.",
  },
  beTheModelPick: {
    English: "Let the model pick the next word",
    Arabic: "دع النموذج يختار الكلمة التالية",
  },
  beTheModelFinish: { English: "Finish the sentence", Arabic: "أكمل الجملة" },
  beTheModelRestart: { English: "Start over", Arabic: "ابدأ من جديد" },
  beTheModelHistory: { English: "Generated sentences", Arabic: "الجمل المُنشأة" },
  beTheModelTempTag: { English: "temp {v}", Arabic: "حرارة {v}" },

  // Workflow simulator
  blockWorkflow: { English: "Workflow simulator", Arabic: "محاكي سير العمل" },
  workflowHint: {
    English: "Choose an option for each step, then run it with the test data.",
    Arabic: "اختر خيارًا لكل خطوة، ثم شغّله على بيانات الاختبار.",
  },
  workflowFlow: { English: "Chosen workflow", Arabic: "سير العمل المختار" },
  workflowRun: { English: "▶ Run with test data", Arabic: "▶ تشغيل على بيانات الاختبار" },
  workflowPerfect: {
    English: "A well-designed automation. Every step is the best choice.",
    Arabic: "أتمتة مصممة جيدًا. كل خطوة هي الخيار الأفضل.",
  },
  workflowImperfect: {
    English: "Almost. Fix these, then run it again:",
    Arabic: "قاربَتْ. أصلح هذه، ثم شغّلها مرة أخرى:",
  },

  // Agent simulator
  blockAgent: { English: "Agent simulator", Arabic: "محاكي الوكيل" },
  agentHint: {
    English: "At each step, choose the next action. Finish every step to continue.",
    Arabic: "في كل خطوة، اختر الإجراء التالي. أكمل كل الخطوات للمتابعة.",
  },
  agentInbox: { English: "Inbox", Arabic: "البريد الوارد" },
  agentLog: { English: "Agent log", Arabic: "سجل الوكيل" },
  agentGoal: { English: "Goal: {text}", Arabic: "الهدف: {text}" },
  agentThink: { English: "Think: {text}", Arabic: "تفكير: {text}" },
  agentAct: { English: "Act: {text}", Arabic: "تنفيذ: {text}" },
  agentObserved: { English: "Observed: {text}", Arabic: "ملاحظة: {text}" },
  chatAskBoth: { English: "Pick a question above to ask both bots.", Arabic: "اختر سؤالًا أعلاه لتطرحه على الروبوتين." },
  chatRulePanel: { English: "Rule-based chatbot", Arabic: "روبوت محادثة قائم على القواعد" },
  chatLlmPanel: { English: "LLM-powered chatbot", Arabic: "روبوت محادثة مدعوم بنموذج لغوي" },
  chatPrewritten: {
    English: "The LLM chatbot's replies here were written in advance for these questions.",
    Arabic: "ردود روبوت المحادثة بالنموذج اللغوي هنا كُتبت مسبقًا لهذه الأسئلة.",
  },
  sandboxBarChart: { English: "Bar chart", Arabic: "مخطط أعمدة" },
  sandboxAiSays: { English: "AI:", Arabic: "الذكاء الاصطناعي:" },
  workflowAction: { English: "✅ Final action", Arabic: "✅ الإجراء الأخير" },
  agentStepOf: { English: "Step {n} of {total}", Arabic: "الخطوة {n} من {total}" },
  agentTryAnother: { English: "Try another action.", Arabic: "جرّب إجراءً آخر." },
  agentNext: { English: "Next step →", Arabic: "الخطوة التالية →" },
  agentFinish: { English: "Finish", Arabic: "إنهاء" },
  agentRunAgain: { English: "Run it again", Arabic: "شغّله مرة أخرى" },

  // Dual chatbot
  blockDualChat: { English: "Try two chatbots", Arabic: "جرّب روبوتي محادثة" },
  dualChatHint: {
    English: "Ask at least {n} questions to continue.",
    Arabic: "اطرح على الأقل {n} أسئلة للمتابعة.",
  },
  dualChatPresets: { English: "Example questions", Arabic: "أسئلة مثال" },

  // Data sandbox
  blockDataSandbox: { English: "Check AI answers against data", Arabic: "تحقّق من إجابات الذكاء الاصطناعي مقابل البيانات" },
  sandboxHint: {
    English: "Judge at least {n} AI answers against the data to continue.",
    Arabic: "احكم على الأقل على {n} إجابات للذكاء الاصطناعي مقابل البيانات للمتابعة.",
  },
  sandboxDatasets: { English: "Datasets", Arabic: "مجموعات البيانات" },
  sandboxChart: { English: "Chart", Arabic: "رسم بياني" },
  sandboxTable: { English: "Table", Arabic: "جدول" },
  sandboxCopyCsv: { English: "Copy as CSV", Arabic: "نسخ كـ CSV" },
  sandboxDownloadCsv: { English: "Download CSV", Arabic: "تنزيل CSV" },
  sandboxCopied: { English: "Copied.", Arabic: "تم النسخ." },
  sandboxCopyFail: {
    English: "Copying isn't available here. Switch to the Table view and copy the rows.",
    Arabic: "النسخ غير متاح هنا. انتقل إلى عرض الجدول وانسخ الصفوف.",
  },
  sandboxJudged: {
    English: "Judged {n} of {total}",
    Arabic: "حُكِم على {n} من {total}",
  },
  sandboxAiRight: { English: "AI is right", Arabic: "الذكاء الاصطناعي محق" },
  sandboxAiWrong: { English: "AI is wrong", Arabic: "الذكاء الاصطناعي مخطئ" },
  sandboxGoodJudgement: { English: "✓ Good judgement.", Arabic: "✓ حكم جيد." },
  sandboxBadJudgement: { English: "✗ Not quite.", Arabic: "✗ ليس تمامًا." },
  sandboxTrueAnswer: { English: "True answer:", Arabic: "الإجابة الصحيحة:" },

  // Checklist
  blockChecklist: { English: "Checklist", Arabic: "قائمة تحقق" },
  checklistHint: { English: "Tick every item to continue.", Arabic: "ضع علامة على كل بند للمتابعة." },
  checklistProgress: { English: "{done} of {total} ticked", Arabic: "{done} من {total} مُنجز" },

  // Free response
  blockFreeResponse: { English: "Your answer", Arabic: "إجابتك" },
  freeResponseHint: { English: "Write at least {min} words, then save.", Arabic: "اكتب {min} كلمة على الأقل، ثم احفظ." },
  freeResponseWords: { English: "{n} of {min} words", Arabic: "{n} من {min} كلمة" },
  freeResponseGuidance: { English: "A strong answer", Arabic: "الإجابة القوية" },
  freeResponseSave: { English: "Save answer", Arabic: "احفظ الإجابة" },
  freeResponseUpdate: { English: "Update answer", Arabic: "حدّث الإجابة" },
  freeResponseFormHint: { English: "Fill in at least {min} of {total}, then submit.", Arabic: "أكمل {min} على الأقل من {total}، ثم أرسل." },
  freeResponseFormHintAll: { English: "Fill in every field, then submit.", Arabic: "املأ كل الحقول، ثم أرسل." },
  freeResponseFormHintRequired: { English: "Fill the required fields.", Arabic: "املأ الحقول المطلوبة." },
  freeResponseEntriesDone: { English: "{n} of {total} complete", Arabic: "{n} من {total} مكتمل" },
  freeResponseEntriesNeeded: { English: "at least {min} needed", Arabic: "المطلوب {min} على الأقل" },
  freeResponseEntry: { English: "Entry", Arabic: "إدخال" },
  freeResponseEntryDone: { English: "Complete", Arabic: "مكتمل" },
  freeResponseSubmit: { English: "Submit", Arabic: "أرسل" },
  freeResponseResubmit: { English: "Update submission", Arabic: "حدّث الإرسال" },
  freeResponseSubmitted: { English: "Submitted", Arabic: "تم الإرسال" },
  freeResponseYourAnswer: { English: "What you submitted", Arabic: "ما أرسلته" },
  freeResponseEdit: { English: "Edit", Arabic: "تعديل" },
  freeResponseCancel: { English: "Cancel", Arabic: "إلغاء" },
  freeResponseError: {
    English: "Couldn't save your answer. Check your connection and try again.",
    Arabic: "تعذّر حفظ إجابتك. تحقّق من اتصالك وحاول مرة أخرى.",
  },

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
  lessonPosition: { English: "Module {module} · Lesson {lesson}", Arabic: "الوحدة {module} · الدرس {lesson}" },
  sectionMinutes: { English: "about {n} min", Arabic: "حوالي {n} د" },
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
  calloutReflect: { English: "Reflect", Arabic: "تأمّل" },
  calloutProject: { English: "Your project", Arabic: "مشروعك" },
  calloutTakeaways: { English: "Key takeaways", Arabic: "أهم النقاط" },

  // Personalized workplace scenario
  scenarioLabel: { English: "Workplace scenario", Arabic: "سيناريو من بيئة العمل" },
  scenarioPause: { English: "What would you do next?", Arabic: "ماذا كنت ستفعل بعد ذلك؟" },
  scenarioPauseHint: {
    English: "Decide before you read on.",
    Arabic: "قرّر قبل أن تكمل القراءة.",
  },
  scenarioReveal: { English: "See what happened", Arabic: "اعرف ما حدث" },
  scenarioPending: {
    English: "This part is written for each learner's industry and department when they open the lesson.",
    Arabic: "يُكتب هذا الجزء لمجال عمل كل متعلم وقسمه عند فتح الدرس.",
  },
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
