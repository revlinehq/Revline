# Portrait proof — waiting for the user's concept pick

Project: j97ehr5fsvxwb0gwzyq2shy6fs8hhm2p
Format: portrait 9:16. Audience: creators, clippers and small teams. Composer edits a real timeline; streams become Shorts; motion design from a prompt. No logo.

All eight supplied storyboard-style references were opened. The current guidance requires complete black-ink subjects and exact copy, with no colour or planning marks.

## Concepts for review

**A — Type it, watch it build**

Your hand types “Cut three Shorts” beneath a streamer’s video. Three clips snap into a timeline; you nudge one yourself. “Animate my title” makes “Make it yours.” bounce.

**B — Cut the stream**

Scissors cut a streamer’s filmstrip into three phone-sized videos. You type “Animate my title” as clips enter the timeline. “Make it yours.” spins above the clips.

A or B? Or tell me what to change.

## Current gate

- Images generated: 0.
- saveStoryboard / approveClip calls: 0.
- Timeline clips: 0.
- No concept has been selected or approved by the agent.
- After the user's pick is relayed, record that actual choice, generate the selected board, return its signed image URLs inline, and stop for review. Do not advance to style frames.

## Revline tool calls made in this proof

### 1. createProject

```json
{
  "aspectRatio": "vertical",
  "title": "Revline portrait concepts — awaiting user pick (throwaway)"
}
```

### 2. updateBrief

```json
{
  "projectId": "j97ehr5fsvxwb0gwzyq2shy6fs8hhm2p",
  "set": [
    {
      "rule": "Portrait 9:16 Reel for creators, clippers and small teams: composer edits a real timeline; streams become Shorts; motion design from a prompt. No logo. Stop at concept selection; no images or approval writes until the user's pick.",
      "userWords": "creators, clippers and small teams; the composer edits a real timeline; streams become Shorts; motion design from a prompt; no logo."
    }
  ]
}
```

### 3. getProject

```json
{
  "projectId": "j97ehr5fsvxwb0gwzyq2shy6fs8hhm2p"
}
```

### 4. readSkill

```json
{
  "projectId": "j97ehr5fsvxwb0gwzyq2shy6fs8hhm2p",
  "name": "storyboard"
}
```

### 5. readSkill

```json
{
  "projectId": "j97ehr5fsvxwb0gwzyq2shy6fs8hhm2p",
  "name": "image-direction"
}
```

### 6. readSkill

```json
{
  "projectId": "j97ehr5fsvxwb0gwzyq2shy6fs8hhm2p",
  "name": "motion-design",
  "page": "image-plates"
}
```

The dev readSkill calls returned the updated storyboard, image-direction and image-plates guidance. Typecheck, agent-runner typecheck and build passed after merging main through #46. Both new-project files match origin/main, including slashCommands, the footage menu and project thumbnails. No conflict markers or concept-gate bypass remain.

