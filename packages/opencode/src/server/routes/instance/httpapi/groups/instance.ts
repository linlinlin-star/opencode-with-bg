import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { Vcs } from "@/project/vcs"
import { Skill } from "@/skill"
import { UserRule } from "@/user-rules"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"

const PathInfo = Schema.Struct({
  home: Schema.String,
  state: Schema.String,
  config: Schema.String,
  worktree: Schema.String,
  directory: Schema.String,
}).annotate({ identifier: "Path" })

const RuleFile = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
}).annotate({ identifier: "RuleFile" })

export const VcsDiffQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  mode: Vcs.Mode,
  context: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})

export const VcsLogQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
})

export const VcsCommitDiffQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  hash: Schema.String,
})

export class ApiVcsApplyError extends Schema.ErrorClass<ApiVcsApplyError>("VcsApplyError")(
  {
    name: Schema.Literal("VcsApplyError"),
    data: Schema.Struct({
      message: Schema.String,
      reason: Schema.Literals(["non-git", "not-clean"]),
    }),
  },
  { httpApiStatus: 400 },
) {}

export class ApiVcsCheckoutError extends Schema.ErrorClass<ApiVcsCheckoutError>("VcsCheckoutError")(
  {
    name: Schema.Literal("VcsCheckoutError"),
    data: Schema.Struct({
      message: Schema.String,
      reason: Schema.Literals(["dirty", "not-found", "non-git", "error"]),
    }),
  },
  { httpApiStatus: 400 },
) {}

