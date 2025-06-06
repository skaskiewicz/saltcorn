import Table from "../models/table";
import Field from "../models/field";
import FieldRepeat from "../models/fieldrepeat";
import Form from "../models/form";
import markup from "@saltcorn/markup/index";
const { renderForm } = markup;
import { assertIsErrorsMsg } from "./assertions";
import { describe, it, expect } from "@jest/globals";

const { getState } = require("../db/state");
getState().registerPlugin("base", require("../base-plugin"));

const mkRepForm = () =>
  new Form({
    action: "/",
    fields: [
      new Field({
        name: "subject",
        label: "Subject",
        type: "String",
      }),
      new FieldRepeat({
        name: "students",
        fields: [
          new Field({
            name: "name",
            label: "Name",
            type: "String",
          }),
          new Field({
            name: "age",
            label: "Age",
            type: "Integer",
            attributes: { min: 16 },
          }),
        ],
      }),
    ],
  });

describe("Form", () => {
  it("should render", async () => {
    const form = new Form({
      action: "/",
      fields: [
        new Field({
          name: "age",
          label: "Age",
          type: "Integer",
          attributes: { min: 16 },
        }),
      ],
    });
    const html = renderForm(form, "");
    form.validate({ age: 32 });
    expect(html.includes("<form")).toBe(true);
    expect(html.includes('min="16"')).toBe(true);
    expect(form.values.age).toBe(32);
  });

  it("should render with repeats", async () => {
    const form = mkRepForm();
    const html = renderForm(form, "");
    form.validate({
      subject: "Maths",
      age_0: 18,
      name_0: "Fred",
      age_1: 19,
      name_1: "George",
    });
    expect(html.includes("<form")).toBe(true);
    expect(html.includes('name="age_0"')).toBe(true);
    expect(form.values.subject).toBe("Maths");
    expect(form.values.students.length).toBe(2);
    expect(form.values.students[0].name).toBe("Fred");
    expect(form.values.students[1].age).toBe(19);
  });
  it("should render with repeats and values", async () => {
    const form = mkRepForm();

    form.values = {
      subject: "Maths",
      students: [
        { name: "Fred", age: 18 },
        { name: "George", age: 19 },
      ],
    };
    const html = renderForm(form, "");
    expect(html.includes("<form")).toBe(true);
    expect(html.includes('name="age_0"')).toBe(true);
    expect(html.includes('name="name_1"')).toBe(true);
    expect(html.includes("Fred")).toBe(true);
    expect(html.includes("George")).toBe(true);
  });
  it("should run form validator", async () => {
    const form = new Form({
      action: "/",
      validator({ age }) {
        if (age < 18) return "Should be older than 18";
      },
      fields: [
        new Field({
          name: "age",
          label: "Age",
          type: "Integer",
          attributes: { min: 16 },
        }),
      ],
    });
    const vres = form.validate({ age: 15 });
    assertIsErrorsMsg(vres);
    expect(vres.errors).toEqual({ age: "Must be 16 or higher" });

    const vres1 = form.validate({ age: 17 });
    assertIsErrorsMsg(vres1);
    expect(vres1.errors).toEqual({ _form: "Should be older than 18" });
  });
});

describe("Bool Form", () => {
  const form = new Form({
    action: "/",
    fields: [
      new Field({
        name: "done",
        label: "Done",
        type: "Bool",
      }),
    ],
  });
  form.validate({ done: "off" });
  expect(form.values.done).toBe(false);
  form.validate({});
  expect(form.values.done).toBe(false);
  form.validate({ done: "on" });
  expect(form.values.done).toBe(true);
});

describe("parent field", () => {
  const form = new Form({
    action: "/",
    fields: [
      new Field({
        name: "age",
        label: "Age",
        parent_field: "person",
        type: "Integer",
      }),
    ],
  });
  const html = renderForm(form, "");
  expect(html.includes("<form")).toBe(true);
  expect(html.includes('name="person_age"')).toBe(true);
  form.validate({ person_age: 16 });
  expect(form.values.age).toBe(undefined);
  expect(!!form.values.person).toBe(true);
  expect(form.values.person.age).toBe(16);
});

describe("String form with validator failure ", () => {
  const form = new Form({
    action: "/",
    fields: [
      new Field({
        name: "name",
        label: "Name",
        type: "String",
        validator(s) {
          if (s?.length < 3) return "Too short";
        },
      }),
    ],
  });
  const html = renderForm(form, "");
  expect(html.includes("<form")).toBe(true);
  form.validate({ name: "Si" });
  expect(form.errors).toStrictEqual({ name: "Too short" });
  expect(form.values).toStrictEqual({ name: "Si" });
  expect(form.hasErrors).toBe(true);
});

describe("String form with validator success", () => {
  const form = new Form({
    action: "/",
    fields: [
      new Field({
        name: "name",
        label: "Name",
        type: "String",
        validator(s) {
          if (s?.length < 3) return "Too short";
        },
      }),
    ],
  });
  const html = renderForm(form, "");
  expect(html.includes("<form")).toBe(true);

  form.validate({ name: "Simon" });
  expect(form.values.name).toBe("Simon");
  expect(form.errors).toStrictEqual({});
  expect(form.hasErrors).toBe(false);
});
