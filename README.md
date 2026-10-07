# guided-mr

A Claude Code mod for guided code review. It takes a GitHub pull request, a GitLab merge request or your current branch, groups the diff into a few ordered steps that tell the story of the change, and lets you page through them in a pane beside the conversation or in your browser.

Each step has a short title, a plain-English summary, a "Check" note on what deserves a careful look, and the real diff for that step. Claude only decides how the changes group and in what order; every line of code shown comes straight from git, never from the model.

## Install

In Claude Code (2.1.287 or newer), at the prompt:

```
/plugin install guided-mr --marketplace alexjacobs08/guided-mr
```

Answer `y` to add the marketplace, then pick a scope.

To run it from a local checkout instead:

```
claude --plugin-dir /path/to/guided-mr
```

or add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` to load it in every session.

## Use

| Command | Reviews |
| --- | --- |
| `/guided-mr` | this branch against the repo's default branch |
| `/guided-mr 123` | PR or MR 123 on whichever forge `origin` points at |
| `/guided-mr #123` | GitHub PR 123 |
| `/guided-mr !123` | GitLab MR 123 |
| `/guided-mr <url>` | a GitHub PR or GitLab MR link, from any repo |
| `/guided-mr some-ref` | this branch against `some-ref` |
| `/guided-mr show` | reopens the pane without rebuilding |
| `/guided-mr web` | opens the current guide in your browser |

Building a guide takes about a minute. GitHub PRs need the [GitHub CLI](https://cli.github.com) (`gh`) signed in; GitLab MRs need the [GitLab CLI](https://gitlab.com/gitlab-org/cli) (`glab`). Local branches need only git.

### In the pane

`n` / `p` next and previous step, `1`–`9` jump to a step, `o` overview, `x` mark reviewed, `s` unified or before/after view, `e` expand long diffs, `a` ask Claude about the step, `w` open in the browser, `r` rebuild.

### In the browser

The guide is written to `/tmp/guided-mr/` as a single HTML page: a step list, a diagram of how the changed parts connect, and side-by-side syntax-highlighted diffs. `j` / `k` move between steps, `x` marks one reviewed, `s` switches the diff layout. Reviewed steps are remembered in the browser.

The page loads [diff2html](https://diff2html.xyz) and [Mermaid](https://mermaid.js.org) from jsDelivr. The guide itself, code included, stays inside the file; offline, the page falls back to plain diffs.

## How it works

1. The diff comes from `git diff <base>...HEAD`, `gh pr diff` or `glab mr diff --raw`, with the commit messages or the PR/MR description as background.
2. The mod splits it into numbered hunks.
3. Claude Opus groups the hunk numbers into 2 to 8 steps and writes the titles, summaries, check notes and diagram. Any hunk it leaves out lands in a final "Other changes" step.

## Develop

```
claude plugin validate .
claude plugin test .
```
