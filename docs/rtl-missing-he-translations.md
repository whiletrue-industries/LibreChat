# TODO — Missing Hebrew translations for RTL hot path

> Tracked as part of RTL audit (see `docs/rtl-audit-2026-04-19.md` section #15).
> Per `LibreChat/CLAUDE.md`, only `client/src/locales/en/translation.json` is
> updated manually in this repo — all non-English locales are populated by an
> external automated translation pipeline. This file lists the keys that are
> high-visibility on the Botnim (Hebrew-only) deployment and need a Hebrew
> value in `he/translation.json` on the next pipeline run.
>
> Once the pipeline fills these in, this file can be deleted.

## Keys that fall back to English in the Hebrew UI today

| Key | English source | Where it renders |
|---|---|---|
| `com_ui_message_input` | "Message input" | textarea `aria-label` for the main chat input (`ChatForm.tsx`, `EditMessage.tsx`) |
| `com_ui_transferred_to` | "Transferred to" | AgentHandoff inline banner (`AgentHandoff.tsx`) |
| `com_ui_close_var` | "Close {{0}}" | NavToggle tooltip (`NavToggle.tsx`) |
| `com_ui_open_var` | "Open {{0}}" | NavToggle tooltip (`NavToggle.tsx`) |
| `com_nav_control_panel` | "Control Panel" | Side panel toggle label (`NavToggle.tsx`) |
| `com_nav_chat_direction_selected` | "Chat direction: {{direction}}" | Settings → Chat → Direction aria-label (`ChatDirection.tsx`) |
| `com_nav_toggle_sidebar` | "Toggle sidebar" | Sidebar toggle description |
| `com_nav_keep_screen_awake` | "Keep screen awake during response generation" | Settings → General toggle label |
| `com_error_refusal` | "Response refused by safety filters…" | Error banner on refused responses |
| `com_error_stream_expired` | "The response stream has expired…" | Error banner when a stream times out |
| `com_error_invalid_base_url` | "The base URL you provided targets a restricted address…" | Error banner on invalid base URL |
| `com_ui_link_copied` | "Link copied" | Toast after copying a shared link |
| `com_ui_delete_confirm_strong` | "This will delete <strong>{{title}}</strong>" | Delete-conversation confirmation |
| `com_ui_delete_conversation_tooltip` | "Delete conversation" | Conversation row hover tooltip |

## New keys added by this audit (also need Hebrew translations)

These were added to `en/translation.json` as part of the RTL fixes and will be
empty in Hebrew until the next pipeline run:

- `com_ui_sibling_message_nav` — "Sibling message navigation" (`<nav>` aria-label)
- `com_ui_sibling_message_prev` — "Previous sibling message" (prev chevron aria-label)
- `com_ui_sibling_message_next` — "Next sibling message" (next chevron aria-label)

## Hebrew-side oddity to fix in the pipeline output

`com_ui_chat_history` in `he/translation.json` is currently "נקה היסטוריה"
("Clear history"), but the key is used as the *sidebar name* in
`NavToggle.tsx` under the tooltip template "{{Open/Close}} {{sidebar_name}}".
A Hebrew user therefore sees "פתח נקה היסטוריה", which reads as nonsense.
The correct Hebrew string is **"היסטוריית שיחות"**.
