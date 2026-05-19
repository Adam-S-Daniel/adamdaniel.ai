// @lane: local — pure-fs lint of workflow YAML; no browser, no network
/*
 * Regression guard for #1101. The three real-prod-mutating loop
 * workflows must (a) share ONE concurrency lane so they can never run
 * concurrently (a parallel pair races deploy-production and blows each
 * other's URL-reflect budgets — observed on merge 3dbade7), and (b)
 * gate on the await-prod-deploy composite action so a post-merge push
 * never drives a stale (not-yet-deployed) prod site. Same ethos as
 * #1053's ALWAYS_RUN guard: make the invariant fail loud at CI time
 * instead of silently regressing in a workflow edit months later.
 */
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { test, expect } = require("./base");
const { readWorkflow, topBlock } = require("./workflow-yaml-utils");

const REPO_ROOT = path.resolve(__dirname, "..");

const LOOP_WORKFLOWS = [
  "cms-publish-loop-prod.yml",
  "cms-media-roundtrip.yml",
  "cms-publish-loop-host.yml",
];
const SHARED_GROUP = "prod-mutating-loop";
const AWAIT_ACTION = "./.github/actions/await-prod-deploy";

test.describe("real-prod loop workflows are serialized + deploy-gated (#1101)", () => {
  test("all three share ONE concurrency group, cancel-in-progress:false", () => {
    for (const wf of LOOP_WORKFLOWS) {
      const doc = yaml.load(readWorkflow(wf));
      expect(doc.concurrency, `${wf} must declare concurrency`).toBeTruthy();
      expect(
        doc.concurrency.group,
        `${wf} concurrency.group must be the shared lane so the three real-prod loops are mutually exclusive (#1101)`,
      ).toBe(SHARED_GROUP);
      expect(
        doc.concurrency["cancel-in-progress"],
        `${wf} must NOT cancel-in-progress — a real-prod loop killed mid-flow can leave the canary dirty; queue instead (#1101)`,
      ).toBe(false);
    }
  });

  test("the concurrency block is byte-identical across the three (drift guard)", () => {
    const blocks = LOOP_WORKFLOWS.map((wf) =>
      topBlock(readWorkflow(wf), "concurrency").trim(),
    );
    expect(
      blocks[1],
      "cms-media-roundtrip.yml concurrency block drifted from cms-publish-loop-prod.yml — keep them byte-identical (#1101)",
    ).toBe(blocks[0]);
    expect(
      blocks[2],
      "cms-publish-loop-host.yml concurrency block drifted from cms-publish-loop-prod.yml — keep them byte-identical (#1101)",
    ).toBe(blocks[0]);
  });

  test("each loop job awaits the prod deploy on push, gated to push events", () => {
    for (const wf of LOOP_WORKFLOWS) {
      const doc = yaml.load(readWorkflow(wf));
      // `actions: read` is required for the gate's REST query of the
      // Deploy to Production run.
      expect(
        doc.permissions && doc.permissions.actions,
        `${wf} must grant 'actions: read' for the await-prod-deploy gate`,
      ).toBe("read");
      const jobs = Object.values(doc.jobs);
      expect(jobs.length, `${wf} should have exactly one job`).toBe(1);
      const steps = jobs[0].steps || [];
      const gate = steps.find((s) => s && s.uses === AWAIT_ACTION);
      expect(
        gate,
        `${wf}'s loop job must invoke ${AWAIT_ACTION} so it never tests a not-yet-deployed prod (#1101)`,
      ).toBeTruthy();
      expect(
        String(gate.if || ""),
        `${wf}'s await-prod-deploy step must be gated to push events (workflow_dispatch/schedule have no associated merge)`,
      ).toContain("github.event_name == 'push'");
      // Must run before the spec actually drives prod: assert the gate
      // precedes the step that invokes the playwright loop spec.
      const gateIdx = steps.indexOf(gate);
      const specIdx = steps.findIndex((s) =>
        JSON.stringify(s || {}).match(
          /playwright test|RUN_PROD_MUTATE|RUN_HOST_REPO/i,
        ),
      );
      if (specIdx !== -1) {
        expect(
          gateIdx,
          `${wf}: await-prod-deploy must run BEFORE the loop spec step`,
        ).toBeLessThan(specIdx);
      }
    }
  });

  test("the await-prod-deploy composite action exists and is composite", () => {
    const actionPath = path.join(
      REPO_ROOT,
      ".github",
      "actions",
      "await-prod-deploy",
      "action.yml",
    );
    expect(
      fs.existsSync(actionPath),
      `${actionPath} must exist (referenced by the loop workflows)`,
    ).toBe(true);
    const action = yaml.load(fs.readFileSync(actionPath, "utf8"));
    expect(action.runs && action.runs.using).toBe("composite");
  });
});
