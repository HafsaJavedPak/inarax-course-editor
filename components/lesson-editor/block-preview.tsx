"use client"

import type { ReactNode } from "react"

import { SPEC_FORMS, isSpecBlockType } from "@/lib/block-forms"
import { BLOCK_CATALOG, type AuthorableBlockType, type BlockDataMap } from "@/lib/lesson"

import "@/components/lesson-editor/block-preview.scss"

/**
 * What the add-block menu shows beside the highlighted block: a small sketch
 * of how learners see it, what they do with it, and when to reach for it.
 * The sketches are drawn here (not the player's real blocks), so they appear
 * instantly and can't take focus from the menu.
 */
const HAND_WRITTEN_COPY: Record<keyof BlockDataMap, { learner: string; goodFor: string }> = {
  rich_text: {
    learner: "Reads formatted text: headings, lists, quotes, code and tables.",
    goodFor: "Explanations, instructions and anything that is mostly words.",
  },
  image: {
    learner: "Sees a single image with an optional caption underneath.",
    goodFor: "Screenshots, photos and diagrams that need no interaction.",
  },
  image_hotspot: {
    learner: "Clicks numbered pins on an image to open a short note on each.",
    goodFor: "Labelling the parts of an interface, diagram or photo.",
  },
  flip_cards: {
    learner: "Flips each card to reveal the back, e.g. a term then its definition.",
    goodFor: "Vocabulary, quick recall and question / answer pairs.",
  },
  accordion_tabs: {
    learner: "Opens one titled section at a time, shown as an accordion or tabs.",
    goodFor: "Breaking long content into parts learners explore at their pace.",
  },
  stepped_timeline: {
    learner: "Steps through numbered phases one after another.",
    goodFor: "Processes, workflows and how-to sequences.",
  },
  wheel_diagram: {
    learner: "Picks a slice of a wheel to read about it; the core idea sits in the middle.",
    goodFor: "Cycles and the parts of one central concept.",
  },
  nested_layers: {
    learner: "Opens layers drawn one inside the next, from outermost to core.",
    goodFor: "Hierarchies, scopes and “part of a bigger whole” models.",
  },
  add_next_layer: {
    learner: "Presses a button to reveal each layer, building the idea up in steps.",
    goodFor: "Introducing a concept gradually, one piece at a time.",
  },
  format_switcher: {
    learner: "Switches between several takes on the same idea.",
    goodFor: "Showing an idea as text, an analogy and an example.",
  },
  image_switcher: {
    learner: "Toggles between images to compare them in the same spot.",
    goodFor: "Before / after shots, variants and side-by-side comparisons.",
  },
  vertical_roadmap: {
    learner: "Scrolls down a timeline of dated events, grouped into coloured eras.",
    goodFor: "History, project phases and long-term plans.",
  },
  mcq: {
    learner: "Answers a question by choosing one option, then sees the explanation.",
    goodFor: "Checking understanding with a single correct answer. Scored.",
  },
  categorization: {
    learner: "Sorts each item into the bucket it belongs to.",
    goodFor: "Classifying examples into groups. Scored per item.",
  },
  sequencing: {
    learner: "Drags items into the correct order.",
    goodFor: "Checking that learners know the steps of a process. Scored.",
  },
  fill_blank: {
    learner: "Completes a passage by choosing the missing word in each gap.",
    goodFor: "Key terms in context. Scored per blank.",
  },
}

// --- Sketch pieces -------------------------------------------------------------

function Line({ w = 100, tone }: { w?: number; tone?: "strong" | "accent" }) {
  return <span className="bp-line" data-tone={tone} style={{ width: `${w}%` }} />
}

function Picture({ children }: { children?: ReactNode }) {
  return (
    <span className="bp-picture">
      <span className="bp-picture-sun" />
      <span className="bp-picture-hill" />
      {children}
    </span>
  )
}

