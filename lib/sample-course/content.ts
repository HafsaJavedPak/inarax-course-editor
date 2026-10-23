// The sample course every new user is given (lib/sample-course/index.ts): a
// short course about the editor itself. Each lesson uses some of the blocks
// and says what they are, when to use them and how to edit them; together the
// lessons use every block the editor can author (tests/course/sample-course.test.ts
// checks that, and that the course passes every submission check).
//
// Ids are left out here: each copy gets fresh ones. Pictures are in
// public/images/sample-course; `image(name)` gives their full address.

import type { CourseInfo, LevelId, PlacementQuestion } from "@/lib/course"
import type { BlockDataMap } from "@/lib/lesson"

export const SAMPLE_IMAGES = ["cover", "course-structure", "lesson-editor", "view-laptop", "view-phone"] as const
export type SampleImage = (typeof SAMPLE_IMAGES)[number]

export type SampleBlock = { [K in keyof BlockDataMap]: { type: K; data: BlockDataMap[K] } }[keyof BlockDataMap]
export type SampleSection = { title: string; required: boolean; blocks: SampleBlock[] }
export type SampleLesson = { title: string; sections: SampleSection[] }
export type SampleModule = { title: string; summary: string; lessons: SampleLesson[] }
export type SamplePlacementQuestion = Omit<PlacementQuestion, "id">
export type SampleCourseTemplate = {
  info: CourseInfo
  levels: Record<LevelId, SampleModule[]>
  placement: Record<LevelId, SamplePlacementQuestion[]>
}

const text = (markdown: string): SampleBlock => ({ type: "rich_text", data: { markdown } })

export function sampleCourseTemplate(image: (name: SampleImage) => string): SampleCourseTemplate {
  return {
    info: {
      title: "Start here: a tour of the course editor",
      summary:
        "A short course about building courses. Each lesson shows some of the blocks you can use, what they're for and how to edit them. Change anything: this copy is yours.",
      learning_objectives: [
        "Explain how a course is organised into levels, modules, lessons, sections and blocks",
        "Choose the right block for what you want learners to do",
        "Write questions that check understanding",
        "Take a course from draft to published, alone or with others",
      ],
      cover_image_url: image("cover"),
      audience: "Anyone new to the course editor",
      length_hours: 0.5,
      lesson_size: "short",
      pricing: { type: "free" },
      metadata: { domains: ["Generic"], future_goals: [], departments: [], require_future_goal: false },
      // Fitted to this course, so it passes every submission check (the lesson size buttons are only presets).
      limits: {
        words: { min: 250, max: 900 },
        sections: { min: 3, max: 6 },
        minutes_per_lesson: 8,
        words_per_minute: 200,
        level_shares: { associate: 26, intermediate: 40, advanced: 34 },
        tolerance_percent: 25,
      },
    },
    levels: {
      associate: [
        {
          title: "Getting started",
          summary: "How a course is put together, and the blocks for text and pictures.",
          lessons: [lessonCourseStructure(image), lessonTextAndImages(image)],
        },
      ],
      intermediate: [
        {
          title: "Making lessons interactive",
          summary: "Explore blocks: learners tap, open and reveal things. There are no wrong answers.",
          lessons: [lessonCardsTabsTimelines(), lessonDiagrams(), lessonPicturesFormatsRoadmaps(image)],
        },
      ],
      advanced: [
        {
          title: "Checking understanding and finishing",
          summary: "Assess blocks, which are scored, and taking a course to learners.",
          lessons: [lessonQuestions(), lessonDraftToPublished()],
        },
      ],
    },
    placement: samplePlacement(),
  }
}

const q = (
  difficulty: PlacementQuestion["difficulty"],
  question: string,
  options: string[],
  explanation: string,
): SamplePlacementQuestion => ({ difficulty, question, options, correct_index: 0, explanation })

