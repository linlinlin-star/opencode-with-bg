import { Component, For, Show, createMemo } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useDirectoryPicker } from "@/components/directory-picker"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { createProfileController, type ProfileController, type SkillMode } from "./profile-controllers"
import type { SkillV2Info } from "@opencode-ai/sdk/v2/client"
import "./settings-v2.css"

const modeOptions: SkillMode[] = ["inherit", "deny"]

const SkillsModeSection: Component<{ controller: ProfileController }> = (props) => {
  const language = useLanguage()
  const modeLabel = (mode: SkillMode) => {
    if (mode === "deny") return language.t("settings.profile.skills.mode.deny")
    return language.t("settings.profile.skills.mode.inherit")
  }
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.profile.skills.mode.title")}</h3>
      <SettingsListV2>
        <SettingsRowV2
          title={
            <span class="settings-v2-skill-title">
              {language.t("settings.profile.skills.mode.title")}
              <TooltipV2 value={language.t("settings.profile.skills.mode.description")}>
                <Icon name="help" class="settings-v2-rules-help" />
              </TooltipV2>
            </span>
          }
          description=""
        >
          <SelectV2
            appearance="inline"
            data-action="settings-profile-skill-mode"
            options={modeOptions}
            current={modeOptions.find((mode) => mode === props.controller.mode())}
            placement="bottom-end"
            gutter={6}
            label={modeLabel}
            onSelect={(mode) => mode && props.controller.setMode(mode)}
          />
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )
}

const SkillsEffectiveSection: Component<{ controller: ProfileController }> = (props) => {
  const language = useLanguage()
  const skills = createMemo(() => props.controller.skills())
  const sourceLabel = (skill: SkillV2Info) => {
    const key = isInsideProject(skill.location, props.controller.directory())
      ? "settings.profile.skills.source.project"
      : "settings.profile.skills.source.global"
    return language.t(key)
  }
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.profile.skills.effective.title")}</h3>
      <SettingsListV2>
        <Show
          when={skills().length > 0}
          fallback={
            <SettingsRowV2 title={language.t("settings.profile.skills.empty")} description="">
              <span />
            </SettingsRowV2>
          }
        >
          <For each={skills()}>
            {(skill) => (
              <SettingsRowV2
                title={
                  <span class="settings-v2-skill-title">
                    {skill.name}
                    <Tag>{sourceLabel(skill)}</Tag>
                  </span>
                }
                description=""
              >
                <Show when={skill.description}>
                  <TooltipV2 value={skill.description}>
                    <Icon name="help" class="settings-v2-rules-help" />
                  </TooltipV2>
                </Show>
              </SettingsRowV2>
            )}
          </For>
        </Show>
      </SettingsListV2>
    </div>
  )
}

// A skill belongs to the project when its SKILL.md lives under the session
// directory; anything else (global `.opencode`, URL pulls, custom paths)
// counts as global. Compare normalized paths so Windows separators and case
// do not break the prefix check.
function isInsideProject(location: string, directory: string | undefined) {
  if (!directory) return false
  const norm = (value: string) => value.replaceAll("\\", "/").toLowerCase()
  const root = norm(directory).replace(/\/+$/, "")
  const path = norm(location)
  return path === root || path.startsWith(`${root}/`)
}

export const SettingsProfileV2: Component<{ sessionID?: string }> = (props) => {
  const language = useLanguage()
  const server = useServer()
  const picker = useDirectoryPicker()
  const controller = createProfileController(() => props.sessionID)

  const pickSkillFolders = () => {
    const conn = server.current
    if (!conn) return
    picker({
      server: conn,
      title: language.t("settings.profile.skills.addFolder"),
      multiple: true,
      onSelect: (result) => {
        if (!result) return
        void controller.addSkillDirectories(Array.isArray(result) ? result : [result])
      },
    })
  }

  return (
    <section class="settings-v2-rules-card" data-action="settings-profile">
      <div class="settings-v2-rules-card-header">
        <h3 class="settings-v2-rules-card-title">{language.t("settings.tab.profile")}</h3>
        <Show when={controller.supported()}>
          <ButtonV2
            variant="ghost-muted"
            size="small"
            icon="plus"
            data-action="settings-profile-add-skills"
            onClick={pickSkillFolders}
          >
            {language.t("settings.profile.skills.addFolder")}
          </ButtonV2>
        </Show>
      </div>
      <Show
        when={controller.supported()}
        fallback={<p class="settings-v2-profile-hint">{language.t("settings.profile.unsupported.v1")}</p>}
      >
        <Show
          when={controller.enabled()}
          fallback={<p class="settings-v2-profile-hint">{language.t("settings.profile.noSession")}</p>}
        >
          <SkillsModeSection controller={controller} />
          <SkillsEffectiveSection controller={controller} />
        </Show>
      </Show>
    </section>
  )
}