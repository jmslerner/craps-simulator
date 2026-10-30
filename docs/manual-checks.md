# Manual checks

Checks that only a person on real hardware can make. Each row stays **PENDING** until someone
runs the check and writes down what they measured; nobody records a device result they did not
measure themselves. Automated checks live in `npm run verify` and `npm run e2e`.

| Id | Milestone | Check | Status | Measured by / on | Result |
|---|---|---|---|---|---|
| MC-1 | M10b | iPhone: the 3D dome holds ≥45 fps during a throw and no face swap is ever visible | **PENDING** | — | — |
| MC-2 | fix:dome | On a real GPU (the player's own browser): the dice read clearly at rest at every quality tier, with no glare over them, and the camera's moves look smooth | **PENDING** | — | — |
| MC-3 | M14 | A screen reader session (VoiceOver with Safari on a Mac or an iPhone; NVDA with Firefox or Chrome on Windows): every zone, roll and payout is announced in words | **PENDING** | — | — |

## MC-1 — iPhone frame rate and face swap (M10b)

The plan (§10 M10b) asks for a manual iPhone check: at least 45 fps while the dice tumble, and no
visible change of pips on a die in flight or at rest. The dome's own monitor drops a quality tier
when the median frame runs over 22 ms (under 45 fps), so a device that cannot hold the rate on
its starting tier settles one tier lower on the second or third throw and keeps that tier for the
next visit (`localStorage` key `bct:v1:dome-quality`).

### Steps

1. Open the deployed build on the iPhone in Safari (and, if available, Chrome). Note the model
   and iOS version.
2. The dice are 3D by default; if this browser was switched to 2D before, turn **3D dice** back
   on (the toggle under the dome, at the right). Leave the quality pin beside it on **Auto**;
   note the tier it names (expected: `Medium` on a coarse pointer).
3. Bet $5 on the pass line and roll at least 20 times, watching the dice: in flight, on landing
   and at rest.
4. Measure the frame rate during throws. Either:
   - connect the phone to a Mac, open Safari's Web Inspector → Timelines → record a throw, and
     read the frames-per-second track; or
   - open the quality pin and watch whether Auto's tier changes after the second or third throw
     (a drop means the monitor saw a median frame over 22 ms on the starting tier).
5. Repeat step 3 with the quality pin on **Low** and on **High**.
6. Lock and unlock the phone mid-throw, and switch apps and back: the roll must reveal the
   stored result (never re-roll) and the dome must keep working or offer **Retry 3D**.

### Record

- Device model, iOS and browser versions.
- Frame rate per tier (Auto's chosen tier, Low, High): the median and the lowest seen during a
  throw; whether Auto dropped a tier and on which throw.
- Face swaps: how many rolls watched, and whether any die was seen changing its pips other than
  by tumbling. Note the roll index of any suspect roll so it can be replayed from the session
  seed (`?seed=` in an e2e build reproduces the same dice and the same physics).
- Any visual fault: a die intersecting the floor, dome or other die; flicker; a blank canvas.

### Pass

≥45 fps median on Auto's tier during throws, no face swap seen in ≥20 rolls, and the lock/switch
interruptions reveal the stored roll. Update the table row with the status (**PASS** / **FAIL**),
who measured, the device, and the numbers.

## MC-2 — The dice read clearly on a real GPU (fix:dome)

The automated checks run on SwiftShader, a software rasteriser: they prove the dice land on the
engine's roll, inside the canvas and clear of the overlays (`src/dome/camera.test.ts`, the
chromium-3d e2e), but not how the glass, the lighting and the camera's moves look on real
graphics hardware. M10b's transmission glass laid a white glare over the dice under SwiftShader;
every tier now draws the same faint shell, and this check confirms that on real hardware.

### Steps

1. Open the deployed build in the browser the player uses (desktop; then a phone if available).
   Note the browser, its version and the machine.
2. Roll at least 20 times on each quality pin (**High**, **Medium**, **Low**, then **Auto**),
   watching the throw (wide) and the camera's move in on the dice as they come to rest.
3. At rest, read both dice's top faces against the callout's total every time.
4. Resize the window (or rotate the phone) with dice at rest: the camera must keep both dice in
   view and clear of the ON/OFF puck and the callout (the recent totals now run along the felt's
   history strip, outside the dome).

### Record

- Browser, version and machine; the tier Auto chose.
- Per tier: whether any roll left a die's top face hard to read (glare, blur, too small), and the
  roll index of any such roll (`?seed=` in an e2e build replays it).
- Whether the camera's moves (out for the throw, in on the dice) ever stuttered or felt abrupt.

### Pass

Every top face readable at rest on every tier in ≥20 rolls each, no glare patch over a die, and
smooth camera moves. Update the table row with the status (**PASS** / **FAIL**), who measured,
the browser and machine, and what was seen.

## MC-3 — A screen reader session (M14)

The automated checks prove the markup: axe-core finds no serious or critical violation on any
screen in five browsers (`e2e/a11y.spec.ts`), and a whole session runs from the keyboard alone
(`e2e/keyboard.spec.ts`). They cannot prove how a real screen reader speaks it.

### Steps

1. Turn the screen reader on (VoiceOver: Cmd+F5 on a Mac, or Settings › Accessibility on an
   iPhone; NVDA on Windows). Open the deployed build. Note the reader, browser and versions.
2. Start a New game, bet the pass line and a place number, and roll five times, by keyboard on a
   computer (Tab, Enter, the keys in the table below) or by swipe and double-tap on a phone.
3. Listen at each step: each zone says its name, the money on it, what it pays and — with the
   coach on — its house edge and grade ("Place 6, $6.00, pays 7 to 6, house edge 1.52 percent,
   good"); each roll is announced once with its dice, what happened and the money won or lost;
   a refused bet says the machine's reason; the inspector and the dialogs announce their titles
   and hand focus back when they close.

### Record

- Reader, browser, device and versions; anything announced twice, not at all, or in shorthand
  ("7 colon 6") instead of words.

### Pass

Every zone, roll, payout and refusal is spoken in words, once, in a five-roll session. Update the
table row with the status (**PASS** / **FAIL**), who listened, on what, and what was heard.

## Supported browsers (M14; plan §0 #26)

The trainer is a web page and needs nothing installed. It runs in:

| Browser | Lowest version | Set by |
|---|---|---|
| Chrome, Edge (desktop and Android) | 111 | the JavaScript build target (Vite 8's Baseline "widely available" set: Chrome 111, Firefox 114, Safari 16.4) |
| Safari (macOS, iPhone, iPad) | 16.4 | the same build target |
| Firefox | 114 (121 for the full look) | module web workers (the coach's analysis runs in one) need 114 |

- **`:has()` tints:** four decorative rules use `:has()`, which arrived in Chrome 105, Safari 15.4
  and Firefox 121. Only Firefox 114–120 is inside the floor without it, and there each falls back
  quietly: the next-step guide's finished steps keep the plain colour (the current step is still
  marked), a recap line's arithmetic sits inside its bet's chip instead of across the row, and a
  dialog's checked choice shows by its brass radio button rather than a brass fill. Nothing else
  depends on `:has()`; the rule that also styles the no-action lines and lessons is split from it.
- **3D dice need WebGL.** Without it (or when the graphics context is lost) the same dice play
  in 2D, and the 3D code is never downloaded; `e2e/cross-browser.spec.ts` checks both paths.
- **Keyboard on Safari:** Safari's Tab key moves only between text fields until Settings ›
  Advanced › "Press Tab to highlight each item" is on; Option+Tab always reaches every control.
- **Checked automatically** on every `npm run e2e`: desktop Chromium, Firefox and WebKit (the
  Safari engine) at 1440×900, and Pixel 7 and iPhone 15 emulation — the functional specs, the
  accessibility audit, the cross-browser checks and, on the desktops, the keyboard session.
- **Keys:** Space or R roll, U undo, C clear, Shift+R repeat, 1–9 pick a chip in rack order
  (crapless has eight), I info mode (then Enter on a zone opens its inspector), X remove mode,
  O bets on/off, Escape closes a dialog.

