// Writes the language-neutral parts of the contract from lib/protocol/:
//
//   contract/schemas/*.schema.json      JSON Schema (2020-12) for every message
//   contract/fixtures/signing.json      signature test vectors
//   contract/fixtures/course-package.json  an example course package
//
// Hosts in any language validate against the schemas and check their signing
// code against the vectors. Run after changing lib/protocol/:
//
//   npm run contract:generate     write the files
//   npm run contract:check        fail if they're out of date (CI)

import { mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"

import { z } from "zod"

import { signLaunchToken } from "../lib/protocol/launch"
import { signRequest, stringToSign } from "../lib/protocol/signing"
import {
  AssetSchema,
  CoursePackageSchema,
  DeleteResultSchema,
  LessonContentSchema,
  ManifestSchema,
  PROTOCOL_VERSION,
  ProblemSchema,
  PublishResultSchema,
  type CoursePackage,
} from "../lib/protocol/wire"

const ROOT = path.join(__dirname, "..", "contract")
const check = process.argv.includes("--check")

const SCHEMAS: Record<string, z.ZodType> = {
  "course-package": CoursePackageSchema,
  "lesson-content": LessonContentSchema,
  "publish-result": PublishResultSchema,
  "delete-result": DeleteResultSchema,
  asset: AssetSchema,
  manifest: ManifestSchema,
  problem: ProblemSchema,
}

function schemaFile(name: string, schema: z.ZodType) {
  return {
    $id: `https://inara.dev/course-publishing-protocol/${PROTOCOL_VERSION}/${name}.schema.json`,
    ...z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }),
  }
}

// Fixed inputs, so the vectors only change when the algorithm does.
const SIGNING_KEY = { id: "example-key", secret: "example-secret-do-not-use-in-production" }
const SIGNING_CASES = [
  { method: "GET", path_with_query: "/api/integrations/course-editor/v1/manifest", body: "", timestamp: 1_800_000_000 },
  {
    method: "PUT",
    path_with_query: "/api/integrations/course-editor/v1/courses/7f72e600-3425-490c-b530-0179826cb206",
    body: '{"protocol":"1.0"}',
    timestamp: 1_800_000_123,
  },
  {
    method: "DELETE",
    path_with_query: "/v1/courses/7f72e600-3425-490c-b530-0179826cb206?reason=test",
    body: "",
    timestamp: 1_800_000_456,
  },
]

function signingVectors() {
  return {
    description: "Test vectors for X-Editor-Signature. See contract/README.md § Authentication.",
    key: SIGNING_KEY,
    cases: SIGNING_CASES.map((c) => {
      const request = { method: c.method, pathWithQuery: c.path_with_query, body: c.body }
      return { ...c, string_to_sign: stringToSign(request, c.timestamp), signature: signRequest(request, SIGNING_KEY, c.timestamp)["x-editor-signature"] }
    }),
  }
}

function examplePackage(): CoursePackage {
  const pkg: CoursePackage = {
    protocol: PROTOCOL_VERSION,
    course: {
      id: "7f72e600-3425-490c-b530-0179826cb206",
      revision: 12,
      title: "Prompt engineering basics",
      summary: "How to write prompts that get useful answers.",
      learning_objectives: ["Write a clear prompt", "Iterate on a prompt"],
      audience: "Professionals new to AI tools",
      cover_image_url: "https://cdn.example.com/editor-assets/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      length_hours: 2,
      lesson_size: "short",
      pricing: { type: "free" },
    },
    review: { status: "in_review", note: null, changes: [] },
    levels: [
      {
        key: "associate",
        title: "Associate",
        modules: [
          {
            id: "0d5e4f8a-3b1c-4c2d-9e6f-7a8b9c0d1e2f",
            title: "Getting started",
            summary: "",
            lessons: [
              {
                id: "c107dca3-7b73-4411-8e4c-bc1f7f2371b0",
                title: "What a prompt is",
                content: {
                  version: 1,
                  format: "blocks",
                  sections: [
                    {
                      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
                      title: "The idea",
                      required_to_advance: true,
                      blocks: [
                        { id: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e", type: "rich_text", personalized: false, data: { markdown: "A **prompt** is…" } },
                        {
                          id: "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f",
                          type: "mcq",
                          personalized: false,
                          data: { question: "What is a prompt?", options: ["An instruction", "A model"], correct_index: 0 },
                        },
                      ],
                    },
                  ],
                },
              },
              { id: "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a", title: "Not written yet", content: null },
            ],
          },
        ],
      },
      { key: "intermediate", title: "Intermediate", modules: [] },
      { key: "advanced", title: "Advanced", modules: [] },
    ],
    // The host's id for the person, from their launch token's `sub`.
    actor: { id: "3f0c2b9e-8a41-4d7e-9c55-2b6f1e0a7d13", name: "Sara Khan", email: "sara@example.com" },
    sent_at: "2026-10-05T09:00:00.000Z",
  }
  return CoursePackageSchema.parse(pkg)
}

function launchVector() {
  const now = 1_800_000_000
  const token = signLaunchToken(
    {
      iss: "example-host",
      sub: "3f0c2b9e-8a41-4d7e-9c55-2b6f1e0a7d13",
      email: "sara@example.com",
      name: "Sara Khan",
      role: "creator",
      iat: now,
      exp: now + 60,
      jti: "7d1f0e5a-2c4b-4e8f-9a3d-6b5c4d3e2f1a",
    },
    SIGNING_KEY,
    now,
  )
  const [, payload, signature] = token.split(".")
  return {
    description: "A launch token and its parts. See contract/README.md § Launch. Valid at verify_at; expired 60 s later.",
    key: SIGNING_KEY,
    signing_context: "course-editor-launch.v1.",
    verify_at: now + 10,
    token,
    payload_b64url: payload,
    signature_b64url: signature,
    claims: JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  }
}

const files: [string, unknown][] = [
  ...Object.entries(SCHEMAS).map(([name, schema]) => [`schemas/${name}.schema.json`, schemaFile(name, schema)] as [string, unknown]),
  ["fixtures/signing.json", signingVectors()],
  ["fixtures/launch.json", launchVector()],
  ["fixtures/course-package.json", examplePackage()],
]

let stale = 0
for (const [rel, value] of files) {
  const file = path.join(ROOT, rel)
  const text = JSON.stringify(value, null, 2) + "\n"
  if (check) {
    let current = ""
    try {
      current = readFileSync(file, "utf8")
    } catch {}
    if (current !== text) {
      console.error(`contract/${rel} is out of date`)
      stale++
    }
  } else {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
    console.log(`wrote contract/${rel}`)
  }
}
if (stale) {
  console.error("Run `npm run contract:generate` and commit the result.")
  process.exit(1)
}
