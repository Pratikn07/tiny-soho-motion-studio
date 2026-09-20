import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findTrackedModelArtifacts, parseUpstreamProvenance } from "../lib/capabilities/provenance";

const repositoryRoot = path.resolve(__dirname, "..");
const provenancePath = path.join(repositoryRoot, "docs", "vision", "upstream-provenance.json");
const provenance = parseUpstreamProvenance(JSON.parse(readFileSync(provenancePath, "utf8")));
const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: repositoryRoot, encoding: "utf8" }).split("\0").filter(Boolean);
const modelArtifacts = findTrackedModelArtifacts(trackedFiles);

if (modelArtifacts.length > 0) {
  throw new Error(`Tracked model or checkpoint artifacts are not allowed: ${modelArtifacts.join(", ")}`);
}

console.log(`Validated ${provenance.dependencies.length} upstream provenance entries; no model or checkpoint artifacts are tracked.`);