export class ApiUserRuleNotFoundError extends Schema.ErrorClass<ApiUserRuleNotFoundError>("UserRuleNotFoundError")(
  {
    name: Schema.Literal("UserRuleNotFoundError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 404 },
) {}

export const InstancePaths = {
  dispose: "/instance/dispose",
  path: "/path",
  vcs: "/vcs",
  vcsStatus: "/vcs/status",
  vcsDiff: "/vcs/diff",
  vcsDiffRaw: "/vcs/diff/raw",
  vcsApply: "/vcs/apply",
  vcsBranches: "/vcs/branches",
  vcsLog: "/vcs/log",
  vcsCheckout: "/vcs/checkout",
  vcsCommitDiff: "/vcs/commit/diff",
  command: "/command",
  agent: "/agent",
  skill: "/skill",
  rule: "/rule",
  ruleUser: "/rule/user",
  ruleUserItem: "/rule/user/:id",
  lsp: "/lsp",
  formatter: "/formatter",
} as const

export const InstanceApi = HttpApi.make("instance")
  .add(
    HttpApiGroup.make("instance")
      .add(
        HttpApiEndpoint.post("dispose", InstancePaths.dispose, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Instance disposed"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "instance.dispose",
            summary: "Dispose instance",
            description: "Clean up and dispose the current OpenCode instance, releasing all resources.",
          }),
        ),
        HttpApiEndpoint.get("path", InstancePaths.path, {
          query: WorkspaceRoutingQuery,
          success: PathInfo,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "path.get",
            summary: "Get paths",
            description:
              "Retrieve the current working directory and related path information for the OpenCode instance.",
          }),
        ),
        HttpApiEndpoint.get("vcs", InstancePaths.vcs, {
          query: WorkspaceRoutingQuery,
          success: described(Vcs.Info, "VCS info"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.get",
            summary: "Get VCS info",
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
          }),
        ),
        HttpApiEndpoint.get("vcsStatus", InstancePaths.vcsStatus, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Vcs.FileStatus), "VCS status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.status",
            summary: "Get VCS status",
            description: "Retrieve changed files in the current working tree without patches.",
          }),
        ),
        HttpApiEndpoint.get("vcsDiff", InstancePaths.vcsDiff, {
          query: VcsDiffQuery,
          success: described(Schema.Array(Vcs.FileDiff), "VCS diff"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.diff",
            summary: "Get VCS diff",
            description: "Retrieve the current git diff for the working tree or against the default branch.",
          }),
        ),
        HttpApiEndpoint.get("vcsDiffRaw", InstancePaths.vcsDiffRaw, {
          query: WorkspaceRoutingQuery,
          success: described(
            Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/x-diff; charset=utf-8" })),
            "Raw VCS diff",
          ),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.diff.raw",
            summary: "Get raw VCS diff",
            description: "Retrieve a raw patch for current uncommitted changes.",
          }),
        ),
        HttpApiEndpoint.post("vcsApply", InstancePaths.vcsApply, {
          query: WorkspaceRoutingQuery,
          payload: Vcs.ApplyInput,
          success: described(Vcs.ApplyResult, "VCS patch applied"),
          error: ApiVcsApplyError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.apply",
            summary: "Apply VCS patch",
            description: "Apply a raw patch to the current working tree.",
          }),
        ),
        HttpApiEndpoint.get("vcsBranches", InstancePaths.vcsBranches, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Vcs.Branch), "VCS branches"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.branches",
            summary: "List VCS branches",
            description: "Retrieve local and remote branches for the current repository.",
          }),
        ),
        HttpApiEndpoint.get("vcsLog", InstancePaths.vcsLog, {
          query: VcsLogQuery,
          success: described(Schema.Array(Vcs.Commit), "VCS commit log"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.log",
            summary: "Get VCS commit log",
            description: "Retrieve commit history, optionally filtered to a branch.",
          }),
        ),
        HttpApiEndpoint.get("vcsCommitDiff", InstancePaths.vcsCommitDiff, {
          query: VcsCommitDiffQuery,
          success: described(Schema.Array(Vcs.CommitFileDiff), "VCS commit file diff"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.commitDiff",
            summary: "Get VCS commit diff",
            description: "Retrieve the file changes introduced by a single commit.",
          }),
        ),
        HttpApiEndpoint.post("vcsCheckout", InstancePaths.vcsCheckout, {
          query: WorkspaceRoutingQuery,
          payload: Vcs.CheckoutInput,
          success: described(Schema.Boolean, "VCS branch checked out"),
          error: ApiVcsCheckoutError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.checkout",
            summary: "Checkout VCS branch",
            description: "Switch the working tree to the requested branch. Use force to discard local changes.",
          }),
        ),
        HttpApiEndpoint.get("command", InstancePaths.command, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Command.Info), "List of commands"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "command.list",
            summary: "List commands",
            description: "Get a list of all available commands in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.get("agent", InstancePaths.agent, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Agent.Info), "List of agents"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "app.agents",
            summary: "List agents",
            description: "Get a list of all available AI agents in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.get("skill", InstancePaths.skill, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Skill.Info), "List of skills"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "app.skills",
            summary: "List skills",
            description: "Get a list of all available skills in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.get("rule", InstancePaths.rule, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(RuleFile), "Effective instruction files"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "rule.files",
            summary: "List effective rules",
            description:
              "List AGENTS.md and configured instruction files that apply to the current workspace, with their contents.",
          }),
        ),
        HttpApiEndpoint.get("ruleUserList", InstancePaths.ruleUser, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(UserRule.Info), "User rules"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "rule.user.list",
            summary: "List user rules",
            description: "List the user-level personal rule entries with their enabled state.",
          }),
        ),
        HttpApiEndpoint.post("ruleUserCreate", InstancePaths.ruleUser, {
          query: WorkspaceRoutingQuery,
          payload: UserRule.Create,
          success: described(UserRule.Info, "Created user rule"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "rule.user.create",
            summary: "Create a user rule",
            description: "Create a new user-level personal rule. New rules are enabled by default.",
          }),
        ),
        HttpApiEndpoint.patch("ruleUserUpdate", InstancePaths.ruleUserItem, {
          query: WorkspaceRoutingQuery,
          params: { id: Schema.String },
          payload: UserRule.Update,
          success: described(UserRule.Info, "Updated user rule"),
          error: ApiUserRuleNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "rule.user.update",
            summary: "Update a user rule",
            description: "Update the name, content, or enabled state of a user-level personal rule.",
          }),
        ),
        HttpApiEndpoint.delete("ruleUserRemove", InstancePaths.ruleUserItem, {
          query: WorkspaceRoutingQuery,
          params: { id: Schema.String },
          success: Schema.Void,
          error: ApiUserRuleNotFoundError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "rule.user.remove",
            summary: "Remove a user rule",
            description: "Delete a user-level personal rule permanently.",
          }),
        ),
        HttpApiEndpoint.get("lsp", InstancePaths.lsp, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(LSP.Status), "LSP server status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.status",
            summary: "Get LSP status",
            description: "Get LSP server status",
          }),
        ),
        HttpApiEndpoint.get("formatter", InstancePaths.formatter, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Format.Status), "Formatter status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "formatter.status",
            summary: "Get formatter status",
            description: "Get formatter status",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "instance",
          description: "Experimental HttpApi instance read routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
