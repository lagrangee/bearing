import { describe, expect, test } from "bun:test";
import { validateMattSkillsV1Contract } from "../src/providers/matt-skills-v1";

describe("matt-skills/v1 provider contract validator", () => {
  test("accepts the two provider-owned G1 tracker contract shapes", () => {
    expect(
      validateMattSkillsV1Contract(
        "# Issue tracker: Local Markdown\n\nProvider contract: `matt-skills/v1`\n",
      ),
    ).toEqual({ state: "supported", driver: "local-markdown" });
    expect(
      validateMattSkillsV1Contract(
        "# Issue tracker: GitHub Issues\n\nProvider contract: `matt-skills/v1`\n",
      ),
    ).toEqual({ state: "supported", driver: "github-issues" });
  });

  test("rejects a marker decoy or an unrecognized provider-owned driver", () => {
    expect(
      validateMattSkillsV1Contract("# Example\n\nProvider contract: `matt-skills/v1`\n"),
    ).toEqual({ state: "unsupported" });
    expect(
      validateMattSkillsV1Contract(
        "# Issue tracker: Linear\n\nProvider contract: `matt-skills/v1`\n",
      ),
    ).toEqual({ state: "unsupported" });
  });
});
