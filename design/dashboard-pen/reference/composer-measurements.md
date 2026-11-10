# Revline composer measurements

Captured 2026-11-09 from http://localhost:3001 (dev, dark theme, 1440×900 viewport, DPR 2) with getComputedStyle. Values are CSS px.

## Dashboard (/dashboard/new-project)

Placeholder: "Describe your video, or drop footage here"

Control order (visible, top to bottom, left to right):

1. button — Aspect ratio: 16:9 "Aspect ratio · 16:9"
2. textarea — Describe your next edit placeholder="Describe your video, or drop footage here"
3. button — Add footage
4. button — AI editing model and reasoning effort "GPT-6.1 Terra / · Medium"
5. button — Start edit
6. button — New video: add footage (upload-swap layer, aria-hidden while the composer is shown; not visible)

### Composer form
`form.edit-composer.edit-composer-studio.composer-upload-enabled.has-composer-header` Edit request "Aspect ratio · 16:9 / GPT-6.1 Terra / · Medium"

- width: 656px
- height: 146px
- padding: 38px 0px 0px
- border-color: rgb(43, 47, 53)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 16px
- font-weight: 400
- line-height: 24px
- color: rgb(242, 242, 242)
- gap: 6px
- display: flex
- opacity: 1
- rect: x 392.0, y 231.4, 656.0×146.0

### Composer header (aspect ratio card)
`div.group/card.gap-(--card-spacing).bg-card.py-(--card-spacing).text-card-foreground.[--card-spacing:--spacing(4)].has-data-[slot=card-footer]:pb-0.data-[size=sm]:[--card-spacing:--spacing(3)].data-[size=sm]:has-data-[slot=card-footer]:pb-0.composer-header` Video settings "Aspect ratio · 16:9"

- width: 592px
- height: 54px
- padding: 8px 14px 16px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- background-image: linear-gradient(rgb(27, 27, 27), rgb(27, 27, 27)), linear-gradient(rgb(42, 42, 42), rgb(38, 38, 38))
- box-shadow: rgba(0, 0, 0, 0.1) 0px 1px 2px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 400
- line-height: 20px
- color: rgb(170, 170, 170)
- gap: 24px
- display: flex
- opacity: 1
- rect: x 424.0, y 231.4, 592.0×54.0

### Header control
`button.composer-header-chip` Aspect ratio: 16:9 "Aspect ratio · 16:9"

- width: 137.312px
- height: 24px
- border-color: rgb(170, 170, 170)
- border-radius: 4px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 12px
- font-weight: 400
- line-height: 20px
- color: rgb(170, 170, 170)
- gap: 7px
- display: flex
- opacity: 1
- rect: x 439.0, y 240.4, 137.3×24.0

### Input group (container)
`div.composer-input-group`  "GPT-6.1 Terra / · Medium"

- width: 656px
- height: 108px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- background-image: linear-gradient(rgb(30, 30, 30), rgb(30, 30, 30)), linear-gradient(rgb(45, 45, 45), rgb(38, 38, 38))
- box-shadow: rgba(0, 0, 0, 0.26) 0px 1px 2px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 16px
- font-weight: 400
- line-height: 24px
- color: rgb(242, 242, 242)
- display: flex
- opacity: 1
- rect: x 392.0, y 269.4, 656.0×108.0

### Textarea
`textarea.` Describe your next edit placeholder="Describe your video, or drop footage here"

- width: 654px
- height: 62px
- padding: 12px 14px 8px
- border-color: rgb(43, 47, 53)
- border-style: solid
- box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(242, 242, 242) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 400
- line-height: 20px
- color: rgb(242, 242, 242)
- display: flex
- opacity: 1
- rect: x 393.0, y 270.4, 654.0×62.0

### Bottom row
`div.edit-composer-actions`  "GPT-6.1 Terra / · Medium"

- width: 654px
- height: 44px
- padding: 4px 8px 8px 6px
- border-color: rgb(43, 47, 53)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(161, 166, 173)
- gap: 4px
- display: flex
- opacity: 1
- rect: x 393.0, y 332.4, 654.0×44.0

### Bottom row control #1
`button.composer-add` Add footage

- width: 28px
- height: 28px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(170, 170, 170)
- display: flex
- opacity: 1
- rect: x 399.0, y 338.4, 28.0×28.0

### Bottom row control #2
`div.`  "GPT-6.1 Terra / · Medium"

- width: 572px
- height: 28px
- border-color: rgb(43, 47, 53)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(161, 166, 173)
- gap: 2px
- display: flex
- opacity: 1
- rect: x 431.0, y 338.4, 572.0×28.0

### Bottom row control #3
`button.revline-primary.composer-submit` Start edit

- width: 32px
- height: 32px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- background-color: rgb(124, 58, 237)
- box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(255, 255, 255)
- gap: 8px
- display: flex
- opacity: 0.5
- rect: x 1007.0, y 336.4, 32.0×32.0

