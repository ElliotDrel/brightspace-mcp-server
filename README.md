# Brightspace MCP Server

> **By [Rohan Muppa](https://github.com/rohanmuppa), ECE @ Purdue**

Talk to your Brightspace courses with AI. Ask about grades, due dates, quizzes, announcements, and more. Works with Claude Desktop, Claude Code, Cursor, ChatGPT Desktop, Windsurf, and any MCP client.

This is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that connects your AI to D2L Brightspace so it can pull your grades, assignments, syllabus, and course content on demand.

Connects to D2L Brightspace. Automatic login supports Purdue's Microsoft Entra flow and SUNY campus selection. Other schools need a compatible automated sign-in flow; unsupported login pages return an actionable error.

<p align="center">
  <img src="https://raw.githubusercontent.com/RohanMuppa/brightspace-mcp-server/main/docs/how-it-works.svg" alt="Architecture diagram" width="100%">
</p>

## Try It

> "Download my lecture slides and turn them into interactive flashcards"
> "Grab every assignment rubric and build me a visual dashboard of what I need to hit for an A"

## Install

**You need:** [Node.js 20+](https://nodejs.org/) and an available native credential store: macOS Keychain, Windows Credential Manager, or Linux Secret Service. Linux requires `secret-tool` and an unlocked desktop keyring. Install `libsecret-tools` on Debian/Ubuntu, or the package providing `secret-tool` on your distribution. A container or SSH session without Secret Service cannot persist authentication in v2.

**Option 1: Let your AI do it**

Paste this into Claude Code, Cursor, Windsurf, Copilot, Codex, or any AI coding assistant:

```
Install brightspace-mcp-server for me by following
https://github.com/RohanMuppa/brightspace-mcp-server/blob/main/LLMs.md
(use --purdue if I'm at Purdue, or --suny if I'm at a SUNY campus).
```

**Option 2: Run it yourself**

```bash
npx -y brightspace-mcp-server@latest setup
```

Purdue students can add `--purdue` to skip entering the school URL:

```bash
npx -y brightspace-mcp-server@latest setup --purdue
```

SUNY campuses share one Brightspace site, so `--suny` also asks which campus
you're at and skips SUNY's campus picker when you sign in:

```bash
npx -y brightspace-mcp-server@latest setup --suny
```

The wizard saves your password in the native credential store and asks how you complete MFA. Purdue users can optionally enter an existing authenticator setup key or `otpauth://totp/` URI during setup. The server then selects Microsoft's verification-code method and generates a fresh code automatically when sign-in is required. A current six-digit code is not the setup key. The key is saved in the native credential store, never in `config.json`; do not put it in a repository, environment variable, issue, or chat. Without a saved key, authentication can wait for approval or number matching, prompt in the terminal for a code from Google Authenticator or another app, or open a visible browser for other interactive methods. The wizard can configure Claude Desktop, Cursor, Codex Desktop and CLI, and Claude Code when they are installed. Restart your AI client when it finishes.

Saving both the password and authenticator enrollment on one device reduces the separation normally provided by MFA. Use this option only on a device you control. The server never changes your Microsoft enrollment; remove the enrolled method from your account if the setup key is exposed.

Any other D2L school: run `setup` without a flag and paste your Brightspace URL (for example `https://yourschool.brightspace.com`).

<details>
<summary>Using a different client? Configure it manually.</summary>

Search your client's docs for how to add an MCP server. The server command to register is:

```
npx -y brightspace-mcp-server@latest
```

On **Windows**, npx must be wrapped: `cmd /c npx -y brightspace-mcp-server@latest`

You still need to run `npx -y brightspace-mcp-server@latest setup` first to save your credentials.

For Codex Desktop and Codex CLI, run:

```bash
codex mcp add brightspace -- npx -y brightspace-mcp-server@latest
```

Codex Desktop and CLI use the same user configuration on a computer. Restart the desktop app or start a new CLI session after registration.

For Claude Code, run:

```bash
claude mcp add --scope user brightspace -- npx -y brightspace-mcp-server@latest
```

Claude Desktop uses a separate configuration, which the setup wizard can update automatically.

</details>

## Session Expired?

There is nothing to log into first. Ask for your grades and the sign-in happens as part of that request, so the assistant never has to check whether you are authenticated before it can answer. Starting your AI client touches Brightspace not at all: a restart on its own will never set off an MFA prompt.

Returning the next day normally requires no action. The server renews short-lived API tokens over HTTPS using the saved Brightspace session. If that session ends, a headless browser restores your saved Microsoft session and tries silent SSO. Automatic recovery stays on the server's own auth version and does not install a different release before login. Set `D2L_HEADLESS=false` explicitly in the MCP environment to open a browser during automatic recovery. When an automatic run needs a code and no saved enrollment is available, run the auth command below to enter it securely in the terminal.

Manual authentication honors the hidden or visible mode chosen in setup. In visible mode, the window stays open for up to five minutes so you can finish credentials and MFA manually. Rerunning setup preserves your previous hidden or visible choice as the prompt default. Microsoft's passwordless screen is switched to its password option when a saved password is configured, allowing automated sign-in and subsequent MFA to continue.

Your school's policy controls when MFA is required. There is no local 24-hour cutoff, and the server no longer discards browser state after one hour. A network outage preserves the saved session and returns a temporary error.

Automatic code entry does not guarantee that no phone notification is sent. Microsoft can choose phone approval before the browser reaches the controls used to switch methods. A code preference may help when the account allows it, but [system-preferred authentication](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-system-preferred-authentication) can override user preferences. Switching the rendered page cannot retract an already sent notification. Keep saved sessions to avoid unnecessary sign-ins; a fresh login still depends on the school's authentication policy.

If you miss an MFA request, automatic browser authentication pauses for five minutes before trying again. Existing tokens and HTTP token renewal still work. Browser-based SSO also pauses because Microsoft can send another phone prompt during a redirect, even without a password submission. Run this command in a terminal to retry immediately, see a number match, or enter an authenticator code:

```bash
npx -y brightspace-mcp-server@latest auth
```

Run it from your home folder. On macOS, a terminal that lacks Files and Folders permission (the terminal panel inside Claude Desktop, or a fresh editor terminal) cannot start `npx` from inside Documents, Desktop, or Downloads — it fails with `EPERM: process.cwd failed … uv_cwd` before the server runs. The same applies if your AI client launches the server with one of those folders as its working directory; grant the app access under System Settings → Privacy & Security → Files and Folders, or start the server elsewhere.

**MFA at Purdue** commonly uses Microsoft Authenticator number matching. If you saved an authenticator setup key during setup, the server prefers a verification code and completes that step in its own browser without requiring phone approval. Microsoft can still require a different challenge; in that case, the existing number-match or visible-browser flow remains available. Without a saved key, a number-match request returns quickly with the number to enter — approve it on your phone, then call the tool again. Google Authenticator and other one-time-code apps also work manually: run the auth command above in a terminal and it prompts for the code when your provider asks for one. The MCP sends authentication progress as logging notifications to clients that display them.

**On a Duo tenant**, if Duo asks "Is this your device?" before it will send a push, automatic sign-in answers **yes** so the push can go out at all — a headless run has nobody to click it otherwise. That also makes Duo remember the device, which skips its own device check on later logins from this machine. Don't run automatic sign-in on a shared or public computer if you'd rather Duo keep asking. Setting `D2L_DUO_PASSCODE` to any value switches from waiting for a push to typing a code from Duo Mobile's passcode option instead.

## What You Can Ask About

| Topic | Examples |
|-------|---------|
| Grades | "Am I passing all my classes?" · "Compare my grades across all courses" |
| Assignments | "What's due in the next 48 hours?" · "Summarize every assignment I haven't turned in yet" · "Give me the link to submit HW 4" |
| Quizzes | "Which quizzes close this week?" · "Is Quiz 3 timed, and does it have a grace period?" |
| Assignment files | "What does the lab 4 spec actually ask for?" · "Summarize the rubric attached to the project" |
| Exams | "Is there a midterm in the gradebook that isn't on my assignments list?" |
| Announcements | "Did any professor post something important today?" · "What did my CS prof announce this week?" · "Any announcements since last Monday?" · "Read the file attached to today's announcement" · "Save the rubric my prof attached to that announcement" |
| Course content | "Find the midterm review slides" · "Download every PDF from Module 5" · "What's new in this course since I last checked?" |
| Roster | "Who are the TAs for ECE 264?" · "Get me my instructor's email" |
| Discussions | "What are people saying in the final project thread?" · "Summarize the latest discussion posts" |
| Video transcripts | "What did the professor say about pinch-off in Tuesday's lecture recording?" · "Summarize last week's BoilerCast video" — works for Kaltura and YouTube embeds; other platforms report that they aren't supported yet |
| Troubleshooting | "Which version of the Brightspace server am I running?" · "Where is my Brightspace config file?" — `get_server_info` reports the version, Node runtime, platform, config and session paths, school URL, and whether a credential is stored, without contacting Brightspace or revealing secrets |
| Calendar | "When is my midterm?" · "What's on my calendar this week?" · "Is lab cancelled on Thursday?" — reads exams, labs, review sessions, and deadlines instructors put only on the course calendar |
| Planning | "Build me a study schedule based on my upcoming due dates" · "Which class needs the most attention right now?" — pulls from assignments, quizzes, graded discussion topics (any topic with a due date), and course calendar events such as exams and labs |


### Local forks and authentication diagnostics

When launching a fork from its local checkout, set `D2L_NO_UPDATE_CHECK=1` in
both clients' Brightspace MCP environment settings. This disables upstream npm
notices and CLI self-update; update and rebuild the checkout deliberately.

Set `D2L_DIAGNOSTICS_DIR` to a private local directory to retain authentication
diagnostics even when a client discards stderr. Daily `auth-YYYY-MM-DD.jsonl`
files record process IDs and correlation IDs, stage timings, restored-state and code-method
availability, selected methods, Microsoft method-request categories and HTTP
statuses, background recovery outcomes, and failed assignment sources. A phone
method request does not establish that a notification was delivered. Request
bodies, URLs, account names, passwords, MFA digits, cookies, and tokens are never
written. Each day's file is capped at 5 MiB; existing files are preserved and
logging failures do not interrupt sign-in. Remove the environment setting to
stop recording.

Saved authenticator-code automation gets 15 seconds after a phone challenge
appears to find Microsoft's code alternative before requesting manual approval.
Once a code is submitted, the tool waits for authentication to finish instead of
reporting the transient number-match screen as a manual approval request. This
changes when the client is asked to intervene; it does not prevent Microsoft
from initiating a phone-method request. Assignment retrieval propagates
pending authentication and token-renewal failures rather than returning an
apparently successful empty list.

Licensed under the MIT License.
