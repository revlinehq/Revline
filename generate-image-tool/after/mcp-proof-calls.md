# Native revline-local proof calls

Status: incomplete. The connected client's cached catalogue does not expose generateImage, presentStoryboard or saveStoryboard. They are registered in the shared toolkit used by the Cloudflare runner and MCP server. No script or direct backend call substitutes for these steps.

Throwaway project: j978fbjj5j761aq3eydm13ez0d8hge58

The following calls used the exposed revline-local MCP tools, in this order. No image, scene, audio, timeline content or export has been created in this project.

## 1. createProject

```json
{
  "title": "Relay MCP-only studio proof (throwaway)",
  "aspectRatio": "landscape"
}
```

## 2. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "storyboard"
}
```

## 3. getProject

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58"
}
```

## 4. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "image-direction"
}
```

## 5. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "motion-design",
  "page": "image-plates"
}
```

## 6. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "scene-engine",
  "page": "react-scenes"
}
```

## 7. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "gsap",
  "page": "revline"
}
```

## 8. updateBrief

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "set": [
    {
      "rule": "Authorized fictional Relay proof: silent 12-second 16:9 startup film for busy small teams. Abstract diagrams, no invented product UI. CTA: Make room for focus.",
      "userWords": "Proof on a throwaway dev project you create: run the flow for a fictional startup. Never the user's projects, never exportVideo."
    }
  ]
}
```

## 9. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "storyboard"
}
```

## 10. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "motion-design"
}
```

## 11. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "reference-footage"
}
```

## 12. readSkill

```json
{
  "projectId": "j978fbjj5j761aq3eydm13ez0d8hge58",
  "name": "scene-engine",
  "page": "checklist"
}
```


# Separate still-image read

This native tool check used an earlier throwaway project's generated sketch, not the fresh end-to-end proof. It succeeded and returned the image with source dimensions 1536 × 864 and fps 0.

```json
[
  {
    "tool": "readFrames",
    "args": {
      "projectId": "j971d8yn0zwtnwgvnw5tam64nn8hhbp5",
      "assetId": "j5731fmj85562zwkcepa3ksjwd8hgpjq",
      "start": 0,
      "end": 0,
      "count": 1
    },
    "isError": false,
    "scope": "Earlier throwaway project's candidate; separate from fresh MCP-only proof."
  }
]
```

Earlier exploration used an SDK MCP client and the editor chat. It is not counted as the requested native-MCP-only proof. The opaque and transparent example assets predate the studio-workflow refinement. The native-only four-frame board, style frames, paced animatic, saved approvals and chat-strip screenshots remain pending the client's tool refresh.

