---
name: effect-review
description: 审查 Effect-TS 代码的规范性与类型安全，检查 Effect generator 用法、服务依赖注入和错误处理模式
---

当用户请求审查 Effect-TS 相关代码时，按以下要点检查：

## 必查项

1. **Generator 风格**：用 `Effect.gen(function* () { ... })` 而非 `Effect.fn`/`Effect.try`
2. **服务绑定**：先 `const service = yield* Foo.Service` 再调方法，禁止 `yield* (yield* Foo.Service).bar()` 嵌套
3. **错误处理**：用 `Effect.catch`/`Effect.catchDefect`（Effect v4 API），不要用 `try/catch`
4. **类型推断**：避免 `any`，用 `unknown` + 类型守卫；过滤数组时用 type guard 维持推断
5. **变量内联**：只用一次的值直接内联，减少中间变量

## Schema 相关

- 字段名用 snake_case，避免 `text("col")` 显式列名
- 用 `Schema.decodeUnknownOption` 而非 `JSON.parse` 包 `Effect.try`
- 解析不可信 JSON 用 `Schema.UnknownFromJsonString`

## 不可变约束

- 优先 `const`，用三元/早返回替代 `let` 重赋值
- 避免 `else`，用早返回

输出审查结果时按严重程度分级：错误 / 警告 / 建议。
