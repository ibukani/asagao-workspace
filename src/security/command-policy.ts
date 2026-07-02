import { z } from "zod";
import { allowDecision, denyDecision, type PolicyDecision } from "./decision.ts";

export const commandPolicyModes = ["deny_all", "allowlist"] as const;

export const commandExecutableSchema = z.string().min(1).max(256);

export const commandRuleSchema = z
  .object({
    executable: commandExecutableSchema,
    argsPrefix: z.array(z.string()).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

export const commandPolicySchema = z
  .object({
    mode: z.enum(commandPolicyModes),
    allowlist: z.array(commandRuleSchema),
    denylist: z.array(commandRuleSchema),
    timeoutMs: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
  })
  .strict();

export type CommandPolicyMode = z.infer<typeof commandPolicySchema>["mode"];
export type CommandRule = z.infer<typeof commandRuleSchema>;
export type CommandPolicy = z.infer<typeof commandPolicySchema>;

export const DEFAULT_COMMAND_DENYLIST = [
  { executable: "sh", reason: "shell execution is not allowed by default" },
  { executable: "bash", reason: "shell execution is not allowed by default" },
  { executable: "zsh", reason: "shell execution is not allowed by default" },
  { executable: "cmd", reason: "shell execution is not allowed by default" },
  { executable: "powershell", reason: "shell execution is not allowed by default" },
  { executable: "pwsh", reason: "shell execution is not allowed by default" },
  { executable: "sudo", reason: "privilege escalation is not allowed" },
  { executable: "su", reason: "privilege escalation is not allowed" },
  { executable: "ssh", reason: "remote shell access is not allowed by default" },
  { executable: "scp", reason: "remote copy access is not allowed by default" },
  { executable: "curl", reason: "direct network access is controlled by internet policy" },
  { executable: "wget", reason: "direct network access is controlled by internet policy" },
] satisfies CommandRule[];

export const DEFAULT_COMMAND_POLICY = commandPolicySchema.parse({
  mode: "deny_all",
  allowlist: [],
  denylist: DEFAULT_COMMAND_DENYLIST,
  timeoutMs: 120_000,
  maxOutputBytes: 1_000_000,
}) satisfies CommandPolicy;

export type EvaluateCommandPolicyInput = {
  policy: CommandPolicy;
  command: readonly string[];
};

export function createCommandPolicy(overrides: Partial<CommandPolicy> = {}): CommandPolicy {
  return commandPolicySchema.parse({
    ...DEFAULT_COMMAND_POLICY,
    ...overrides,
    allowlist: overrides.allowlist ?? DEFAULT_COMMAND_POLICY.allowlist,
    denylist: overrides.denylist ?? DEFAULT_COMMAND_POLICY.denylist,
  });
}

export function evaluateCommandPolicy({
  policy,
  command,
}: EvaluateCommandPolicyInput): PolicyDecision {
  if (command.length === 0) {
    return denyDecision("empty_command", "Command policy requires a non-empty argument array.");
  }

  const executable = command[0];
  if (executable === undefined || executable.length === 0) {
    return denyDecision("empty_command", "Command executable is missing.");
  }

  const deniedRule = findMatchingCommandRule(policy.denylist, command);
  if (deniedRule !== null) {
    return denyDecision(
      "command_denied",
      deniedRule.reason ?? `Command '${executable}' is denied by policy.`,
    );
  }

  if (policy.mode === "deny_all") {
    return denyDecision(
      "command_default_denied",
      "Command execution is denied by default until an allowlist policy is configured.",
    );
  }

  const allowedRule = findMatchingCommandRule(policy.allowlist, command);
  if (allowedRule === null) {
    return denyDecision(
      "command_not_allowlisted",
      `Command '${executable}' is not present in the workspace command allowlist.`,
    );
  }

  return allowDecision(`Command '${executable}' is allowed by workspace command policy.`);
}

export function findMatchingCommandRule(
  rules: readonly CommandRule[],
  command: readonly string[],
): CommandRule | null {
  for (const rule of rules) {
    if (commandRuleMatches(rule, command)) {
      return rule;
    }
  }

  return null;
}

export function commandRuleMatches(rule: CommandRule, command: readonly string[]): boolean {
  const [executable, ...args] = command;
  if (executable !== rule.executable) {
    return false;
  }

  if (rule.argsPrefix === undefined) {
    return true;
  }

  if (args.length < rule.argsPrefix.length) {
    return false;
  }

  return rule.argsPrefix.every((expectedArg, index) => args[index] === expectedArg);
}
