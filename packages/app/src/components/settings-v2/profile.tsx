import { Component, For, Show, createMemo } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { createProfileController, type ProfileController, type SkillState } from "./profile-controllers"
import "./settings-v2.css"

const stateOptions: SkillState[] = ["inherit", "allowed", "disabled"]

const SkillsSection: Component<{ controller: ProfileController }> = (props) => {
  const language = useLanguage()
  const stateLabel = (state: SkillState) => {
    if (state === "allowed") return language.t("settings.profile.skill.state.allowed")
    if (state === "disabled") return language.t("settings.profile.skill.state.disabled")
    return language.t("settings.profile.skill.state.inherit")
  }
  const skills = createMemo(() => props.controller.skills())
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.profile.skills.title")}</h3>
      <SettingsListV2>
        <Show
          when={skills().length > 0}
          fallback={
            <SettingsRowV2
              title={language.t("settings.profile.skills.empty")}
              description=""
            >
              <span />
            </SettingsRowV2>
          }
        >
          <For each={skills()}>
            {(skill) => (
              <SettingsRowV2 title={skill.name} description={skill.description ?? ""}>
                <SelectV2
                  appearance="inline"
                  data-action="settings-profile-skill"
                  options={stateOptions}
                  current={stateOptions.find((state) => state === props.controller.skillState(skill.name))}
                  placement="bottom-end"
                  gutter={6}
                  label={stateLabel}
                  onSelect={(state) => state && props.controller.setSkillState(skill.name, state)}
                />
              </SettingsRowV2>
            )}
          </For>
        </Show>
      </SettingsListV2>
    </div>
  )
}

const RulesSection: Component<{ controller: ProfileController }> = (props) => {
  const language = useLanguage()
  const inlineText = createMemo(() => props.controller.sessionProfile()?.rules?.inline ?? "")
  const instructionsText = createMemo(() =>
    (props.controller.sessionProfile()?.rules?.instructions ?? []).join("\n"),
  )
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.profile.rules.title")}</h3>
      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.profile.rules.inline.title")}
          description={language.t("settings.profile.rules.inline.description")}
        >
          <textarea
            class="settings-v2-profile-textarea"
            data-action="settings-profile-rules-inline"
            placeholder={language.t("settings.profile.rules.inline.placeholder")}
            spellcheck={false}
            onInput={(event) => props.controller.setInline(event.currentTarget.value)}
          >
            {inlineText()}
          </textarea>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("settings.profile.rules.instructions.title")}
          description={language.t("settings.profile.rules.instructions.description")}
        >
          <textarea
            class="settings-v2-profile-textarea"
            data-action="settings-profile-rules-instructions"
            placeholder={language.t("settings.profile.rules.instructions.placeholder")}
            spellcheck={false}
            onInput={(event) =>
              props.controller.setInstructions(event.currentTarget.value.split("\n"))
            }
          >
            {instructionsText()}
          </textarea>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )
}

const EffectiveSection: Component<{ controller: ProfileController }> = (props) => {
  const language = useLanguage()
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.profile.effective.title")}</h3>
      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.profile.effective.title")}
          description={language.t("settings.profile.effective.summary")}
        >
          <ButtonV2
            variant="ghost-muted"
            data-action="settings-profile-reset"
            onClick={() => void props.controller.reset()}
          >
            {language.t("settings.profile.reset")}
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )
}

export const SettingsProfileV2: Component<{ sessionID?: string }> = (props) => {
  const language = useLanguage()
  const controller = createProfileController(() => props.sessionID)

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.tab.profile")}</h2>
      </div>
      <div class="settings-v2-tab-body">
        <Show
          when={controller.supported()}
          fallback={
            <p class="settings-v2-profile-hint">{language.t("settings.profile.unsupported.v1")}</p>
          }
        >
          <Show
            when={controller.enabled()}
            fallback={
              <p class="settings-v2-profile-hint">{language.t("settings.profile.noSession")}</p>
            }
          >
            <SkillsSection controller={controller} />
            <RulesSection controller={controller} />
            <EffectiveSection controller={controller} />
          </Show>
        </Show>
      </div>
    </>
  )
}
