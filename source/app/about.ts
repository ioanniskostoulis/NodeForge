// Licensed under the GNU General Public License v2 or later. See LICENSE.
// The Help dialogs are the shell's (`forge-shell/app/about`); NodeForge supplies its credits, the works it includes
// beyond the shared ones, and the ngspice licence text.

import { link, named, SHARED_WORKS, showAbout as sharedAbout, showLicenses as sharedLicenses, type IncludedWork, type InfoOptions } from "forge-shell/app/about";

/** About + acknowledgements. Keep inherited work and NodeForge's additions distinct. */
const CREDITS: [string, string, string][] = [
  ["Paul Falstad", "original circuit simulator and its component foundations", "https://www.falstad.com/circuit/"],
  ["Iain Sharp", "adapted the simulator for the browser as CircuitJS1", "https://github.com/sharpie7/circuitjs1"],
  ["Rodrigo Hausen", "file import/export and many interface improvements to CircuitJS1", "https://github.com/sharpie7/circuitjs1"],
  ["CircuitJS1 contributors", "components, fixes, examples and translations", "https://github.com/sharpie7/circuitjs1"],
  ["ngspice contributors", "device-model work adapted for the NodeForge engine; accuracy reference", "https://ngspice.sourceforge.io/"],
];

export function showAbout(info: InfoOptions): void {
  const credits = CREDITS.map(([name, what, url], i) => named(i + 1, link(name, url), what)).join("");
  sharedAbout(info, `
        <div class="block">
          <div class="about-heading">Built on earlier work</div>
          <p class="about-intro">NodeForge began as a TypeScript port of CircuitJS1. Its original simulator, much of its part behavior and its example circuit library are inherited from that project. This work made NodeForge possible.</p>
        </div>
        <div class="block">${credits}</div>
        <div class="block">
          <div class="about-heading">Developed further for NodeForge</div>
          <p class="about-intro">NodeForge is part of the Forge family of apps designed and directed by <strong>Ioannis Kostoulis</strong>. Its desktop and browser interface, command console and NodeForge engine add error-controlled simulation, SPICE device models and circuit analysis alongside CircuitJS compatibility. Results are checked against ngspice.</p>
        </div>`);
}

/** What NodeForge includes from others: its own sources first, then the works every Forge app includes. */
const INCLUDED: IncludedWork[] = [
  ["CircuitJS1", "engine, file formats, part geometry and example circuits; GPL v2 or later", "https://github.com/sharpie7/circuitjs1"],
  ["ngspice", "device equations adapted for the NodeForge engine; Modified BSD, text below", "https://github.com/ngspice/ngspice"],
  ...SHARED_WORKS,
  ["GFS Artemisia", "the letter in the app icon (font not bundled)", "https://ctan.org/pkg/gfsartemisia"],
];

/** Licenses: NodeForge's own, what it includes from others, the GPL, then the ngspice terms (without their copyright header). */
export function showLicenses(info: InfoOptions): Promise<void> {
  return sharedLicenses(info, INCLUDED, [{ heading: "ngspice, Modified BSD license", url: "licenses/ngspice-modified-bsd.txt", skipParagraphs: 1 }]);
}
