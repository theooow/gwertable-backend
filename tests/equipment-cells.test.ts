import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { equipmentCellSchema } from "../src/schemas/equipment.js";

describe("equipment cell validation", () => {
  it("preserves only submitted cells without applying catalog defaults", () => {
    assert.deepEqual(equipmentCellSchema.parse({ color: "#123abc" }), { color: "#123abc" });
    assert.deepEqual(equipmentCellSchema.parse({ color: null }), { color: null });
    assert.deepEqual(equipmentCellSchema.parse({ quantity: 12 }), { quantity: 12 });
    assert.deepEqual(equipmentCellSchema.parse({ rentalCoef: 0 }), { rentalCoef: 0 });
  });

  it("rejects empty edits, protected fields and invalid cell values", () => {
    for (const input of [{}, { workspaceId: "other" }, { photoUrl: "url" }, { name: "" },
      { color: "red" }, { quantity: 0 }, { quantity: 1.5 }, { unitPriceCents: -1 },
      { ownership: "OTHER" }, { vatRateBasisPoints: 10001 }]) {
      assert.equal(equipmentCellSchema.safeParse(input).success, false, JSON.stringify(input));
    }
  });
});