/** Each level's placement questions: a few of each difficulty (a level needs at least 1 easy, 1 medium and 1 hard). */
function samplePlacement(): SampleCourseTemplate["placement"] {
  return {
    associate: [
      q("easy", "What does a course's level hold?", ["Modules", "Blocks", "Learners"], "Levels hold modules, and modules hold lessons."),
      q("medium", "What do learners see one at a time in a lesson?", ["Sections", "Modules", "Levels"], "A lesson is split into sections, shown one at a time."),
      q("medium", "Which block is best for a paragraph of explanation?", ["Rich text", "Flip cards", "Sequencing"], "Rich text is for reading; the others ask learners to do something."),
      q("hard", "A picture has no alt text. Who is affected most?", ["Learners using a screen reader", "Reviewers", "Nobody"], "Alt text is read aloud to learners who can't see the picture."),
      q("hard", "Where do you set a course's cover image?", ["The course settings", "The first lesson", "The review page"], "The cover is part of the course settings."),
    ],
    intermediate: [
      q("easy", "Do explore blocks have wrong answers?", ["No", "Yes", "Only in the last section"], "Explore blocks let learners tap and reveal; nothing is scored."),
      q("medium", "Which block reveals one side of a card, then the other?", ["Flip cards", "Accordion tabs", "Image hotspot"], "Flip cards show a front and a back."),
      q("medium", "Which block shows events in order along a line?", ["Stepped timeline", "Wheel diagram", "Image switcher"], "A stepped timeline walks through events in order."),
      q("hard", "You want learners to compare the same content as text, a table and a chart. Which block?", ["Format switcher", "Nested layers", "Flip cards"], "A format switcher shows one idea in several formats."),
      q("hard", "Which block suits explaining parts that sit inside each other?", ["Nested layers", "Vertical roadmap", "Accordion tabs"], "Nested layers show parts within parts."),
    ],
    advanced: [
      q("easy", "Which kind of block is scored?", ["Assess blocks", "Explore blocks", "Content blocks"], "Assess blocks check understanding and are scored."),
      q("medium", "Which block asks learners to put items in order?", ["Sequencing", "Categorization", "Multiple choice"], "Sequencing checks the order of items."),
      q("medium", "Which block asks learners to sort items into groups?", ["Categorization", "Fill in the blank", "Sequencing"], "Categorization sorts items into buckets."),
      q("hard", "What happens when you edit an accepted course?", ["It goes back to draft", "Nothing changes", "It's deleted"], "An edit after acceptance reopens the course as a draft for review."),
      q("hard", "Who can accept a course for the catalogue?", ["Platform reviewers", "Any collaborator", "The course's owner"], "Only platform reviewers decide on courses in review."),
    ],
  }
}

// ---------------------------------------------------------------------------
// Associate
// ---------------------------------------------------------------------------

