import assert from "node:assert/strict";
import { it } from "node:test";
import { renderVolunteerEmail, type VolunteerEmailContent } from "../src/lib/volunteer-email.js";

const content: VolunteerEmailContent = {
  kind: "APPROVED", fullName: "Camille", eventName: "Festival", associationName: "Mon orga",
  logoUrl: null, portalUrl: "https://example.test/portal",
};

it("puts the organization first for every volunteer email, including registration without a link", () => {
  for (const kind of ["REGISTERED", "APPROVED", "PLANNING", "SHIFT_UPDATE"] as const) {
    const result = renderVolunteerEmail({ ...content, kind, primaryColor: "#7c3aed" });
    assert.ok(result.subject.startsWith("Mon orga · "));
    assert.ok(result.subject.endsWith(" · Festival"));
    assert.ok(result.html.includes("border-top:6px solid #7c3aed"));
    assert.equal(result.html.includes(content.portalUrl!), kind !== "REGISTERED");
  }
});

it("uses workspace colors with readable button text and safe defaults", () => {
  for (const [primaryColor, background, foreground] of [
    ["#7c3aed", "#7c3aed", "#ffffff"],
    ["#ffffff", "#ffffff", "#000000"],
    [null, "#0f766e", "#ffffff"],
    ['red;" onmouseover="alert(1)', "#0f766e", "#ffffff"],
  ]) {
    const { html } = renderVolunteerEmail({ ...content, primaryColor });
    assert.ok(html.includes(`bgcolor="${background}"`));
    assert.ok(html.includes(`padding:16px 24px;color:${foreground}`));
    assert.ok(!html.includes("onmouseover"));
    if (primaryColor === "#ffffff") assert.ok(html.includes("color:#172033;word-break"));
  }
});
