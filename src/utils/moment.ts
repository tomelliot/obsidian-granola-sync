import { moment as obsidianMoment } from "obsidian";
// eslint-disable-next-line no-restricted-imports -- type-only import; the runtime value comes from obsidian
import type mFn from "moment";

// Obsidian re-exports moment as `typeof import('moment')`, which TS treats as
// a namespace without call signatures. Cast back to the callable function type.
export const moment = obsidianMoment as unknown as typeof mFn;
