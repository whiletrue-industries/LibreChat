# Botnim LibreChat configuration — upstream v0.8.4 baseline.
# The Botnim bot itself is an Agent record in MongoDB (created by the
# seed script on first boot); this file only configures the endpoint
# framework around it.

version: 1.3.6
cache: true

registration:
  # We run a private deployment; disable self-signup. Admin user is
  # seeded by the init-user script (docker-compose.yml).
  socialLogins: []
  allowedDomains: []

interface:
  endpointsMenu: false
  modelSelect: false
  parameters: true
  sidePanel: true
  presets: false
  prompts:
    use: false
    create: false
    share: false
    public: false
  bookmarks: false
  multiConvo: false
  agents:
    # create=true so the seed script can create the Botnim agent on
    # first boot. Once that's done we can flip this back to false if
    # desired — the existing agent keeps working either way.
    use: true
    create: true
    share: true
    public: true
  marketplace:
    use: false
  fileCitations: true
  # Login-page footer links — match botnim.co.il prod so the styling
  # port lines up pixel-for-pixel with the fork.
  privacyPolicy:
    externalUrl: "https://docs.google.com/document/d/e/2PACX-1vTCJJg9Fa20wKRqUkrEJ1tDUCDmyey12yVTSIFa_CCqGcyRTW8yyWcIXwTX3upehdrU_kA-_-Bbkcdv/pub"
    openNewTab: true
  termsOfService:
    externalUrl: "https://docs.google.com/document/d/e/2PACX-1vTCJJg9Fa20wKRqUkrEJ1tDUCDmyey12yVTSIFa_CCqGcyRTW8yyWcIXwTX3upehdrU_kA-_-Bbkcdv/pub"
    openNewTab: true

actions:
  # Allow Actions to call these hosts. The Botnim tools ship pointing
  # at staging.botnim.co.il; tool calls from local docker hit the
  # public ALB so they read real staging ES data. Leave next.obudget
  # and api.stack-ai because the unified bot's budgetkey OpenAPI tool
  # depends on them.
  allowedDomains:
    - staging.botnim.co.il
    - botnim.co.il
    - botnim.staging.build-up.team
    - botnim_api
    # ECS Service Connect alias (note hyphen, not underscore — Service
    # Connect normalizes service names to use the same form as the
    # service definition). Tool calls go via Envoy mesh in-VPC.
    - botnim-api
    - next.obudget.org
    - api.stack-ai.com

endpoints:
  agents:
    # Allow deep tool chains; the unified bot can call 10+ retrieve
    # tools before reaching an answer.
    recursionLimit: 50
    maxRecursionLimit: 100
    disableBuilder: false
    capabilities: [execute_code, file_search, actions, tools]

modelSpecs:
  enforce: true
  prioritize: true
  list:
    - name: botnim-unified
      label: "בוט מאוחד - תקנון, חוקים ותקציב"
      default: true
      description: "עונה על שאלות מתוך תקנון הכנסת וחוקים נלווים וכן על שאלות בנושאי תקציב"
      preset:
        endpoint: agents
        agent_id: ${BOTNIM_AGENT_ID_UNIFIED}
