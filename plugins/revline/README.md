# Revline for Claude Code

Edit videos from Claude Code. This plugin connects [Revline](https://tryrevline.com), an AI video editor, over MCP so Claude can upload footage, cut filler words, add captions, reframe for vertical, clip and export, all on a real timeline you can open in the browser.

## Install

```
/plugin marketplace add revlinehq/Revline
/plugin install revline@revline
```

Then run `/mcp`, pick **revline** and sign in with your Revline account (3-day free trial).

## What you get

- The `revline` MCP server (`https://tryrevline.com/mcp`, OAuth sign-in).
- The `revline` skill, which tells Claude how to run an edit: find the project, upload local files, edit as a task, check frames, and only export after you confirm.

## Try

- "Cut the filler words from ~/Desktop/take1.mov and add captions"
- "Make a 9:16 version of my latest Revline project"

## Privacy

See [tryrevline.com/privacy](https://tryrevline.com/privacy).
