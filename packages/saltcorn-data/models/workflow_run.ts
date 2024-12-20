/**
 * Workflow step Database Access Layer
 * @category saltcorn-data
 * @module models/workflow_run
 * @subcategory models
 */
import db from "../db";
import type { Where, SelectOptions, Row } from "@saltcorn/db-common/internal";
import type { WorkflowRunCfg } from "@saltcorn/types/model-abstracts/abstract_workflow_run";
import WorkflowStep from "./workflow_step";
import User from "./user";
import Expression from "./expression";
import Notification from "./notification";
import utils from "../utils";
import moment from "moment";
const { ensure_final_slash } = utils;
const { eval_expression } = Expression;
const { getState } = require("../db/state");

const allReturnDirectives = [
  "popup",
  "goto",
  "eval_js",
  "download",
  "set_fields",
  "notify",
  "notify_success",
  "error",
];

/**
 * WorkflowRun Class
 * @category saltcorn-data
 */
class WorkflowRun {
  id?: number;
  trigger_id: number;
  context: any;
  wait_info?: any;
  started_at: Date;
  started_by?: number;
  error?: string;
  status: "Pending" | "Running" | "Finished" | "Waiting" | "Error";
  current_step?: string;
  steps?: Array<WorkflowStep>;

  /**
   * WorkflowRun constructor
   * @param {object} o
   */
  constructor(o: WorkflowRunCfg | WorkflowRun) {
    this.id = o.id;
    this.trigger_id = o.trigger_id;
    this.context =
      typeof o.context === "string" ? JSON.parse(o.context) : o.context || {};
    this.wait_info =
      typeof o.wait_info === "string" ? JSON.parse(o.wait_info) : o.wait_info;
    this.started_at = o.started_at || new Date();
    this.started_by = o.started_by;
    this.error = o.error;
    this.status = o.status || "Pending";
    this.current_step = o.current_step;
  }

  /**
   * @param {object} lib_in
   */
  static async create(run_in: WorkflowRunCfg): Promise<WorkflowRun> {
    const run = new WorkflowRun(run_in);
    const id = await db.insert("_sc_workflow_runs", run.toJson);
    run.id = id;
    return run;
  }

  /**
   * @type {...*}
   */
  get toJson(): any {
    const { id, steps, ...rest } = this;
    return rest;
  }

  /**
   * @param {*} where
   * @param {*} selectopts
   * @returns {WorkflowRun[]}
   */
  static async find(
    where: Where,
    selectopts?: SelectOptions
  ): Promise<WorkflowRun[]> {
    const us = await db.select("_sc_workflow_runs", where, selectopts);
    return us.map((u: any) => new WorkflowRun(u));
  }

  /**
   * @param {*} where
   * @returns {WorkflowRun}
   */
  static async findOne(where: Where): Promise<WorkflowRun> {
    const u = await db.selectMaybeOne("_sc_workflow_runs", where);
    return u ? new WorkflowRun(u) : u;
  }

  /**
   * @param {*} what
   * @returns {object}
   */
  /**
   * @returns {Promise<void>}
   */
  async delete(): Promise<void> {
    const schema = db.getTenantSchemaPrefix();
    await db.query(`delete FROM ${schema}_sc_workflow_runs WHERE id = $1`, [
      this.id,
    ]);
  }

  /**
   * @param {*} row
   * @returns {Promise<void>}
   */
  async update(row: Row): Promise<void> {
    await db.update("_sc_workflow_runs", row, this.id);
    Object.assign(this, row);
  }

  async provide_form_input(form_values: any) {
    //write values
    Object.assign(this.context, form_values);

    this.wait_info.form = false;
    await this.update({ wait_info: this.wait_info, context: this.context });
  }

  get_next_step(step: WorkflowStep, user?: User): WorkflowStep | null {
    let nextStep;
    if (!step?.next_step) {
      return null;
    } else if (
      (nextStep = this.steps!.find((s) => s.name === step.next_step))
    ) {
      return nextStep;
    } else {
      // eval next_step
      const next_step_ctx = { ...this.context };
      this.steps!.forEach((s) => {
        next_step_ctx[s.name] = s.name;
      });
      const next_step_name = eval_expression(
        step.next_step,
        next_step_ctx,
        user,
        `next_step in step ${step.name}`
      );
      return this.steps!.find((s) => s.name === next_step_name) || null;
    }
  }