function Sketch({ type }: { type: AuthorableBlockType }): ReactNode {
  switch (type) {
    case "rich_text":
      return (
        <div className="bp-stack">
          <Line w={55} tone="strong" />
          <Line />
          <Line w={88} />
          <div className="bp-bullets">
            <Line w={70} />
            <Line w={60} />
          </div>
        </div>
      )
    case "image":
      return (
        <div className="bp-stack">
          <Picture />
          <Line w={45} />
        </div>
      )
    case "image_hotspot":
      return (
        <div className="bp-stack">
          <Picture>
            <span className="bp-pin" style={{ left: "22%", top: "30%" }}>1</span>
            <span className="bp-pin" data-active style={{ left: "58%", top: "52%" }}>2</span>
            <span className="bp-pin" style={{ left: "80%", top: "24%" }}>3</span>
            <span className="bp-popover" style={{ left: "30%", top: "62%" }}>
              <Line w={70} tone="strong" />
              <Line />
            </span>
          </Picture>
        </div>
      )
    case "flip_cards":
      return (
        <div className="bp-row">
          <span className="bp-card">Term</span>
          <span className="bp-card" data-flipped>
            Definition
          </span>
          <span className="bp-card">Term</span>
        </div>
      )
    case "accordion_tabs":
      return (
        <div className="bp-stack bp-gap-sm">
          <span className="bp-panel" data-open>
            <span className="bp-panel-title">
              <Line w={45} tone="strong" />
              <span className="bp-chevron">▾</span>
            </span>
            <Line />
            <Line w={75} />
          </span>
          <span className="bp-panel">
            <span className="bp-panel-title">
              <Line w={55} tone="strong" />
              <span className="bp-chevron">▸</span>
            </span>
          </span>
          <span className="bp-panel">
            <span className="bp-panel-title">
              <Line w={40} tone="strong" />
              <span className="bp-chevron">▸</span>
            </span>
          </span>
        </div>
      )
    case "stepped_timeline":
      return (
        <div className="bp-stack">
          <div className="bp-steps">
            <span className="bp-step" data-done>1</span>
            <span className="bp-step-link" data-done />
            <span className="bp-step" data-active>2</span>
            <span className="bp-step-link" />
            <span className="bp-step">3</span>
            <span className="bp-step-link" />
            <span className="bp-step">4</span>
          </div>
          <span className="bp-panel">
            <Line w={40} tone="strong" />
            <Line />
            <Line w={80} />
          </span>
        </div>
      )
    case "wheel_diagram": {
      const slices = 6
      const r = 44
      const paths = Array.from({ length: slices }, (_, i) => {
        const a0 = (i / slices) * 2 * Math.PI - Math.PI / 2
        const a1 = ((i + 1) / slices) * 2 * Math.PI - Math.PI / 2
        const p = (a: number) => `${50 + r * Math.cos(a)} ${50 + r * Math.sin(a)}`
        return `M50 50 L${p(a0)} A${r} ${r} 0 0 1 ${p(a1)} Z`
      })
      return (
        <div className="bp-center">
          <svg className="bp-wheel" viewBox="0 0 100 100" aria-hidden>
            {paths.map((d, i) => (
              <path key={i} d={d} data-active={i === 1 || undefined} />
            ))}
            <circle cx="50" cy="50" r="15" />
          </svg>
        </div>
      )
    }
    case "nested_layers":
      return (
        <div className="bp-center">
          <span className="bp-nest">
            <span className="bp-nest">
              <span className="bp-nest" data-active>
                <span className="bp-nest-core" />
              </span>
            </span>
          </span>
        </div>
      )
    case "add_next_layer":
      return (
        <div className="bp-stack bp-gap-sm">
          <span className="bp-panel">
            <Line w={35} tone="strong" />
            <Line w={85} />
          </span>
          <span className="bp-panel">
            <Line w={45} tone="strong" />
            <Line w={70} />
          </span>
          <span className="bp-button-ghost">+ Add the next layer</span>
        </div>
      )
    case "format_switcher":
      return (
        <div className="bp-stack">
          <div className="bp-segments">
            <span data-active>Text</span>
            <span>Analogy</span>
            <span>Example</span>
          </div>
          <span className="bp-panel">
            <Line />
            <Line w={90} />
            <Line w={60} />
          </span>
        </div>
      )
    case "image_switcher":
      return (
        <div className="bp-stack">
          <Picture />
          <div className="bp-segments bp-segments-pills">
            <span>Before</span>
            <span data-active>After</span>
          </div>
        </div>
      )
    case "vertical_roadmap":
      return (
        <div className="bp-roadmap">
          {[
            { color: "#4f46e5", date: "1990" },
            { color: "#4f46e5", date: "1998" },
            { color: "#059669", date: "2007" },
            { color: "#d97706", date: "2016" },
          ].map((event) => (
            <span key={event.date} className="bp-roadmap-event">
              <span className="bp-roadmap-date">{event.date}</span>
              <span className="bp-roadmap-dot" style={{ background: event.color }} />
              <Line w={70} />
            </span>
          ))}
        </div>
      )
    case "mcq":
      return (
        <div className="bp-stack bp-gap-sm">
          <Line w={80} tone="strong" />
          {[false, true, false].map((chosen, i) => (
            <span key={i} className="bp-option" data-correct={chosen || undefined}>
              <span className="bp-radio" />
              <Line w={[60, 75, 50][i]} />
            </span>
          ))}
        </div>
      )
    case "categorization":
      return (
        <div className="bp-stack">
          <div className="bp-row bp-row-wrap">
            <span className="bp-chip" data-dragging>Item</span>
            <span className="bp-chip">Item</span>
          </div>
          <div className="bp-row">
            <span className="bp-bucket">
              <span className="bp-bucket-label">Group A</span>
              <span className="bp-chip">Item</span>
            </span>
            <span className="bp-bucket">
              <span className="bp-bucket-label">Group B</span>
              <span className="bp-chip">Item</span>
              <span className="bp-chip">Item</span>
            </span>
          </div>
        </div>
      )
    case "sequencing":
      return (
        <div className="bp-stack bp-gap-sm">
          {[70, 55, 80, 45].map((w, i) => (
            <span key={i} className="bp-option" data-dragging={i === 1 || undefined}>
              <span className="bp-handle">⋮⋮</span>
              <span className="bp-order">{i + 1}</span>
              <Line w={w} />
            </span>
          ))}
        </div>
      )
    case "fill_blank":
      return (
        <div className="bp-sentence">
          <Line w={30} />
          <span className="bp-blank">word ▾</span>
          <Line w={42} />
          <Line w={55} />
          <span className="bp-blank" data-filled>
            term ▾
          </span>
          <Line w={22} />
        </div>
      )
    default:
      // Form-driven blocks share a generic sketch; their real look is in the lesson preview.
      return (
        <div className="bp-stack">
          <Line w={50} tone="strong" />
          <Line />
          <div className="bp-row">
            <span className="bp-card">A</span>
            <span className="bp-card" data-flipped>
              B
            </span>
          </div>
          <Line w={70} />
        </div>
      )
  }
}

// --- Panel -------------------------------------------------------------------

export function BlockPreview({ type }: { type: AuthorableBlockType | null }) {
  if (!type) {
    return (
      <div className="bp-empty">
        <p>Hover a block to see what it looks like and when to use it.</p>
      </div>
    )
  }

  const meta = BLOCK_CATALOG[type]
  const copy = isSpecBlockType(type) ? SPEC_FORMS[type] : HAND_WRITTEN_COPY[type]
  return (
    <div className="bp" data-category={meta.category}>
      <div className="bp-stage" aria-hidden>
        <Sketch type={type} />
      </div>
      <div className="bp-text">
        <p className="bp-title">
          {meta.label}
          <span className="bp-category">{meta.category}</span>
        </p>
        <p className="bp-learner">{copy.learner}</p>
        <p className="bp-good-for">
          <strong>Good for:</strong> {copy.goodFor}
        </p>
      </div>
    </div>
  )
}
