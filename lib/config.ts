import os from "node:os";
import path from "node:path";

export const dataDir = () => process.env.TINY_SOHO_DATA_DIR || path.join(os.homedir(), "Library", "Application Support", "Tiny Soho Studio");
export const assetsDir = () => path.join(dataDir(), "assets");
export const exportsDir = () => path.join(dataDir(), "exports");
export const databasePath = () => path.join(dataDir(), "studio.sqlite");
export const configPresent = () => Boolean(process.env.DASHSCOPE_API_KEY && process.env.ALIBABA_WORKSPACE_ID);
export const workspaceBaseUrl = () => `https://${process.env.ALIBABA_WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com/api/v1`;