  user_allowed_to_fill_form(user: User) {
    if (this.wait_info.form.user_id) {
      if (this.wait_info.form.user_id != user?.id) return false;
    }
    return true;
  }

  //get worklows that can be resumed by scheduler
  static async getResumableWorkflows() {
    const state = getState();
    if (!state.waitingWorkflows) return [];

    const waiting_runs = await WorkflowRun.find({ status: "Waiting" });

    const until_runs = waiting_runs.filter((r) => !r.wait_info.form);

    if (!until_runs.length) {
      state.waitingWorkflows = false;
      return [];
    }
    const now = new Date();
    return until_runs.filter(
      (r) => !r.wait_info.until_time || new Date(r.wait_info.until_time) < now
    );
  }

  //call from scheduler
  static async runResumableWorkflows() {
    const runs = await this.getResumableWorkflows();
    for (const run of runs) {
      await run.run({});
    }
  }

  async run({ user }: { user?: User }) {
    if (this.status === "Error" || this.status === "Finished") return;
    //get steps
    const steps = await WorkflowStep.find({ trigger_id: this.trigger_id });
    this.steps = steps;

    const state = getState();

    if (this.status === "Waiting") {
      //are wait conditions fulfilled?
      //TODO
      let fulfilled = true;
      Object.entries(this.wait_info || {}).forEach(([k, v]) => {
        switch (k) {
          case "until_time":
            if (new Date(v as Date | string) > new Date()) fulfilled = false;
            break;
          case "form":
            if (v) fulfilled = false;
          default:
            break;
        }
      });
      if (!fulfilled) return;
      else {
        const step = steps.find((step) => step.name === this.current_step);
        const nextStep = this.get_next_step(step!, user);

        await this.update({
          wait_info: {},
          status: nextStep ? "Running" : "Finished",
          current_step: nextStep?.name,
        });
        if (!nextStep) return;
      }
    }

    //find current step
    let step: any;
    if (this.current_step)
      step = steps.find((step) => step.name === this.current_step);
    else step = steps.find((step) => step.initial_step);

    if (step && this.status !== "Running")
      await this.update({ status: "Running" });
    //run in loop
    while (step) {
      if (step.name !== this.current_step)
        await this.update({ current_step: step.name });

      state.log(6, `Workflow run ${this.id} Running step ${step.name}`);

      if (step.action_name === "UserForm") {
        let user_id;
        if (step.configuration.user_id_expression) {
          user_id = eval_expression(
            step.configuration.user_id_expression,
            this.context,
            user,
            `User id expression in step ${step.name}`
          );
        } else user_id = user?.id;
        if (user_id) {
          //TODO send notification
          const base_url = state.getConfig("base_url", "");
          await Notification.create({
            title: "Your input is required",
            link: `${ensure_final_slash(base_url)}actions/fill-workflow-form/${
              this.id
            }`,
            user_id,
          });
        }
        await this.update({
          status: "Waiting",
          wait_info: { form: { user_id: user_id } },
        });
        step = null;
        break;
      }

      if (step.action_name === "WaitNextTick") {
        await this.update({
          status: "Waiting",
          wait_info: {},
        });
        state.waitingWorkflows = true;
        break;
      }
      if (step.action_name === "WaitUntil") {
        const resume_at = eval_expression(
          step.configuration.resume_at,
          { moment, ...this.context },
          user,
          `Resume at expression in step ${step.name}`
        );
        state.waitingWorkflows = true;

        await this.update({
          status: "Waiting",
          wait_info: { until_time: new Date(resume_at).toISOString() },
        });

        break;
      }

      const result = await step.run(this.context, user);

      const nextUpdate: any = {};
      if (typeof result === "object" && result !== null) {
        Object.assign(this.context, result);
        nextUpdate.context = this.context;
      }
      //find next step
      const nextStep = this.get_next_step(step, user);
      if (!nextStep) {
        step = null;
        nextUpdate.status = "Finished";
      } else {
        step = nextStep;
        nextUpdate.current_step = step.name;
      }
      await this.update(nextUpdate);
    }
  }

  async popReturnDirectives() {
    const retVals: any = Object.create(null);
    allReturnDirectives.forEach((k) => {
      if (typeof this.context[k] !== "undefined") {
        retVals[k] = this.context[k];
        delete this.context[k];
      }
    });
    if (Object.keys(retVals).length)
      await this.update({ context: this.context });

    return retVals;
  }
}

export = WorkflowRun;
