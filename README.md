# my-mods

Claude Code mods by gotzastory.

## context-bar-plus

A band above the prompt for the Claude desktop app and terminal:

- **Context bar**: the context window by category; hover a segment for its name and size
- **Quota**: 5-hour and 7-day subscription windows with reset times; a toast at 90%
- **Tokens by model**: the main loop (`main·sonnet`) apart from subagents
- **Subagent modes** (button or `/subagent`): `OFF → ⚡ AUTO → SOFT → 🔒 STRICT`
  - AUTO sizes each change: small → one Haiku dispatch, medium → Haiku + one Sonnet review, large → full plan + subagent-driven-development
  - SOFT / STRICT run the full workflow; STRICT blocks the main loop from editing files and requires `superpowers:subagent-driven-development` before any implementer is dispatched
  - Implementers are pinned to Haiku, other subagents capped at Sonnet; unreviewed Haiku work triggers a `sonnet-reviewer` pass
- **Running subagents** listed under the bar; `/subagents` opens a live pane
- **📊 usage** button runs `explain-usage`
- Prompt-cache countdown on the status line

Skill set (MIX): Matt Pocock's `grilling` (asked through the question form), `prototype`, `codebase-design`, `tdd`, `diagnosing-bugs`, `code-review` axes; superpowers' `writing-plans` and `subagent-driven-development`.

### Install

At a Claude Code prompt:

```
/plugin install context-bar-plus --marketplace gotzastory/my-mods
```

Answer `y` to add the marketplace, then pick the user scope.

Then copy the two agents the subagent modes dispatch to:

```bash
git clone https://github.com/gotzastory/my-mods && cp my-mods/agents/*.md ~/.claude/agents/
```

Recommended plugins: [superpowers](https://github.com/obra/superpowers) and Matt Pocock's skills. Without them the modes still run, but the skills they name won't be found.

If you use the original `context-bar`, disable it so the two bands don't stack: `claude plugin disable context-bar`.

### Credits

`context-bar-plus` builds on [context-bar](https://github.com/Boom-Vitt/boombignose-mods) by Boom-Vitt (MIT).
