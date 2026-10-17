import { describe, expect, it } from "vitest";
import type { Skill } from "../domain/types";
import { recommendLabel } from "./skillLabels";

function skill(
  id: string,
  prereqIds: string[] = [],
  status: Skill["status"] = "idle",
): Skill {
  return {
    id,
    domainId: "d",
    name: id,
    description: "",
    criteria: "",
    sources: [],
    references: [],
    prereqIds,
    status,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("recommendLabel", () => {
  const skills = [skill("heart"), skill("tulip", ["heart"])];

  it("前提の有無に関わらず、記録がなければ「まだ記録がありません」", () => {
    const none = new Set<string>();
    expect(recommendLabel(skills[0], none)).toBe("まだ記録がありません");
    expect(recommendLabel(skills[1], none)).toBe("まだ記録がありません");
  });

  it("前提の有無に関わらず、記録があれば「最近の記録はありません」", () => {
    const recorded = new Set(["heart", "tulip"]);
    expect(recommendLabel(skills[0], recorded)).toBe("最近の記録はありません");
    expect(recommendLabel(skills[1], recorded)).toBe("最近の記録はありません");
  });
});
