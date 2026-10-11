import { Command } from "../types.js";
import { commands as setup } from "./setup.js";
import { commands as reason } from "./reason.js";
import { commands as panel } from "./panel.js";
import { commands as ping } from "./ping.js";
import { commands as ticket } from "./ticket.js";
import { commands as moderation } from "./moderation.js";
import { commands as lockdown } from "./lockdown.js";
import { commands as sticky } from "./sticky.js";
import { commands as automod } from "./automod.js";

/** Satu-satunya daftar command — dipakai oleh bot (index.ts) dan deploy.ts. */
export const commands: Command[] = [
  ...setup,
  ...reason,
  ...panel,
  ...ping,
  ...ticket,
  ...moderation,
  ...lockdown,
  ...sticky,
  ...automod,
];
