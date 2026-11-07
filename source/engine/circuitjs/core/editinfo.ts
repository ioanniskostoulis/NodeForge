// The editable properties of a part (CircuitJS1's EditInfo, by Paul Falstad).
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

/** One editable property. Indices match upstream: slider definitions in files refer to them. */
export interface EditInfo {
  kind: "number" | "check" | "choice" | "text" | "textarea" | "file";
  /** Field label (for a checkbox, its text). */
  name: string;
  value: number;
  /** Slider range suggested by upstream (0, 0 when unspecified). */
  min: number;
  max: number;
  dimensionless: boolean;
  positive: boolean;
  nonNegative: boolean;
  /** Use ±1 steps (not the E12 series) when stepping. */
  unitStep: boolean;
  noSliders: boolean;
  checked: boolean;
  choices: string[];
  selected: number;
  text: string;
}

/** A value entered for an EditInfo (only the field matching its kind is used). */
export interface EditInput {
  value: number;
  checked: boolean;
  selected: number;
  text: string;
}

const base = (kind: EditInfo["kind"], name: string): EditInfo => ({
  kind, name, value: 0, min: 0, max: 0, dimensionless: false, positive: false, nonNegative: false, unitStep: false, noSliders: false,
  checked: false, choices: [], selected: 0, text: "",
});

export interface NumOptions {
  dimensionless?: boolean;
  positive?: boolean;
  nonNegative?: boolean;
  unitStep?: boolean;
  noSliders?: boolean;
}

/** new EditInfo(name, value, min, max) with optional modifiers. */
export function num(name: string, value: number, min = 0, max = 0, o: NumOptions = {}): EditInfo {
  return { ...base("number", name), value, min, max, ...o };
}
/** EditInfo.createCheckbox(label, state) */
export function check(label: string, checked: boolean): EditInfo {
  return { ...base("check", label), min: -1, max: -1, checked };
}
export function choice(name: string, choices: string[], selected: number): EditInfo {
  return { ...base("choice", name), value: selected, min: -1, max: -1, choices, selected };
}
export function text(name: string, value: string): EditInfo {
  return { ...base("text", name), text: value, dimensionless: true, noSliders: true };
}
export function textarea(name: string, value: string): EditInfo {
  return { ...base("textarea", name), text: value, dimensionless: true, noSliders: true };
}

/** A file to load (data and audio inputs); the app reads it and hands the contents to the part. */
export function file(name: string, accept: string): EditInfo {
  return { ...base("file", name), text: accept, min: -1, max: -1, noSliders: true };
}

/** EditInfo.changeFlag: set or clear `bit` from a checkbox. */
export function changeFlag(flags: number, bit: number, on: boolean): number {
  return on ? flags | bit : flags & ~bit;
}

/** An input carrying just a number (sliders, numeric fields). */
export function numberInput(value: number): EditInput {
  return { value, checked: false, selected: 0, text: "" };
}