function lessonCourseStructure(image: (name: SampleImage) => string): SampleLesson {
  return {
    title: "How a course is put together",
    sections: [
      {
        title: "Welcome",
        required: false,
        blocks: [
          text(
            [
              "Everything in this course was made with the editor you're using now. Each lesson shows a few of the building blocks you can use in your own courses, and explains what they're for.",
              "",
              "**Change anything you like.** Open a lesson, edit a block, add or delete things. This copy is yours alone, so nothing you do here affects anyone else.",
              "",
              "A few things to know before you start:",
              "",
              "- **Preview**, at the top of each page, shows the course exactly as learners will see it. Try it on this lesson.",
              "- Every block shows its type above it in the editor, for example *Rich text* or *Flip cards*.",
              "- To start a course of your own, go back to **Your courses** and choose **+ New course**.",
              "",
              "This sample can't be submitted for review or published. It's here to learn from.",
            ].join("\n"),
          ),
          {
            type: "image",
            data: {
              image_url: image("course-structure"),
              alt: "A course split into three levels. Each level holds modules, and each module holds lessons.",
              caption: "A course has three levels. Each level holds modules, and each module holds lessons.",
            },
          },
        ],
      },
      {
        title: "From course to block",
        required: true,
        blocks: [
          text(
            "## Six layers, each inside the next\n\nA course is organised in layers. Open each one below to see what it holds and where you change it.",
          ),
          {
            type: "nested_layers",
            data: {
              layers: [
                { id: "l1", label: "Course", body: "The whole thing: its title, summary, cover picture and price. Change these under **Settings** on the course page." },
                { id: "l2", label: "Level", body: "Every course has three levels: **Associate**, **Intermediate** and **Advanced**. Switch between them with the tabs on the course page." },
                { id: "l3", label: "Module", body: "A group of lessons on one topic inside a level. Add modules on the course page with **+ Add module**, and move them up or down." },
                { id: "l4", label: "Lesson", body: "What learners open and work through. Click a lesson's title on the course page to write it." },
                { id: "l5", label: "Section", body: "One step of a lesson. Learners see one section at a time and press **Next** to move on." },
                { id: "l6", label: "Block", body: "The pieces inside a section: text, a picture, cards to flip, a question. Choose them with **Add block**." },
              ],
            },
          },
          text("The block above is called **Nested layers**. Use it when each thing really sits inside the one before it, and list the outermost first."),
        ],
      },
      {
        title: "Words you'll see",
        required: true,
        blocks: [
          {
            type: "flip_cards",
            data: {
              cards: [
                { id: "c1", front: "Section", back: "One step of a lesson. Learners move from section to section with the Next button." },
                { id: "c2", front: "Required to advance", back: "A setting on each section: when it's on, learners must finish every interactive block before Next works." },
                { id: "c3", front: "Explore block", back: "An interactive block with no right answer, such as these cards. Learners complete it by opening everything." },
                { id: "c4", front: "Assess block", back: "A question with an answer key. Learners get points for answering correctly." },
              ],
            },
          },
          text(
            "These are **Flip cards**. Learners tap a card to turn it over, and the block is complete once every card has been turned. Keep the front short, a word or a question, and the back to a sentence or two.",
          ),
        ],
      },
      {
        title: "Check yourself",
        required: true,
        blocks: [
          {
            type: "mcq",
            data: {
              question: "What do learners move through one at a time, pressing Next each time?",
              options: ["Sections", "Modules", "Levels"],
              correct_index: 0,
              points: 10,
              explanation: "A lesson is split into sections, and learners see one section at a time. Modules and levels group whole lessons.",
            },
          },
        ],
      },
    ],
  }
}

