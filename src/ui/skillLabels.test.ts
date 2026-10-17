import { describe, expect, it } from "vitest";
import type { Skill } from "../domain/types";
import { laterLabel, recommendLabel } from "./skillLabels";

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

  it("ほかの型の記録は数えず、その型自身の記録だけで決まる", () => {
    const onlyHeart = new Set(["heart"]);
    expect(recommendLabel(skills[1], onlyHeart)).toBe("まだ記録がありません");
    expect(recommendLabel(skills[0], onlyHeart)).toBe("最近の記録はありません");
  });
});

describe("laterLabel", () => {
  const byId = (list: Skill[]) => new Map(list.map((s) => [s.id, s]));
  const wingT = { ...skill("wing-tulip"), name: "ウィングチューリップ" };
  const wingH = { ...skill("wing-heart"), name: "ウィングハート" };
  const swan = skill("swan", ["wing-tulip", "wing-heart"]);

  it("前提が複数のときは、「か」でつなぐ（どれか1つでよい）", () => {
    expect(laterLabel(swan, byId([wingT, wingH, swan]))).toBe(
      "「ウィングチューリップ」か「ウィングハート」のあとがおすすめ",
    );
  });

  it("前提のどれかが達成済みなら、何も添えない", () => {
    const done = { ...wingH, status: "done" as const };
    expect(laterLabel(swan, byId([wingT, done, swan]))).toBe("");
  });

  it("前提が無ければ、何も添えない", () => {
    expect(laterLabel(skill("heart"), byId([]))).toBe("");
  });
});