### Send button
`button.revline-primary.composer-submit` Start edit

- width: 32px
- height: 32px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- background-color: rgb(124, 58, 237)
- box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(255, 255, 255)
- gap: 8px
- display: flex
- opacity: 0.5
- rect: x 1007.0, y 336.4, 32.0×32.0

### Page heading
`h1.`  "What are we making today?"

- width: 449.25px
- height: 40.3125px
- border-color: rgb(43, 47, 53)
- border-style: solid
- font-family: Outfit, "Outfit Fallback", sans-serif
- font-size: 36px
- font-weight: 500
- line-height: 40.32px
- color: rgb(242, 242, 242)
- display: block
- opacity: 1
- rect: x 495.4, y 167.1, 449.3×40.3

### Recent projects section
`section.`  "Recent projects / Upload new / Social Media Justice clips / "

- width: 656px
- height: 248px
- border-color: rgb(43, 47, 53)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 16px
- font-weight: 400
- line-height: 24px
- color: rgb(242, 242, 242)
- gap: 12px
- display: grid
- opacity: 1
- rect: x 392.0, y 401.4, 656.0×248.0

### Cards grid
`div.new-conversation-projects`  "Social Media Justice clips / Today / Preme x Drake clips / T"

- width: 656px
- height: 208px
- border-color: rgb(43, 47, 53)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 16px
- font-weight: 400
- line-height: 24px
- color: rgb(242, 242, 242)
- gap: 8px
- display: grid
- opacity: 1
- rect: x 392.0, y 441.4, 656.0×208.0

### Project card
`a.new-conversation-project`  "Social Media Justice clips / Today"

- width: 324px
- height: 64px
- padding: 10px
- border-width: 1px
- border-color: rgb(43, 43, 43)
- border-style: solid
- border-radius: 8px
- background-color: rgb(31, 31, 31)
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(170, 170, 170)
- gap: 12px
- display: flex
- opacity: 1
- rect: x 392.0, y 441.4, 324.0×64.0

### Card thumbnail
`span.workspace-chat-cover` 

- width: 56px
- height: 42px
- border-color: rgb(45, 45, 45)
- border-style: solid
- border-radius: 4px
- background-color: rgb(42, 42, 42)
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(170, 170, 170)
- display: grid
- opacity: 1
- rect: x 403.0, y 452.4, 56.0×42.0

### Card text #1
`span.workspace-chat-cover` 

- width: 56px
- height: 42px
- border-color: rgb(45, 45, 45)
- border-style: solid
- border-radius: 4px
- background-color: rgb(42, 42, 42)
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(170, 170, 170)
- display: grid
- opacity: 1
- rect: x 403.0, y 452.4, 56.0×42.0

### Card text #2
`img.` 

- width: 56px
- height: 42px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(170, 170, 170)
- display: block
- opacity: 1
- rect: x 403.0, y 452.4, 56.0×42.0

### Card text #3
`span.new-conversation-project-details`  "Social Media Justice clips / Today"

- width: 157.906px
- height: 38px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(170, 170, 170)
- gap: 4px
- display: grid
- opacity: 1
- rect: x 471.0, y 454.4, 157.9×38.0

### Card text #4
`strong.`  "Social Media Justice clips"

- width: 157.906px
- height: 18px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 13px
- font-weight: 500
- line-height: 18px
- color: rgb(170, 170, 170)
- display: block
- opacity: 1
- rect: x 471.0, y 454.4, 157.9×18.0

### Card text #5
`span.`  "Today"

- width: 157.906px
- height: 16px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 12px
- font-weight: 400
- line-height: 16px
- color: rgb(170, 170, 170)
- display: block
- opacity: 1
- rect: x 471.0, y 476.4, 157.9×16.0

### Textarea typed state
### Textarea (focused, typed)
`textarea.` Describe your next edit placeholder="Describe your video, or drop footage here"

- width: 654px
- height: 62px
- padding: 12px 14px 8px
- border-color: rgb(244, 244, 240)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 400
- line-height: 20px
- color: rgb(242, 242, 242)
- display: flex
- opacity: 1
- rect: x 393.0, y 270.4, 654.0×62.0

### Input group (focused)
`div.composer-input-group`  "GPT-6.1 Terra / · Medium"

- width: 656px
- height: 108px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- background-image: linear-gradient(rgb(30, 30, 30), rgb(30, 30, 30)), linear-gradient(rgb(45, 45, 45), rgb(38, 38, 38))
- box-shadow: rgba(0, 0, 0, 0.26) 0px 1px 2px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 16px
- font-weight: 400
- line-height: 24px
- color: rgb(242, 242, 242)
- display: flex
- opacity: 1
- rect: x 392.0, y 269.4, 656.0×108.0

