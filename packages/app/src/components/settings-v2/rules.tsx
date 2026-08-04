import { Component, For, Show, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import "./settings-v2.css"

type RuleFile = {
  path: string
  content: string
}

type UserRule = {
  id: string
  name: string
  enabled: boolean
  content: string
  createdAt: number
  updatedAt: number
}

export const SettingsRulesV2: Component<{ directory?: string }> = (props) => {
  const language = useLanguage()
  const server = useServer()
  const [rules, setRules] = createSignal<RuleFile[]>()
  const [error, setError] = createSignal<string>()
  const [userRules, setUserRules] = createStore<UserRule[]>([])
  const [showForm, setShowForm] = createSignal(false)
  const [userRuleName, setUserRuleName] = createSignal("")
  const [userRuleContent, setUserRuleContent] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  const api = async (path: string, init?: RequestInit) => {
    const conn = server.current
    if (!conn) throw new Error("no connection")
    const url = new URL(path, conn.http.url.replace(/\/+$/, ""))
    if (props.directory) url.searchParams.set("directory", props.directory)
    const headers: Record<string, string> = {}
    if (conn.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: conn.http.username,
        password: conn.http.password,
      })}`
    }
    if (init?.body) headers["Content-Type"] = "application/json"
    const res = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())
    const text = await res.text()
    return text ? (JSON.parse(text) as unknown) : undefined
  }

  const load = async () => {
    try {
      setRules((await api("/rule")) as RuleFile[])
      setError()
    } catch (err) {
      setRules()
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const loadUserRules = async () => {
    try {
      setUserRules((await api("/rule/user")) as UserRule[])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  onMount(() => {
    void load()
    void loadUserRules()
  })

  const openForm = () => {
    setUserRuleName("")
    setUserRuleContent("")
    setShowForm(true)
  }

  const closeForm = () => setShowForm(false)

  const createUserRule = async () => {
    const name = userRuleName().trim()
    const content = userRuleContent().trim()
    if (!name || !content) return
    setSaving(true)
    try {
      const rule = (await api("/rule/user", {
        method: "POST",
        body: JSON.stringify({ name, content }),
      })) as UserRule
      setUserRules((prev) => [...prev, rule])
      setError()
      setShowForm(false)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const toggleUserRule = async (rule: UserRule, enabled: boolean) => {
    try {
      const updated = (await api(`/rule/user/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })) as UserRule
      setUserRules((prev) => prev.map((item) => (item.id === rule.id ? updated : item)))
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const removeUserRule = async (rule: UserRule) => {
    try {
      await api(`/rule/user/${rule.id}`, { method: "DELETE" })
      setUserRules((prev) => prev.filter((item) => item.id !== rule.id))
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.rules")}</h2>
      </div>
      <div class="settings-v2-tab-body">
        <Show when={error()}>
          <p class="settings-v2-profile-hint">
            {language.t("settings.rules.error", { error: error() ?? "" })}
          </p>
        </Show>
        <section class="settings-v2-rules-card" data-action="settings-user-rules">
          <div class="settings-v2-rules-card-header">
            <h3 class="settings-v2-rules-card-title">
              {language.t("settings.rules.user.title")}
              <TooltipV2 value={language.t("settings.rules.user.description")}>
                <Icon name="help" class="settings-v2-rules-help" />
              </TooltipV2>
            </h3>
            <Show when={!showForm()}>
              <ButtonV2
                variant="ghost-muted"
                size="small"
                icon="plus"
                data-action="settings-user-rule-open"
                onClick={openForm}
              >
                {language.t("settings.rules.user.add")}
              </ButtonV2>
            </Show>
          </div>
          <Show when={userRules.length > 0}>
            <div class="flex flex-col gap-2">
              <For each={userRules}>
                {(rule) => (
                  <div class="settings-v2-user-rule-row" data-action="settings-user-rule-row">
                    <Switch
                      checked={rule.enabled}
                      hideLabel
                      onChange={(enabled) => void toggleUserRule(rule, enabled)}
                    />
                    <span class="settings-v2-user-rule-name">{rule.name}</span>
                    <details class="settings-v2-user-rule-details">
                      <summary class="settings-v2-user-rule-preview">{rule.content}</summary>
                      <pre class="settings-v2-rule-content">{rule.content}</pre>
                    </details>
                    <IconButtonV2
                      variant="ghost-muted"
                      icon={<Icon name="xmark-small" />}
                      aria-label={language.t("settings.rules.user.remove.label")}
                      data-action="settings-user-rule-remove"
                      onClick={() => void removeUserRule(rule)}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={showForm()}>
            <div class="settings-v2-user-rule-form" data-action="settings-user-rule-form">
              <div class="settings-v2-user-rule-form-row">
                <TextInputV2
                  class="settings-v2-user-rule-name-input"
                  placeholder={language.t("settings.rules.user.name.placeholder")}
                  value={userRuleName()}
                  disabled={saving()}
                  autofocus
                  onInput={(event) => setUserRuleName(event.currentTarget.value)}
                />
                <ButtonV2
                  variant="contrast"
                  size="small"
                  icon="plus"
                  data-action="settings-user-rule-add"
                  disabled={saving() || !userRuleName().trim() || !userRuleContent().trim()}
                  onClick={() => void createUserRule()}
                >
                  {language.t("settings.rules.user.add.confirm")}
                </ButtonV2>
                <ButtonV2
                  variant="ghost-muted"
                  size="small"
                  data-action="settings-user-rule-cancel"
                  disabled={saving()}
                  onClick={closeForm}
                >
                  {language.t("settings.rules.user.cancel")}
                </ButtonV2>
              </div>
              <TextareaV2
                class="settings-v2-user-rule-content-input"
                rows={5}
                placeholder={language.t("settings.rules.user.content.placeholder")}
                value={userRuleContent()}
                disabled={saving()}
                onInput={(event) => setUserRuleContent(event.currentTarget.value)}
              />
            </div>
          </Show>
        </section>
        <section class="settings-v2-rules-card" data-action="settings-rules-effective">
          <div class="settings-v2-rules-card-header">
            <h3 class="settings-v2-rules-card-title">{language.t("settings.rules.effective.title")}</h3>
            <ButtonV2
              variant="ghost-muted"
              size="small"
              data-action="settings-rules-refresh"
              onClick={() => void load()}
            >
              {language.t("settings.rules.refresh")}
            </ButtonV2>
          </div>
          <Show when={rules() && rules()!.length === 0}>
            <p class="settings-v2-profile-hint">{language.t("settings.rules.empty")}</p>
          </Show>
          <Show when={rules() && rules()!.length > 0}>
            <div class="flex flex-col gap-3">
              <For each={rules()}>
                {(rule) => (
                  <details class="settings-v2-rule-file" data-action="settings-rules-file">
                    <summary class="settings-v2-rule-summary">{rule.path}</summary>
                    <pre class="settings-v2-rule-content">{rule.content}</pre>
                  </details>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </>
  )
}
