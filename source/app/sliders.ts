// Adjustable circuit sliders share one configuration path for Properties and the console.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { adjustablePosition, editInfos, getEditInfo, type CircuitElm } from "../engine";
import { parseSI } from "./format";
import { type SimulationModel, type Slider, unitForEditName } from "./model";
import { presentField } from "./properties";

export interface SliderField { index: number; name: string; unit: string; value: number; positive: boolean; nonNegative: boolean; }

export function sliderFields(part: CircuitElm): SliderField[] {
  return editInfos(part).filter(([, info]) => info.kind === "number").map(([index, info]) => {
    const field = presentField(part, info, unitForEditName);
    return { index, name: field.label, unit: field.unit, value: info.value, positive: !!info.positive, nonNegative: !!info.nonNegative };
  });
}

export function sliderFor(model: SimulationModel, part: CircuitElm, index: number): Slider | undefined {
  return model.sliders.find((slider) => slider.elm === part && slider.adj.editItem === index);
}

export function sliderFieldNamed(part: CircuitElm, name: string): SliderField {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const fields = sliderFields(part);
  const field = fields.find((candidate) => normalize(candidate.name) === normalize(name));
  if (!field) throw new Error(`Slider property not found. Available: ${fields.map((candidate) => candidate.name).join(", ") || "none"}.`);
  return field;
}

export function sliderNumbers(field: SliderField, words: string[]): [number, number, number, number] {
  if (words.length !== 4) throw new Error("Enter minimum, maximum, value and step.");
  const values = words.map((word) => parseSI(word, field.unit));
  const [min, max, value, step] = values;
  if (values.some((number) => !Number.isFinite(number)) || !(max > min) || step < 0 || value < min || value > max)
    throw new Error("Use finite numbers with minimum < maximum, value inside that range, and step ≥ 0 (0 is continuous).");
  if ((field.positive && min <= 0) || (field.nonNegative && min < 0))
    throw new Error(`${field.name}: the minimum is outside this property's allowed range.`);
  if (step > max - min) throw new Error("Step cannot exceed the slider's range.");
  if (step > 0 && Math.abs((max - min) / step - Math.round((max - min) / step)) > 1e-8)
    throw new Error("The step must divide the minimum-to-maximum range evenly.");
  if (step > 0 && Math.abs((value - min) / step - Math.round((value - min) / step)) > 1e-8)
    throw new Error("The current value must fall on a step from the minimum.");
  return [min, max, value, step];
}

export function configureSlider(model: SimulationModel, part: CircuitElm, field: SliderField, min: number, max: number, value: number, step: number): Slider {
  // Recheck current editability before mutating: another property may have changed the edit items.
  const current = sliderFields(part).find((candidate) => candidate.index === field.index && candidate.name === field.name);
  if (!current) throw new Error("That property is no longer adjustable.");
  sliderNumbers(current, [String(min), String(max), String(value), String(step)]);
  const existing = sliderFor(model, part, field.index);
  const adj = existing?.adj ?? {
    elementIndex: model.circuit.elements.indexOf(part), editItem: field.index,
    minValue: min, maxValue: max, label: `${field.name} (${model.designator(part) ?? model.kindName(part)})`,
    logarithmic: false, step, sharedWith: null,
  };
  adj.minValue = min;
  adj.maxValue = max;
  adj.step = step;
  const slider = existing ?? { adj, elm: part, position: 0, followers: [] };
  if (!existing) model.sliders.push(slider);
  model.setSlider(slider, Math.max(0, Math.min(100, adjustablePosition(adj, value))));
  const back = getEditInfo(part, field.index);
  if (back && Math.abs(back.value - value) > Math.abs(value) * 1e-9 + 1e-15)
    throw new Error(`${field.name}: this part did not accept ${value}.`);
  return slider;
}

export function removeSlider(model: SimulationModel, part: CircuitElm, field: SliderField): void {
  const slider = sliderFor(model, part, field.index);
  if (!slider) throw new Error(`${field.name}: no slider configured.`);
  if (slider.followers.length) throw new Error("This slider controls linked parts and cannot be removed here.");
  model.sliders.splice(model.sliders.indexOf(slider), 1);
}
