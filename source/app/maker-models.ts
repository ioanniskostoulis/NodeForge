// Manufacturers' SPICE models: where to get them, not the models themselves (their terms don't let
// NodeForge redistribute them). The Model library lists these; a direct text file is imported from
// its link as any link is (and checked against ngspice in the desktop app), a page is opened in the
// browser. Each link and what's said of it was checked on 2026-10-10.

import type { ModelKind } from "./model-catalog";

export interface MakerModel {
  /** The part, as the maker names it. */
  part: string;
  maker: string;
  /** What it is (none: several kinds). */
  kind?: ModelKind;
  /** A plain-text SPICE file that can be imported from its link, or none (a page to open). */
  file?: string;
  /** The maker's page for it (design tools, model finder). */
  page: string;
  /** The maker's terms, as the page states them. */
  terms: string;
  /** What was checked, and how it came out. */
  checked?: string;
}

const VISHAY_TERMS = "Vishay: free of charge for your use, remains Vishay's property (design tools disclaimer)";

export const MAKER_MODELS: MakerModel[] = [
  {
    part: "UF4007", maker: "Vishay", kind: "diode",
    file: "https://www.vishay.com/docs/88184/uf4007.txt", page: "https://www.vishay.com/en/product/88755/tab/designtools-ppg/",
    terms: VISHAY_TERMS,
    checked: "Matches ngspice within 0.000%. VF at 1 A 1.44 V (datasheet max 1.7 V), CJ at 4 V 16.3 pF (typical 17 pF)",
  },
  {
    part: "UF4002", maker: "Vishay", kind: "diode",
    file: "https://www.vishay.com/docs/88183/uf4002.txt", page: "https://www.vishay.com/en/product/88755/tab/designtools-ppg/",
    terms: VISHAY_TERMS,
    checked: "Matches ngspice within 0.000%. VF at 1 A 0.87 V (datasheet max 1.0 V)",
  },
  {
    part: "1N4007", maker: "Vishay", kind: "diode",
    file: "https://www.vishay.com/docs/88000/1n4007.txt", page: "https://www.vishay.com/en/product/88503/tab/designtools-ppg/",
    terms: VISHAY_TERMS,
    checked: "Matches ngspice within 0.000%. VF at 1 A 0.88 V (datasheet max 1.1 V), CJ at 4 V 14.0 pF (typical 15 pF)",
  },
  {
    part: "1N4004", maker: "Vishay", kind: "diode",
    file: "https://www.vishay.com/docs/98980/p_1n4004.txt", page: "https://www.vishay.com/en/product/88503/tab/designtools-ppg/",
    terms: VISHAY_TERMS,
    checked: "Matches ngspice within 0.000%. VF at 1 A 0.88 V (datasheet max 1.1 V). Its T_MEASURED (PSpice's TNOM) isn't simulated",
  },
  {
    part: "MURS160", maker: "Vishay", kind: "diode",
    file: "https://www.vishay.com/docs/89916/murs160.txt", page: "https://www.vishay.com/docs/89916/murs160.txt",
    terms: `${VISHAY_TERMS}; the file is © Thomatronik GmbH`,
    checked: "Matches ngspice within 0.000%. VF at 1 A 0.98 V",
  },
  {
    part: "IRFP250, IRFP250N", maker: "Vishay", kind: "nmos",
    page: "https://www.vishay.com/en/product/91212/tab/designtools-ppg/",
    terms: `${VISHAY_TERMS}; the .lib downloads after accepting it on the page`,
  },
  {
    part: "IRF540 (SiHF540)", maker: "Vishay", kind: "nmos",
    page: "https://www.vishay.com/en/product/91021/tab/designtools-ppg/",
    terms: `${VISHAY_TERMS}; the .lib downloads after accepting it on the page`,
  },
  {
    part: "IRF840 (SiHF840)", maker: "Vishay", kind: "nmos",
    page: "https://www.vishay.com/en/product/91070/tab/designtools-ppg/",
    terms: `${VISHAY_TERMS}; the .lib downloads after accepting it on the page`,
  },
  {
    part: "Power MOSFETs (IRFP260N, IRFZ44N, IRF3205, OptiMOS…)", maker: "Infineon", kind: "nmos",
    page: "https://www.infineon.com/design-resources/simulation-modeling/power-mosfet-simulation-models",
    terms: "Infineon: PSpice .lib libraries in zip files, free to use; the terms are on Infineon's site",
  },
  {
    part: "Discretes (2N7000, BS170, 1N47xx zeners, MUR160…)", maker: "onsemi",
    page: "https://www.onsemi.com/design/technical-documentation/simulation-spice-models",
    terms: "onsemi: models found through its document search; the terms are on onsemi's site",
  },
];
