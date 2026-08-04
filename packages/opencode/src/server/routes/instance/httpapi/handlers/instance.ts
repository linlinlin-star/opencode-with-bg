import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import * as InstanceState from "@/effect/instance-state"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp/lsp"
import { Vcs } from "@/project/vcs"
import { Skill } from "@/skill"
import { Instruction } from "@/session/instruction"
import { UserRule } from "@/user-rules"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  ApiUserRuleNotFoundError,
  ApiVcsApplyError,
  ApiVcsCheckoutError,
} from "../groups/instance"
import { markInstanceForDisposal } from "../lifecycle"

export const instanceHandlers = HttpApiBuilder.group(InstanceHttpApi, "instance", (handlers) =>
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const skill = yield* Skill.Service
    const instruction = yield* Instruction.Service
    const userRule = yield* UserRule.Service
    const vcs = yield* Vcs.Service

    const dispose = Effect.fn("InstanceHttpApi.dispose")(function* () {
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return true
    })

    const getPath = Effect.fn("InstanceHttpApi.path")(function* () {
      const ctx = yield* InstanceState.context
      return {
        home: Global.Path.home,
        state: Global.Path.state,
        config: Global.Path.config,
        worktree: ctx.worktree,
        directory: ctx.directory,
      }
    })

    const getVcs = Effect.fn("InstanceHttpApi.vcs")(function* () {
      const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], {
        concurrency: "unbounded",
      })
      return { branch, default_branch }
    })

    const getVcsStatus = Effect.fn("InstanceHttpApi.vcsStatus")(function* () {
      return yield* vcs.status()
    })

    const getVcsDiff = Effect.fn("InstanceHttpApi.vcsDiff")(function* (ctx: {
      query: { mode: Vcs.Mode; context?: number }
    }) {
      return yield* vcs.diff(ctx.query.mode, { context: ctx.query.context })
    })

    const getVcsDiffRaw = Effect.fn("InstanceHttpApi.vcsDiffRaw")(function* () {
      return yield* vcs.diffRaw()
    })

    const applyVcs = Effect.fn("InstanceHttpApi.vcsApply")(function* (ctx: { payload: Vcs.ApplyInput }) {
      return yield* vcs.apply(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsApplyError({
              name: "VcsApplyError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
      )
    })

    const getVcsBranches = Effect.fn("InstanceHttpApi.vcsBranches")(function* () {
      return yield* vcs.branches()
    })

    const getVcsLog = Effect.fn("InstanceHttpApi.vcsLog")(function* (ctx: {
      query: { limit?: string; branch?: string }
    }) {
      return yield* vcs.log({
        ...ctx.query,
        limit: ctx.query.limit ? Number(ctx.query.limit) : undefined,
      })
    })

    const getVcsCommitDiff = Effect.fn("InstanceHttpApi.vcsCommitDiff")(function* (ctx: {
      query: { hash: string }
    }) {
      return yield* vcs.commitDiff(ctx.query.hash)
    })

    const checkoutVcs = Effect.fn("InstanceHttpApi.vcsCheckout")(function* (ctx: {
      payload: Vcs.CheckoutInput
    }) {
      return yield* vcs.checkout(ctx.payload).pipe(
        Effect.mapError(
          (error) =>
            new ApiVcsCheckoutError({
              name: "VcsCheckoutError",
              data: {
                message: error.message,
                reason: error.reason,
              },
            }),
        ),
        Effect.map(() => true),
      )
    })

    const getCommand = Effect.fn("InstanceHttpApi.command")(function* () {
      return yield* command.list()
    })

    const getAgent = Effect.fn("InstanceHttpApi.agent")(function* () {
      return yield* agent.list()
    })

    const getSkill = Effect.fn("InstanceHttpApi.skill")(function* () {
      return yield* skill.all()
    })

    const getRules = Effect.fn("InstanceHttpApi.rule")(function* () {
      const files = yield* instruction.files().pipe(Effect.orDie)
      return files.map(({ filepath, content }) => ({ path: filepath, content }))
    })

    const listUserRules = Effect.fn("InstanceHttpApi.ruleUserList")(function* () {
      return yield* userRule.list()
    })

    const createUserRule = Effect.fn("InstanceHttpApi.ruleUserCreate")(function* (ctx: {
      payload: UserRule.Create
    }) {
      return yield* userRule.create(ctx.payload)
    })

    const updateUserRule = Effect.fn("InstanceHttpApi.ruleUserUpdate")(function* (ctx: {
      params: { id: string }
      payload: UserRule.Update
    }) {
      return yield* userRule.update(ctx.params.id, ctx.payload).pipe(
        Effect.mapError(
          () => new ApiUserRuleNotFoundError({ name: "UserRuleNotFoundError", data: { message: "User rule not found" } }),
        ),
      )
    })

    const removeUserRule = Effect.fn("InstanceHttpApi.ruleUserRemove")(function* (ctx: { params: { id: string } }) {
      yield* userRule.remove(ctx.params.id).pipe(
        Effect.mapError(
          () => new ApiUserRuleNotFoundError({ name: "UserRuleNotFoundError", data: { message: "User rule not found" } }),
        ),
      )
    })

    const getLsp = Effect.fn("InstanceHttpApi.lsp")(function* () {
      return yield* lsp.status()
    })

    const getFormatter = Effect.fn("InstanceHttpApi.formatter")(function* () {
      return yield* format.status()
    })

    return handlers
      .handle("dispose", dispose)
      .handle("path", getPath)
      .handle("vcs", getVcs)
      .handle("vcsStatus", getVcsStatus)
      .handle("vcsDiff", getVcsDiff)
      .handle("vcsDiffRaw", getVcsDiffRaw)
      .handle("vcsApply", applyVcs)
      .handle("vcsBranches", getVcsBranches)
      .handle("vcsLog", getVcsLog)
      .handle("vcsCommitDiff", getVcsCommitDiff)
      .handle("vcsCheckout", checkoutVcs)
      .handle("command", getCommand)
      .handle("agent", getAgent)
      .handle("skill", getSkill)
      .handle("rule", getRules)
      .handle("ruleUserList", listUserRules)
      .handle("ruleUserCreate", createUserRule)
      .handle("ruleUserUpdate", updateUserRule)
      .handle("ruleUserRemove", removeUserRule)
      .handle("lsp", getLsp)
      .handle("formatter", getFormatter)
  }),
)