function lessonTextAndImages(image: (name: SampleImage) => string): SampleLesson {
  return {
    title: "Writing with text and images",
    sections: [
      {
        title: "Rich text",
        required: false,
        blocks: [
          text(
            [
              "## The workhorse: rich text",
              "",
              "Most of what learners read is a **Rich text** block. You can write it in two ways:",
              "",
              "- **Visual**, like a word processor. Select words to make them bold or italic, and add headings, lists and links from the toolbar.",
              "- **Markdown**, the same text written with simple marks, such as two hash signs before a heading or two asterisks around a bold word.",
              "",
              "Switch with the *Visual* and *Markdown* tabs above each text block. This block works in both.",
              "",
              "Some habits that help learners:",
              "",
              "1. Start by saying what the learner will be able to do.",
              "2. Explain one idea at a time, in short paragraphs.",
              "3. Give an example before the rule.",
            ].join("\n"),
          ),
          text(
            [
              "## Callouts, tables and formulas",
              "",
              "A few things only work in **Markdown**, so a text block that uses them opens there. This one does.",
              "",
              ":::info Key idea",
              "A callout box draws the eye to one important point. Start it with three colons and its type, and end it with three colons on their own line.",
              ":::",
              "",
              ":::warning Watch out",
              "Use callouts sparingly. If everything is highlighted, nothing stands out.",
              ":::",
              "",
              "| You want learners to… | Use |",
              "|---|---|",
              "| read an explanation | Rich text |",
              "| look at a picture | Image |",
              "| explore an idea | an *Explore* block |",
              "| show what they understood | an *Assess* block |",
              "",
              "You can :color[colour a word]{blue} or :highlight[highlight a phrase]{yellow}, and write formulas such as $a^2 + b^2 = c^2$.",
            ].join("\n"),
          ),
        ],
      },
      {
        title: "Images",
        required: false,
        blocks: [
          {
            type: "image",
            data: {
              image_url: image("lesson-editor"),
              alt: "The lesson editor: the lesson's sections down the middle, each holding blocks, with Preview and the save status at the top.",
              caption: "The lesson editor, where you write each lesson.",
            },
          },
          text(
            [
              "That's an **Image** block. Upload a picture, or paste the address of one that's already online. Then write the **alt text**: a short description that's read aloud to learners who can't see the picture. A caption is optional.",
              "",
              "Pictures earn their place when they show something words can't, such as a diagram, a screenshot or a chart.",
            ].join("\n"),
          ),
        ],
      },
      {
        title: "Check yourself",
        required: true,
        blocks: [
          {
            type: "mcq",
            data: {
              question: "Which of these can you only write in Markdown mode?",
              options: ["A table", "A bold word", "A list"],
              correct_index: 0,
              points: 10,
              explanation: "Tables, callouts and formulas need Markdown. Bold words, lists, headings and links work in both modes.",
            },
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Intermediate
// ---------------------------------------------------------------------------

function lessonCardsTabsTimelines(): SampleLesson {
  return {
    title: "Cards, tabs and timelines",
    sections: [
      {
        title: "Explore blocks",
        required: false,
        blocks: [
          text(
            [
              "## Learning by doing",
              "",
              "**Explore** blocks ask learners to do something: open, tap or reveal. There's no right or wrong answer, so they're good for introducing ideas without pressure.",
              "",
              "When a section is set to **Required to advance**, learners must finish every explore block in it before **Next** works. Turn that off for sections that are only for reading.",
            ].join("\n"),
          ),
        ],
      },
      {
        title: "Accordion",
        required: true,
        blocks: [
          {
            type: "accordion_tabs",
            data: {
              display: "accordion",
              sections: [
                {
                  id: "s1",
                  title: "Content blocks",
                  body: "Rich text and images: what learners read and look at. Nothing to complete.\n\n:::good Good for\nExplanations, examples and diagrams.\n:::",
                },
                {
                  id: "s2",
                  title: "Explore blocks",
                  body: "Cards, tabs, timelines, diagrams and roadmaps: learners open or reveal everything. No answers.\n\n:::good Good for\nIntroducing ideas, and parts or steps of a whole.\n:::",
                },
                {
                  id: "s3",
                  title: "Assess blocks",
                  body: "Multiple choice, categorization, sequencing and fill in the blanks: each has an answer key and earns points.\n\n:::good Good for\nChecking understanding at the end of a section.\n:::",
                },
              ],
            },
          },
          text(
            "That's an **Accordion**. Learners open each part in turn, and the block is complete once every part has been opened. In the editor, each part has a title and a body, and the body is written like rich text.",
          ),
        ],
      },
      {
        title: "Tabs",
        required: true,
        blocks: [
          {
            type: "accordion_tabs",
            data: {
              display: "tabs",
              sections: [
                { id: "s1", title: "Course page", body: "Levels, modules and lessons, the course's checks, and the buttons to preview, share and submit." },
                { id: "s2", title: "Lesson editor", body: "Sections and blocks. **Add block** shows every block type with a short description." },
                { id: "s3", title: "Settings", body: "Title, summary, audience, price and cover picture, and the limits for word counts and lesson length." },
                { id: "s4", title: "History", body: "Every version of the course. Compare two versions, or restore an older one." },
              ],
            },
          },
          text(
            "The same block can show its parts as **Tabs**: choose *Tabs* instead of *Accordion* in the editor. Tabs are optional for learners: they never hold up Next and earn no points, so use them for reference material learners may skim.",
          ),
        ],
      },
      {
        title: "Stepped timeline",
        required: true,
        blocks: [
          {
            type: "stepped_timeline",
            data: {
              steps: [
                { id: "t1", label: "Draft", body: "You write the course. Only you, and anyone you share it with, can see it." },
                { id: "t2", label: "Submit", body: "When the course passes its checks, submit it for review. It's locked while it's reviewed." },
                { id: "t3", label: "Review", body: "A reviewer reads it and accepts it, asks for changes or rejects it, with notes for you." },
                { id: "t4", label: "Publish", body: "An accepted course is published to the platform, where learners can take it." },
              ],
            },
          },
          text(
            "That's a **Stepped timeline**. Learners go through the steps in order. Use it for a process or a sequence of stages; for dated history, use a *Roadmap* instead.",
          ),
        ],
      },
    ],
  }
}

function lessonDiagrams(): SampleLesson {
  return {
    title: "Diagrams that build an idea",
    sections: [
      {
        title: "Three shapes of idea",
        required: false,
        blocks: [
          text(
            [
              "## Pick the diagram that fits",
              "",
              "Three blocks draw an idea as a picture, and each fits a different kind of idea:",
              "",
              "- **Wheel diagram**: several equal parts of one whole, in no order.",
              "- **Nested layers**: each thing sits inside the one before it. You met it in the first lesson.",
              "- **Add the next layer**: each step keeps what came before and adds something new.",
              "",
              "If the parts simply happen one after another, a *Stepped timeline* is the better choice.",
            ].join("\n"),
          ),
        ],
      },
      {
        title: "Wheel diagram",
        required: true,
        blocks: [
          {
            type: "wheel_diagram",
            data: {
              center_label: "A good lesson",
              slices: [
                { id: "s1", label: "Clear goal", body: "Learners know from the start what they'll be able to do by the end." },
                { id: "s2", label: "One idea", body: "Each section explains one idea before moving on to the next." },
                { id: "s3", label: "Examples", body: "Concrete examples come before the general rule." },
                { id: "s4", label: "Practice", body: "Learners use the idea themselves, not only read about it." },
                { id: "s5", label: "Feedback", body: "Questions explain why an answer is right or wrong." },
              ],
            },
          },
          text(
            "That's a **Wheel diagram**: two to eight slices around a centre label. Learners tap each slice to read it. Keep slice labels to a word or three, because longer ones are cut short on the wheel.",
          ),
        ],
      },
      {
        title: "Add the next layer",
        required: true,
        blocks: [
          {
            type: "add_next_layer",
            data: {
              button_label: "Add the next layer",
              layers: [
                { id: "l1", label: "Text", body: "Start with a short explanation of one idea." },
                { id: "l2", label: "A picture", body: "Add a diagram or screenshot that shows what the text describes." },
                { id: "l3", label: "Something to do", body: "Add an explore block, so learners work with the idea themselves." },
                { id: "l4", label: "A question", body: "Finish with a question that checks the idea landed." },
              ],
            },
          },
          text(
            "That's **Add the next layer**. Learners start with the first layer and press the button to add each one on top. Put the foundation first, and make each layer say what it adds. You can change the button's wording in the editor.",
          ),
        ],
      },
    ],
  }
}

function lessonPicturesFormatsRoadmaps(image: (name: SampleImage) => string): SampleLesson {
  return {
    title: "Pictures, formats and roadmaps",
    sections: [
      {
        title: "Image hotspots",
        required: true,
        blocks: [
          {
            type: "image_hotspot",
            data: {
              image_url: image("lesson-editor"),
              alt: "The lesson editor, with numbered points to explore",
              caption: "Tap each numbered point.",
              hotspots: [
                { id: "h1", x: 37, y: 25, title: "Section title", info: "Each section can have a title, shown above it when learners reach it." },
                { id: "h2", x: 61, y: 39, title: "A block", info: "Each block shows its type, with buttons to move it up or down, duplicate it or delete it." },
                { id: "h3", x: 50, y: 96, title: "Add block", info: "Opens the list of every block type, grouped into Content, Explore and Assess." },
                { id: "h4", x: 75, y: 14, title: "Preview", info: "Shows the lesson exactly as learners will see it." },
                { id: "h5", x: 91, y: 14, title: "Save status", info: "Your changes are saved as you type. This shows when they're stored." },
              ],
            },
          },
          text(
            "That's an **Image hotspot**: a picture with points to tap. Each point has a title and a short text, and its place is set as a percentage across and down the picture, so it stays put at any size. Without points, the block is simply a captioned picture.",
          ),
        ],
      },
      {
        title: "Image switcher",
        required: true,
        blocks: [
          {
            type: "image_switcher",
            data: {
              options: [
                {
                  id: "o1",
                  label: "Laptop",
                  image_url: image("view-laptop"),
                  alt: "A lesson on a laptop screen, with the text in a wide column",
                  caption: "On a laptop, the lesson sits in one readable column.",
                },
                {
                  id: "o2",
                  label: "Phone",
                  image_url: image("view-phone"),
                  alt: "The same lesson on a phone, with the blocks stacked in a narrow column",
                  caption: "On a phone, the same blocks stack to fit the screen.",
                },
              ],
            },
          },
          text(
            "That's an **Image switcher**: one frame, and a button for each picture. Use pictures of the same size so the frame doesn't jump, and keep the button labels to a word or two, such as *Before* and *After*.",
          ),
        ],
      },
      {
        title: "Format switcher",
        required: true,
        blocks: [
          {
            type: "format_switcher",
            data: {
              title: "One learning objective, three ways",
              prompt: "Pick a format to see it.",
              complete_on: "all",
              options: [
                { id: "f1", label: "Sentence", body: "By the end, you'll be able to choose the right block for what you want learners to do." },
                { id: "f2", label: "Checklist", body: "- Read the idea\n- Explore it\n- Check it with a question" },
                { id: "f3", label: "Table", body: "| Goal | Block |\n|---|---|\n| Read | Rich text |\n| Explore | Flip cards |\n| Check | Multiple choice |" },
              ],
            },
          },
          text(
            "That's a **Format switcher**: the same content shown in different forms. With *Every format* chosen under *Complete when learners open*, learners must open every version; with *Any format*, one is enough. For different topics rather than versions of one, use an *Accordion*.",
          ),
        ],
      },
      {
        title: "Roadmap",
        required: false,
        blocks: [
          {
            type: "vertical_roadmap",
            data: {
              eras: [
                { id: "e1", name: "Plan", color: "sky" },
                { id: "e2", name: "Write", color: "indigo" },
                { id: "e3", name: "Review", color: "emerald" },
              ],
              events: [
                { id: "v1", date: "2026-01-05", era_id: "e1", text: "Agree what learners should be able to do by the end." },
                { id: "v2", date: "2026-01-12", era_id: "e1", text: "Sketch the levels, modules and lessons on the course page." },
                { id: "v3", date: "2026-02", era_id: "e2", text: "Write the lessons, sharing the course with a co-author." },
                { id: "v4", date: "2026-03-02", era_id: "e3", text: "Submit the course, then make the changes the reviewer asks for." },
                { id: "v5", date: "2026-03-16", era_id: "e3", text: "The course is accepted and published to learners." },
              ],
            },
          },
          text(
            "That's a **Roadmap**: dated events grouped into coloured eras, read from top to bottom. Dates are written as numbers (a year, a year and month, or a full date) and shown in the order you list them. A roadmap never holds up Next, so this section isn't required to advance.",
          ),
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

function lessonQuestions(): SampleLesson {
  return {
    title: "Questions that check understanding",
    sections: [
      {
        title: "How questions are scored",
        required: false,
        blocks: [
          text(
            [
              "## Assess blocks",
              "",
              "**Assess** blocks have an answer key. Learners earn full points for a right answer on the first try and half points after a retry, so a good question checks understanding rather than memory.",
              "",
              "A few tips:",
              "",
              "- Ask about the idea the section just taught.",
              "- Make wrong answers believable, and about as long as the right one.",
              "- Use the explanation to say *why* the answer is right.",
              "",
              "The editor warns you when one option is much longer than the others, because learners tend to guess the longest.",
            ].join("\n"),
          ),
        ],
      },
      {
        title: "Multiple choice",
        required: true,
        blocks: [
          {
            type: "mcq",
            data: {
              question: "A section introduces four new terms. Which block lets learners explore them?",
              options: ["Flip cards", "A roadmap", "Sequencing"],
              correct_index: 0,
              points: 10,
              explanation: "Flip cards suit terms and definitions. A roadmap is for dated events, and sequencing checks an order.",
            },
          },
          text(
            "That's **Multiple choice**: a question, two or more options, and the one correct option chosen in the editor. The explanation is shown after learners answer.",
          ),
        ],
      },
      {
        title: "Categorization",
        required: true,
        blocks: [
          {
            type: "categorization",
            data: {
              buckets: [
                { id: "b1", label: "Content" },
                { id: "b2", label: "Explore" },
                { id: "b3", label: "Assess" },
              ],
              items: [
                { id: "i1", label: "Rich text", correct_bucket_id: "b1" },
                { id: "i2", label: "Image", correct_bucket_id: "b1" },
                { id: "i3", label: "Flip cards", correct_bucket_id: "b2" },
                { id: "i4", label: "Wheel diagram", correct_bucket_id: "b2" },
                { id: "i5", label: "Multiple choice", correct_bucket_id: "b3" },
                { id: "i6", label: "Sequencing", correct_bucket_id: "b3" },
              ],
              points_per_match: 5,
            },
          },
          text(
            "That's **Categorization**: learners sort each item into the right group. In the editor you name the groups, then add items and choose each one's correct group.",
          ),
        ],
      },
      {
        title: "Sequencing",
        required: true,
        blocks: [
          {
            type: "sequencing",
            data: {
              items: [
                { id: "a", label: "Write the lessons" },
                { id: "b", label: "Submit for review" },
                { id: "c", label: "Make the requested changes" },
                { id: "d", label: "Publish to learners" },
              ],
              correct_order: ["a", "b", "c", "d"],
              points: 15,
            },
          },
          text(
            "That's **Sequencing**: learners put the items in the right order. In the editor you list the items in the correct order; learners see them mixed up.",
          ),
        ],
      },
      {
        title: "Fill in the blanks",
        required: true,
        blocks: [
          {
            type: "fill_blank",
            data: {
              template: "A {{b1}} holds lessons, and each lesson is split into {{b2}} that learners go through one at a time.",
              blanks: [
                { id: "b1", options: ["module", "block", "section"], correct_index: 0 },
                { id: "b2", options: ["sections", "levels", "modules"], correct_index: 0 },
              ],
              points_per_blank: 5,
            },
          },
          text(
            "That's **Fill in the blanks**: a sentence with gaps, each with a short list of choices. In the editor, put each gap in the sentence by its name in double curly brackets, then give the gap its choices and pick the right one.",
          ),
        ],
      },
    ],
  }
}

function lessonDraftToPublished(): SampleLesson {
  return {
    title: "From draft to published, together",
    sections: [
      {
        title: "Before you submit",
        required: false,
        blocks: [
          text(
            [
              "## The course checks",
              "",
              "The course page checks your course as you build it, and lists anything that would stop it being submitted:",
              "",
              "- every lesson in the outline has been written;",
              "- each lesson's word count and number of sections are within the course's limits;",
              "- every level has lessons, roughly in proportion to the course's length;",
              "- module titles are unique, and so are lesson titles within a module.",
              "",
              "The limits come from the lesson size you chose when creating the course. You can change any of them in **Settings**, as this sample does.",
            ].join("\n"),
          ),
        ],
      },
      {
        title: "Working with others",
        required: true,
        blocks: [
          {
            type: "accordion_tabs",
            data: {
              display: "accordion",
              sections: [
                {
                  id: "s1",
                  title: "Sharing",
                  body: "**Share** on the course page gives people access. A *co-owner* can do everything you can, an *editor* writes lessons and the outline, a *commenter* and a *viewer* read it.",
                },
                {
                  id: "s2",
                  title: "Editing together",
                  body: "Several people can edit the same lesson at once. You see each other's changes as you type, and who is working in which block.",
                },
                {
                  id: "s3",
                  title: "History",
                  body: "**History** keeps every version of the course and who made it. Compare versions, name one with *Save version*, or restore an older one. Restoring never deletes anything.",
                },
                {
                  id: "s4",
                  title: "Review",
                  body: "Only the owner and co-owners can submit the course. The reviewer's decision applies to exactly the version they read: if the course changes after it's accepted, it goes back to draft.",
                },
              ],
            },
          },
        ],
      },
      {
        title: "Your next step",
        required: true,
        blocks: [
          {
            type: "mcq",
            data: {
              question: "Who can submit a course for review?",
              options: ["Its owner and co-owners", "Anyone who can edit it", "Anyone who can read it"],
              correct_index: 0,
              points: 10,
              explanation: "Editors can change the lessons and outline, but submitting is for the owner and co-owners.",
            },
          },
          text(
            [
              "## You've seen every block",
              "",
              "That's the whole tour. Keep this course to come back to, and change it as much as you like to try things out.",
              "",
              "When you're ready, go to **Your courses** and choose **+ New course**. If you delete this sample, you can add a fresh copy from the same page.",
            ].join("\n"),
          ),
        ],
      },
    ],
  }
}
