import assert from "node:assert/strict";
import { it } from "node:test";
import { suggestVolunteerAssignments } from "../src/services/volunteer-planning.service.js";

it("includes the JSON instruction in OpenAI input messages, not only instructions", async (t) => {
  const previousProvider = process.env.DOCUMENT_AI_PROVIDER;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.DOCUMENT_AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test";
  t.after(() => {
    if (previousProvider === undefined) delete process.env.DOCUMENT_AI_PROVIDER;
    else process.env.DOCUMENT_AI_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  const assignments = [{ shiftId: "shift-1", personId: "person-1" }];
  const input = [{ shiftId: "shift-1", candidates: [{ personId: "person-1" }] }];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    assert.equal(body.text.format.type, "json_object");
    assert.equal(body.store, false);
    assert.ok(body.input.includes(JSON.stringify(input)));
    // Responses rejects JSON mode when only the top-level instructions mention JSON.
    if (!/json/i.test(body.input)) return new Response("{}", { status: 400 });
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ assignments }) }] }] });
  });
  assert.deepEqual(await suggestVolunteerAssignments(input), assignments);
});
