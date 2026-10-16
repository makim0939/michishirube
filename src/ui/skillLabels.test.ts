import { describe, expect, it } from "vitest";
import { indexById } from "../domain/logic";
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
  const byId = indexById(skills);
  const none = new Set<string>();

  it("前提の無い型は「最初の型」", () => {
    expect(recommendLabel(skills[0], byId, none, none)).toBe("最初の型");
  });

  it("前提を練習中なら、この型の記録の有無を伝える（「並行して」とは言わない）", () => {
    const practicing = new Set(["heart"]);
    expect(recommendLabel(skills[1], byId, practicing, none)).toBe(
      "まだ記録がありません",
    );
    expect(
      recommendLabel(skills[1], byId, practicing, new Set(["tulip"])),
    ).toBe("最近の記録はありません");
  });

  it("前提を達成していれば「〇〇のつぎ」", () => {
    const done = indexById([skill("heart", [], "done"), skills[1]]);
    expect(recommendLabel(skills[1], done, none, none)).toBe("「heart」のつぎ");
  });
});
