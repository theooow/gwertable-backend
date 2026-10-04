import assert from "node:assert/strict";
import { it } from "node:test";
import { emailAccent, renderEmailHtml } from "../src/lib/email-layout.js";

it("renders a framed code, an action with fallback link and escapes content", () => {
  const html = renderEmailHtml({
    preheader: "Code", title: "<Connexion>", paragraphs: ["a & b"],
    code: { value: "123456", caption: "Valable 15 minutes" },
    action: { label: "Ouvrir", url: "https://example.test/?a=1&b=2" },
  });
  assert.ok(html.includes("&lt;Connexion&gt;"));
  assert.ok(html.includes("a &amp; b"));
  assert.ok(html.includes("123456</div>"));
  assert.ok(html.includes("border:1px solid #efd3df"));
  assert.equal(html.split("https://example.test/?a=1&amp;b=2").length - 1, 3);
  assert.ok(html.includes("abregi_typo_jazzberry.png"));
});

it("brands workspace emails and rejects unsafe accent colors", () => {
  const html = renderEmailHtml({ preheader: "", title: "T", paragraphs: [], sender: { name: "Mon orga", logoUrl: null }, accentColor: 'red;" onmouseover="x' });
  assert.ok(html.includes("<strong style=\"font-size:15px;color:#252b36\">Mon orga</strong>"));
  assert.ok(html.includes("Envoyé par Mon orga avec Abregi."));
  assert.ok(!html.includes("onmouseover"));
  assert.deepEqual(emailAccent(null), { accent: "#a51e58", onAccent: "#ffffff", link: "#a51e58" });
  assert.deepEqual(emailAccent("#ffffff"), { accent: "#ffffff", onAccent: "#000000", link: "#252b36" });
});
