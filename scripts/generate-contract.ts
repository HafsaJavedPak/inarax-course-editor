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
import { parsePrivateKeys, toJwks } from "../lib/protocol/keys"
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

// Fixed inputs, so the vectors only change when the algorithm does. These are
// EXAMPLE keys, published on purpose for checking implementations; never
// configure them anywhere. Ed25519 signatures are deterministic, so the
// vectors are reproducible.
const EXAMPLE_EDITOR_PRIVATE_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  kid: "example-editor-key",
  x: "JKq7S6lGt34wayEJP3vUFlMwmU6v-JLltqlDItn7iQI",
  d: "1M2cjJwLCwULH1TUsAAnoq8DIUQwTTVQwNIbLR7GRfI",
}
const EXAMPLE_HOST_PRIVATE_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  kid: "example-host-key",
  x: "The0h9XWOIcf9B-V6cco05IfjKdfYw1jopJZUwbNHi0",
  d: "Q3OuegVZmAJAld0FapqpLygRSh68XtPROPEkqgI5tak",
}
const EDITOR_KEY = parsePrivateKeys(JSON.stringify([EXAMPLE_EDITOR_PRIVATE_JWK]), "example")[0]
const HOST_KEY = parsePrivateKeys(JSON.stringify([EXAMPLE_HOST_PRIVATE_JWK]), "example")[0]
const SIGNING_CASES = [
  { method: "GET", path_with_query: "/api/integrations/course-editor/v1/manifest", body: "", timestamp: 1_800_000_000 },
  {
    method: "PUT",
    path_with_query: "/api/integrations/course-editor/v1/courses/7f72e600-3425-490c-b530-0179826cb206",
    body: '{"protocol":"2.0"}',
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
  const sign = (context: "course-editor-request" | "course-editor-event", key: typeof EDITOR_KEY) =>
    SIGNING_CASES.map((c) => {
      const request = { method: c.method, pathWithQuery: c.path_with_query, body: c.body }
      return {
        ...c,
        context,
        string_to_sign: stringToSign(request, c.timestamp, context),
        headers: signRequest(request, key, context, c.timestamp),
      }
    })
  return {
    description:
      "Test vectors for X-Signature (Ed25519). See contract/README.md § Authentication. Example keys only: never configure them.",
    editor: { private_jwk: EXAMPLE_EDITOR_PRIVATE_JWK, jwks: toJwks([EDITOR_KEY]) },
    host: { private_jwk: EXAMPLE_HOST_PRIVATE_JWK, jwks: toJwks([HOST_KEY]) },
    requests: sign("course-editor-request", EDITOR_KEY),
    events: sign("course-editor-event", HOST_KEY).slice(1, 2),
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
      organization: null,
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
        placement: [
          {
            id: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
            question: "Which of these makes a prompt clearer?",
            options: ["Saying what the answer is for", "Making it shorter", "Using capital letters"],
            correct_index: 0,
            difficulty: "easy",
            explanation: "Context about the goal lets the model choose what matters.",
          },
        ],
      },
      { key: "intermediate", title: "Intermediate", modules: [], placement: [] },
      { key: "advanced", title: "Advanced", modules: [], placement: [] },
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
      role: "admin",
      orgs: [
        { id: "8b7e6c5d-4f3a-4b2c-9d1e-0f1a2b3c4d5e", name: "Acme Learning", role: "admin" },
        { id: "1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5", name: "Beta Academy", role: "creator" },
      ],
      staff: false,
      iat: now,
      exp: now + 60,
      jti: "7d1f0e5a-2c4b-4e8f-9a3d-6b5c4d3e2f1a",
    },
    HOST_KEY,
    now,
  )
  const [, payload, signature] = token.split(".")
  return {
    description:
      "A launch token (signed by the host's example key) and its parts. See contract/README.md § Launch. Valid at verify_at; expired 60 s later.",
    host_jwks: toJwks([HOST_KEY]),
    signing_context: "course-editor-launch.v2.",
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
