import { CliDeviceError } from "@/lib/cli-device-policy";

// Contest visibility (PUBLIC/PRIVATE) is unrelated to the deployment network.
// Public deployments fail closed unless an operator explicitly enables intranet CLI.
export function isCliEnabled() {
  return process.env.NOVAJUDGE_CLI_MODE === "intranet";
}

export function assertCliEnabled() {
  if (!isCliEnabled()) {
    throw new CliDeviceError("Command-line submission is only enabled on an intranet deployment.", 403, "CLI_DISABLED");
  }
}