### Send button (enabled)
`button.revline-primary.composer-submit` Start edit

- width: 32px
- height: 32px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- background-color: rgb(124, 58, 237)
- box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(255, 255, 255)
- gap: 8px
- display: flex
- opacity: 1
- rect: x 1007.0, y 336.4, 32.0×32.0

## Model picker menu

Items:

```
Model
GPT-6.1 Sol
GPT-6 Astra
GPT-6.1 Terra
Haiku 5.5
Sonnet 5.5
Opus 5.5
Reasoning effort
Medium
```

### Menu
`div.` AI editing model options "Model / GPT-6.1 Sol / GPT-6 Astra / GPT-6.1 Terra / Haiku 5."

- width: 222.141px
- height: 315.656px
- padding: 5px
- border-width: 1px
- border-color: rgb(58, 58, 58)
- border-style: solid
- border-radius: 10px
- background-color: rgb(42, 42, 42)
- box-shadow: rgba(0, 0, 0, 0.2) 0px 6px 24px 0px
- font-family: Inter, "Inter Fallback", sans-serif
- font-size: 16px
- font-weight: 400
- line-height: 24px
- color: rgb(242, 242, 242)
- display: block
- opacity: 1
- rect: x 431.0, y 371.5, 222.1×315.7

### Menu item #1
`div.`  "GPT-6.1 Sol"

- width: 210.141px
- height: 38px
- padding: 8px 32px 8px 12px
- border-color: rgb(43, 47, 53)
- border-style: solid
- border-radius: 5px
- font-family: Inter, "Inter Fallback", sans-serif
- font-size: 13px
- font-weight: 400
- line-height: 18.5714px
- color: rgb(242, 242, 242)
- gap: 9px
- display: flex
- opacity: 1
- rect: x 437.0, y 404.2, 210.1×38.0

### Menu item #2
`div.`  "GPT-6 Astra"

- width: 210.141px
- height: 38px
- padding: 8px 32px 8px 12px
- border-color: rgb(43, 47, 53)
- border-style: solid
- border-radius: 5px
- font-family: Inter, "Inter Fallback", sans-serif
- font-size: 13px
- font-weight: 400
- line-height: 18.5714px
- color: rgb(242, 242, 242)
- gap: 9px
- display: flex
- opacity: 1
- rect: x 437.0, y 442.2, 210.1×38.0

### Menu item #3
`div.`  "GPT-6.1 Terra"

- width: 210.141px
- height: 38px
- padding: 8px 32px 8px 12px
- border-color: rgb(43, 47, 53)
- border-style: solid
- border-radius: 5px
- font-family: Inter, "Inter Fallback", sans-serif
- font-size: 13px
- font-weight: 400
- line-height: 18.5714px
- color: rgb(242, 242, 242)
- gap: 9px
- display: flex
- opacity: 1
- rect: x 437.0, y 480.2, 210.1×38.0

### Menu item #4
`div.`  "Haiku 5.5"

- width: 210.141px
- height: 38px
- padding: 8px 32px 8px 12px
- border-color: rgb(43, 47, 53)
- border-style: solid
- border-radius: 5px
- font-family: Inter, "Inter Fallback", sans-serif
- font-size: 13px
- font-weight: 400
- line-height: 18.5714px
- color: rgb(242, 242, 242)
- gap: 9px
- display: flex
- opacity: 1
- rect: x 437.0, y 518.2, 210.1×38.0

### Menu item #5
`div.`  "Sonnet 5.5"

- width: 210.141px
- height: 38px
- padding: 8px 32px 8px 12px
- border-color: rgb(43, 47, 53)
- border-style: solid
- border-radius: 5px
- font-family: Inter, "Inter Fallback", sans-serif
- font-size: 13px
- font-weight: 400
- line-height: 18.5714px
- color: rgb(242, 242, 242)
- gap: 9px
- display: flex
- opacity: 1
- rect: x 437.0, y 556.2, 210.1×38.0

### Menu item #6
`div.`  "Opus 5.5"

- width: 210.141px
- height: 38px
- padding: 8px 32px 8px 12px
- border-color: rgb(43, 47, 53)
- border-style: solid
- border-radius: 5px
- font-family: Inter, "Inter Fallback", sans-serif
- font-size: 13px
- font-weight: 400
- line-height: 18.5714px
- color: rgb(242, 242, 242)
- gap: 9px
- display: flex
- opacity: 1
- rect: x 437.0, y 594.2, 210.1×38.0

### Menu item #7
`div.`  "Reasoning effort / Medium"

- width: 210.141px
- height: 38px
- padding: 8px 12px
- border-color: rgb(43, 47, 53)
- border-style: solid
- border-radius: 8px
- font-family: Inter, "Inter Fallback", sans-serif
- font-size: 13px
- font-weight: 400
- line-height: 18.5714px
- color: rgb(242, 242, 242)
- gap: 10px
- display: flex
- opacity: 1
- rect: x 437.0, y 643.2, 210.1×38.0

## Editor assistant composer (/editor/<Call of Duty - Warzone Season 1 Clipping>)

Placeholder: "What would you change next?"

Control order:

1. textarea — Describe your next edit placeholder="What would you change next?"
2. button — Add footage
3. button — AI editing model and reasoning effort "GPT-6.1 Terra / · Medium"
4. button — Start edit
5. button — New video: add footage

### Assistant panel
`div.editor-chat-panel`  "What are we making? / A tighter cut, a stronger opening, sub"

- width: 400px
- height: 757px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 12px
- font-weight: 400
- line-height: 18px
- color: rgb(242, 242, 242)
- display: block
- opacity: 1
- rect: x 0.0, y 56.0, 400.0×757.0

### Composer dock
`div.manual-composer-dock`  "GPT-6.1 Terra / · Medium"

- width: 368px
- height: 102px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 12px
- font-weight: 400
- line-height: 18px
- color: rgb(242, 242, 242)
- display: block
- opacity: 1
- rect: x 16.0, y 786.0, 368.0×102.0

### Composer form
`form.edit-composer.edit-composer-compact.composer-upload-enabled.manual-editor-composer` Edit request "GPT-6.1 Terra / · Medium"

- width: 368px
- height: 102px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 12px
- font-weight: 400
- line-height: 18px
- color: rgb(242, 242, 242)
- gap: 6px
- display: flex
- opacity: 1
- rect: x 16.0, y 786.0, 368.0×102.0

### Input group (container)
`div.composer-input-group`  "GPT-6.1 Terra / · Medium"

- width: 368px
- height: 102px
- border-width: 1px
- border-color: rgb(54, 54, 54)
- border-style: solid
- border-radius: 8px
- background-color: rgb(42, 42, 42)
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 12px
- font-weight: 400
- line-height: 18px
- color: rgb(242, 242, 242)
- display: flex
- opacity: 1
- rect: x 16.0, y 786.0, 368.0×102.0

### Textarea
`textarea.` Describe your next edit placeholder="What would you change next?"

- width: 366px
- height: 56px
- padding: 10px 14px 8px
- border-color: rgb(27, 27, 27)
- border-style: solid
- box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(242, 242, 242) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 400
- line-height: 20px
- color: rgb(242, 242, 242)
- display: flex
- opacity: 1
- rect: x 17.0, y 787.0, 366.0×56.0

### Bottom row
`div.edit-composer-actions`  "GPT-6.1 Terra / · Medium"

- width: 366px
- height: 44px
- padding: 4px 8px 8px 6px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(150, 150, 150)
- gap: 8px
- display: flex
- opacity: 1
- rect: x 17.0, y 843.0, 366.0×44.0

### Bottom row control #1
`button.composer-add` Add footage

- width: 32px
- height: 32px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(150, 150, 150)
- gap: 8px
- display: flex
- opacity: 1
- rect: x 23.0, y 847.0, 32.0×32.0

### Bottom row control #2
`div.`  "GPT-6.1 Terra / · Medium"

- width: 272px
- height: 28px
- border-color: rgb(45, 45, 45)
- border-style: solid
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(150, 150, 150)
- gap: 2px
- display: flex
- opacity: 1
- rect: x 63.0, y 849.0, 272.0×28.0

### Bottom row control #3
`button.revline-primary.composer-submit` Start edit

- width: 32px
- height: 32px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- background-color: rgb(124, 58, 237)
- box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(255, 255, 255)
- gap: 8px
- display: flex
- opacity: 0.5
- rect: x 343.0, y 847.0, 32.0×32.0

### Send button
`button.revline-primary.composer-submit` Start edit

- width: 32px
- height: 32px
- border-width: 1px
- border-style: solid
- border-radius: 8px
- background-color: rgb(124, 58, 237)
- box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px
- font-family: Geist, "Geist Fallback", sans-serif
- font-size: 14px
- font-weight: 500
- line-height: 20px
- color: rgb(255, 255, 255)
- gap: 8px
- display: flex
- opacity: 0.5
- rect: x 343.0, y 847.0, 32.0×32.0

## Screenshot notes

- `editor.png` / `editor-composer.png`: "Call of Duty - Warzone Season 1 Clipping". Both Warzone projects (and the other recent ones) were edited over MCP, so their assistant panel shows only the empty state.
- `editor-chat.png`: the first older project on /chats with a finished in-app turn (id j9781fz6977c9dmy1nmf7s6kn98hjsrn). Its turns end in "Stopped after N steps"; tool calls render as collapsed rows ("Checked your project", "Ran 5 steps", "Thought").
- The Next.js dev indicator was hidden with CSS before capture.

## Not captured

Nothing.
